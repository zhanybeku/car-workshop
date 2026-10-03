import cds from '@sap/cds'
import { multiply } from '../lib/utils.js'
import { updateTotals, describedByPart } from './items.js'

// Live values while editing a draft. Save recalculates all of them with the normal rules.
export default function (srv) {
  const { ServiceOrders, ServiceOrderItems } = srv.entities
  const drafts = { ServiceOrders: ServiceOrders.drafts, ServiceOrderItems: ServiceOrderItems.drafts }
  const { Vehicles, Mechanics, Parts } = cds.entities('workshop')

  // Customer follows the vehicle
  srv.before('UPDATE', drafts.ServiceOrders, async req => {
    if (!('vehicle_ID' in req.data)) return
    const vehicle = req.data.vehicle_ID && await SELECT.one.from(Vehicles, req.data.vehicle_ID).columns('owner_ID')
    req.data.customer_ID = vehicle?.owner_ID ?? null
  })

  // Labor follows the mechanic's rate
  srv.after('UPDATE', drafts.ServiceOrders, async (_, req) => {
    if (!('mechanic_ID' in req.data)) return
    const rate = await rateOf(req.data.mechanic_ID)
    const labor = await SELECT.from(drafts.ServiceOrderItems).columns('ID', 'quantity').where({ order_ID: req.data.ID, itemType_code: 'LABOR' })
    for (const { ID, quantity } of labor) {
      await UPDATE(drafts.ServiceOrderItems).with({ unitPrice: rate, lineTotal: lineTotal(quantity, rate) }).where({ ID })
    }
    await updateTotals(req.data.ID, drafts)
  })

  // Item price and line total
  srv.before(['NEW', 'UPDATE'], drafts.ServiceOrderItems, async req => {
    const stored = req.event === 'UPDATE' ? await SELECT.one.from(drafts.ServiceOrderItems).where({ ID: req.data.ID }) : undefined
    const item = { itemType_code: 'PART', quantity: 1, order_ID: req.params[0]?.ID, ...stored, ...req.data }
    const changed = field => field in req.data && req.data[field] !== stored?.[field]

    if (!stored || changed('itemType_code') || changed('part_ID')) {
      let price = null
      if (item.itemType_code === 'PART' && item.part_ID) {
        const part = await SELECT.one.from(Parts, item.part_ID).columns('name', 'unitPrice')
        price = part?.unitPrice ?? null
        const keep = 'description' in req.data ? req.data.description : stored && !await describedByPart(stored)
        if (part && !keep) req.data.description = part.name
      } else if (item.itemType_code === 'LABOR') {
        const order = await SELECT.one.from(drafts.ServiceOrders).columns('mechanic_ID').where({ ID: item.order_ID })
        price = await rateOf(order?.mechanic_ID)
      }
      req.data.unitPrice = price
    }
    const price = 'unitPrice' in req.data ? req.data.unitPrice : stored?.unitPrice
    req.data.lineTotal = lineTotal(item.quantity, price)
    req.orderID = item.order_ID
  })

  // Order totals
  srv.before('DELETE', drafts.ServiceOrderItems, async req => {
    req.orderID = (await SELECT.one.from(drafts.ServiceOrderItems).columns('order_ID').where({ ID: req.data.ID }))?.order_ID
  })
  srv.after(['NEW', 'UPDATE', 'DELETE'], drafts.ServiceOrderItems, (_, req) => req.orderID && updateTotals(req.orderID, drafts))

  async function rateOf(mechanicID) {
    if (!mechanicID) return null
    return (await SELECT.one.from(Mechanics, mechanicID).columns('hourlyRate'))?.hourlyRate ?? null
  }
}

function lineTotal(quantity, price) {
  return price != null && Number(quantity) > 0 ? multiply(quantity, price) : null
}
