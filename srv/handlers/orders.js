import cds from '@sap/cds'
import { lockOrder } from '../lib/lock-order.js'
import { today } from '../lib/utils.js'
import { assertActiveMechanic } from './mechanics.js'
import { prepareItem, repriceLabor, updateTotals } from './items.js'

export default function (srv) {
  const { ServiceOrders, ServiceOrderItems } = srv.entities
  const { NumberRanges } = cds.entities('workshop')

  // Order number, e.g. SO-2026-000001
  srv.before('CREATE', ServiceOrders, async req => {
    const prefix = `SO-${today().slice(0, 4)}-`

    const range = await SELECT.one.from(NumberRanges).where({ prefix }).forUpdate()
    const next = (range?.lastNumber ?? 0) + 1
    // SAFETY NET: over 999,999 orders in one year
    if (next > 999999) req.reject(409, 'ORDER_NUMBERS_EXHAUSTED', [prefix])

    if (range) await UPDATE(NumberRanges, prefix).with({ lastNumber: next })
    else await INSERT.into(NumberRanges).entries({ prefix, lastNumber: next })

    req.data.orderNumber = prefix + String(next).padStart(6, '0')
  })

  // Checks on a new order and its items
  srv.before('CREATE', ServiceOrders, async req => {
    setOrderDate(req)
    await setCustomer(req, req.data.vehicle_ID)
    if (req.data.mechanic_ID) await assertActiveMechanic(req, req.data.mechanic_ID)
    await assertIntakeMileage(req, req.data.vehicle_ID, req.data.mileageAtIntake)
    await assertOwnItems(req, req.data.items)
    for (const item of req.data.items ?? []) await prepareItem(req, req.data, item)
  })

  // Checks on an order update, only for values that really change
  srv.before('UPDATE', ServiceOrders, async req => {
    const order = await lockOrder(req, 'OPEN', 'IN_PROGRESS')
    const merged = { ...order, ...req.data }
    setOrderDate(req)

    if ('mechanic_ID' in req.data && !merged.mechanic_ID) {
      const labor = await SELECT.one.from(ServiceOrderItems).where({ order_ID: order.ID, itemType_code: 'LABOR' })
      if (order.status_code === 'IN_PROGRESS' || labor) {
        req.reject(409, 'MECHANIC_STILL_NEEDED')
      }
    }
    if (merged.vehicle_ID !== order.vehicle_ID && order.status_code !== 'OPEN') {
      req.reject(409, 'VEHICLE_LOCKED', 'vehicle_ID', [order.status_code])
    }
    if (merged.vehicle_ID !== order.vehicle_ID) await setCustomer(req, merged.vehicle_ID)
    if (merged.mechanic_ID !== order.mechanic_ID) req.mechanicChanged = true
    if (merged.mechanic_ID && merged.mechanic_ID !== order.mechanic_ID) await assertActiveMechanic(req, merged.mechanic_ID)
    if (merged.mileageAtIntake !== order.mileageAtIntake || merged.vehicle_ID !== order.vehicle_ID) {
      await assertIntakeMileage(req, merged.vehicle_ID, merged.mileageAtIntake)
    }

    if (req.data.items) {
      const existing = await SELECT.from(ServiceOrderItems).where({ order_ID: order.ID })
      await assertOwnItems(req, req.data.items, existing)
      for (const item of req.data.items) await prepareItem(req, merged, item, existing.find(e => e.ID === item.ID))
    }
  })

  // Only OPEN orders can be deleted
  srv.before('DELETE', ServiceOrders, req => lockOrder(req, 'OPEN'))

  // Reprices labor if the mechanic changed, then updates totals
  srv.after(['CREATE', 'UPDATE'], ServiceOrders, async (_, req) => {
    if (req.mechanicChanged) await repriceLabor(req, req.data.ID, req.data.mechanic_ID)
    await updateTotals(req.data.ID)
  })
}

// Order date defaults to today, never in the future
function setOrderDate(req) {
  if (req.event === 'CREATE' || 'orderDate' in req.data) req.data.orderDate ??= today()
  if (req.data.orderDate > today()) req.reject(400, 'ORDER_DATE_IN_FUTURE', 'orderDate')
}

// Customer = the vehicle's current owner
async function setCustomer(req, vehicleID) {
  const { Vehicles } = cds.entities('workshop')
  const vehicle = await SELECT.one.from(Vehicles, vehicleID).columns('owner_ID')
  req.data.customer_ID = vehicle?.owner_ID
}

// Items sent with an order can't belong to another order
async function assertOwnItems(req, items = [], existing = []) {
  const others = items.map(i => i.ID).filter(ID => ID && !existing.some(e => e.ID === ID))
  if (!others.length) return
  const { ServiceOrderItems } = cds.entities('workshop')
  const taken = await SELECT.one.from(ServiceOrderItems).columns('ID').where({ ID: { in: others } })
  if (taken) req.reject(409, 'ITEM_OF_OTHER_ORDER', 'items', [taken.ID])
}

// Intake mileage can't be below the vehicle's mileage
async function assertIntakeMileage(req, vehicleID, mileage) {
  if (mileage == null || !vehicleID) return
  const { Vehicles } = cds.entities('workshop')
  const vehicle = await SELECT.one.from(Vehicles, vehicleID).columns('mileage')
  if (vehicle && mileage < vehicle.mileage) {
    req.reject(409, 'MILEAGE_BELOW_RECORDED', 'mileageAtIntake', [mileage, vehicle.mileage])
  }
}
