import { lockOrder } from '../lib/lock-order.js'
import { today, nextServiceDue } from '../lib/utils.js'

// Status actions — each one checks the current status, then moves the order on:
// OPEN → start → IN_PROGRESS → complete → COMPLETED → invoice → INVOICED, and cancel from OPEN / IN_PROGRESS
export default function (srv) {
  const { ServiceOrders, ServiceOrderItems, Vehicles, Parts } = srv.entities

  srv.on('start', ServiceOrders, async req => {
    const order = await lockOrder(req, 'OPEN')
    if (!order.mechanic_ID) return req.reject(409, 'START_NEEDS_MECHANIC')

    await UPDATE(req.subject).with({ status_code: 'IN_PROGRESS', startedAt: req.timestamp })
    return SELECT.one.from(req.subject)
  })

  srv.on('complete', ServiceOrders, async req => {
    const order = await lockOrder(req, 'IN_PROGRESS')
    const items = await SELECT.from(ServiceOrderItems).where({ order_ID: order.ID })
    if (!items.length) return req.reject(409, 'ORDER_HAS_NO_ITEMS')

    // Take the used parts out of stock. The stock condition makes the update affect
    // 0 rows instead of going negative; rejecting then rolls back all earlier deductions.
    for (const item of items.filter(i => i.itemType_code === 'PART')) {
      // SAFETY NET: normally caught earlier, because prepareItem (items.js) rejects part items
      // without a part when they're entered. Only data that bypassed the service gets here.
      if (!item.part_ID) return req.reject(409, 'ITEM_WITHOUT_PART', [item.description ?? item.ID])

      const deducted = await UPDATE(Parts)
        .with({ stock: { '-=': item.quantity } })
        .where({ ID: item.part_ID, stock: { '>=': item.quantity } })
      if (!deducted) {
        const part = await SELECT.one.from(Parts, item.part_ID).columns('partNumber', 'name', 'stock')
        return req.reject(409, 'NOT_ENOUGH_STOCK', [part.partNumber, part.name, part.stock, item.quantity])
      }
    }

    // Record the service on the vehicle
    const vehicle = await SELECT.one.from(Vehicles, order.vehicle_ID).columns('mileage', 'serviceIntervalMonths')
    const serviceDate = today()
    await UPDATE(Vehicles, order.vehicle_ID).with({
      mileage: Math.max(vehicle.mileage ?? 0, order.mileageAtIntake ?? 0),  // never turn the odometer back
      lastServiceDate: serviceDate,
      nextServiceDue: nextServiceDue(serviceDate, vehicle.serviceIntervalMonths),
    })

    await UPDATE(req.subject).with({ status_code: 'COMPLETED', completedAt: req.timestamp })
    return SELECT.one.from(req.subject)
  })

  srv.on('invoice', ServiceOrders, async req => {
    await lockOrder(req, 'COMPLETED')

    await UPDATE(req.subject).with({ status_code: 'INVOICED' })
    return SELECT.one.from(req.subject)
  })

  srv.on('cancel', ServiceOrders, async req => {
    await lockOrder(req, 'OPEN', 'IN_PROGRESS')

    // Empty or whitespace-only reasons are already rejected by @mandatory in the CDS
    await UPDATE(req.subject).with({ status_code: 'CANCELLED', cancellationReason: req.data.reason.trim() })
    return SELECT.one.from(req.subject)
  })
}
