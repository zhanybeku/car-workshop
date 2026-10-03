import cds from '@sap/cds'
import { lockOrder } from '../lib/lock-order.js'
import { multiply } from '../lib/utils.js'
import { hourlyRate } from './mechanics.js'

// Items edited one at a time: /ServiceOrders(ID)/items(...).
// Items sent along with their order (deep insert/update) are handled in orders.js.
export default function (srv) {
  const { ServiceOrderItems } = srv.entities

  srv.before(['CREATE', 'UPDATE'], ServiceOrderItems, async req => {
    const order = await lockOrder(req, 'OPEN', 'IN_PROGRESS')
    const existing = req.event === 'UPDATE' ? await SELECT.one.from(ServiceOrderItems, req.params[1].ID) : undefined
    await prepareItem(req, order, req.data, existing)
  })
  srv.before('DELETE', ServiceOrderItems, req => lockOrder(req, 'OPEN', 'IN_PROGRESS'))
  srv.after(['CREATE', 'UPDATE', 'DELETE'], ServiceOrderItems, (_, req) => updateTotals(req.params[0].ID))
}

// Validates an item and sets its unitPrice and lineTotal. `item` is the incoming data
// and is changed in place; `existing` is the stored item when updating one.
export async function prepareItem(req, order, item, existing) {
  const { ServiceOrderItems, Parts } = cds.entities('workshop')

  // Default values from the model (e.g. itemType PART, quantity 1). The database applies
  // them only on INSERT, so they're not yet in req.data when our handlers run.
  const defaults = Object.fromEntries(Object.values(ServiceOrderItems.elements)
    .filter(e => e.default?.val !== undefined).map(e => [e.name, e.default.val]))

  const { itemType_code, part_ID, quantity } = { ...defaults, ...existing, ...item }
  if (!(Number(quantity) > 0)) req.reject(400, 'QUANTITY_NOT_POSITIVE')

  // A new item gets the current price. Later saves keep it, unless the item switches to a
  // different part or type. Values are compared, because Fiori sends unchanged fields too.
  const changed = field => field in item && item[field] !== existing[field]
  const repriced = !existing || changed('itemType_code') || changed('part_ID')
  let unitPrice = existing?.unitPrice

  if (itemType_code === 'PART') {
    if (!part_ID) req.reject(400, 'PART_REQUIRED')
    if (!Number.isInteger(Number(quantity))) req.reject(400, 'PART_WHOLE_PIECES')
    if (repriced) {
      const part = await SELECT.one.from(Parts, part_ID).columns('name', 'unitPrice')
      // SAFETY NET: normally caught earlier by @assert.target on `part`. Only data that bypassed
      // the service gets here; without this, `part.unitPrice` below would fail with a 500.
      if (!part) req.reject(400, 'PART_NOT_FOUND')
      unitPrice = part.unitPrice

      // The description defaults to the part's name. When the part is switched, a description filled
      // in that way follows the new part; one typed in by hand, or sent with this change, is kept.
      const fill = !existing || changed('description') ? !item.description : await describedByPart(existing)
      if (fill) item.description = part.name
    }
  } else if (itemType_code === 'LABOR') {
    if (part_ID) req.reject(400, 'LABOR_WITH_PART')
    if (repriced) unitPrice = await hourlyRate(req, order.mechanic_ID)
  } else {
    // SAFETY NET: normally caught earlier by @assert.target on `itemType`. Only data that bypassed
    // the service gets here; without this, the item would get no price and an invalid line total.
    req.reject(400, 'UNKNOWN_ITEM_TYPE', [itemType_code])
  }

  item.unitPrice = unitPrice
  item.lineTotal = multiply(quantity, unitPrice)
}

// Whether a stored item's description is empty or just its part's name, i.e. not typed in by hand
async function describedByPart(item) {
  if (!item.description) return true
  if (!item.part_ID) return false
  const { Parts } = cds.entities('workshop')
  const part = await SELECT.one.from(Parts, item.part_ID).columns('name')
  return item.description === part?.name
}

// Labor is charged at the rate of the order's current mechanic
export async function repriceLabor(req, orderID, mechanicID) {
  const { ServiceOrderItems } = cds.entities('workshop')
  const items = await SELECT.from(ServiceOrderItems).columns('ID', 'quantity').where({ order_ID: orderID, itemType_code: 'LABOR' })
  if (!items.length) return
  const rate = await hourlyRate(req, mechanicID)
  for (const { ID, quantity } of items) {
    await UPDATE(ServiceOrderItems, ID).with({ unitPrice: rate, lineTotal: multiply(quantity, rate) })
  }
}

// Sums the order's line totals in the database, so no rounding happens in JavaScript. The sums
// are rounded to cents anyway: SQLite adds decimals as floating point, so 0.10 + 0.20 would be
// stored as 0.30000000000000004 and a filter like totalAmount eq 0.3 wouldn't find the order.
export async function updateTotals(orderID) {
  const { ServiceOrders, ServiceOrderItems } = cds.entities('workshop')
  const totals = await SELECT.one.from(ServiceOrderItems).where({ order_ID: orderID }).columns(
    `round(coalesce(sum(case when itemType_code = 'PART'  then lineTotal end), 0), 2) as partsTotal`,
    `round(coalesce(sum(case when itemType_code = 'LABOR' then lineTotal end), 0), 2) as laborTotal`,
    `round(coalesce(sum(lineTotal), 0), 2) as totalAmount`,
  )
  await UPDATE(ServiceOrders, orderID).with(totals)
}
