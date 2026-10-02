import cds from '@sap/cds'
import { lockOrder } from '../lib/lock-order.js'
import { today } from '../lib/utils.js'
import { assertActiveMechanic } from './mechanics.js'
import { prepareItem, repriceLabor, updateTotals } from './items.js'

export default function (srv) {
  const { ServiceOrders, ServiceOrderItems } = srv.entities
  const { NumberRanges } = cds.entities('workshop')

  // Order updates that really change the mechanic (noted before the update, when the old value
  // is still known), so that only those reprice the labor afterwards
  const mechanicChanged = new WeakSet()

  // Generate a human-readable order number, e.g. SO-2026-000001
  srv.before('CREATE', ServiceOrders, async req => {
    const prefix = `SO-${today().slice(0, 4)}-`

    // Lock the counter row so parallel requests wait instead of reading the same number
    const range = await SELECT.one.from(NumberRanges).where({ prefix }).forUpdate()
    const next = (range?.lastNumber ?? 0) + 1
    if (next > 999999) return req.error(400, 'ORDER_NUMBERS_EXHAUSTED', [prefix])

    if (range) await UPDATE(NumberRanges, prefix).with({ lastNumber: next })
    else await INSERT.into(NumberRanges).entries({ prefix, lastNumber: next })

    req.data.orderNumber = prefix + String(next).padStart(6, '0')
  })

  // Checks on a new order, and on items sent along with it (deep insert)
  srv.before('CREATE', ServiceOrders, async req => {
    setOrderDate(req)
    if (req.data.mechanic_ID) await assertActiveMechanic(req, req.data.mechanic_ID)
    await assertIntakeMileage(req, req.data.vehicle_ID, req.data.mileageAtIntake)
    for (const item of req.data.items ?? []) await prepareItem(req, req.data, item)
  })

  // Orders can be edited only while work is ongoing, and deleted only before it has started
  // (started orders are cancelled instead, so there's a record of them)
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
    // Checked only when the values change, so re-saving an order as it is always works.
    // Once work has started, the order belongs to its vehicle; a wrong one means cancel and re-create.
    if (merged.vehicle_ID !== order.vehicle_ID && order.status_code !== 'OPEN') {
      req.reject(409, 'VEHICLE_LOCKED', 'vehicle_ID', [order.status_code])
    }
    if (merged.mechanic_ID !== order.mechanic_ID) mechanicChanged.add(req)
    if (merged.mechanic_ID && merged.mechanic_ID !== order.mechanic_ID) await assertActiveMechanic(req, merged.mechanic_ID)
    if (merged.mileageAtIntake !== order.mileageAtIntake || merged.vehicle_ID !== order.vehicle_ID) {
      await assertIntakeMileage(req, merged.vehicle_ID, merged.mileageAtIntake)
    }

    // Items sent along with the order (deep update)
    if (req.data.items) {
      const existing = await SELECT.from(ServiceOrderItems).where({ order_ID: order.ID })
      for (const item of req.data.items) await prepareItem(req, merged, item, existing.find(e => e.ID === item.ID))
    }
  })
  srv.before('DELETE', ServiceOrders, req => lockOrder(req, 'OPEN'))

  srv.after(['CREATE', 'UPDATE'], ServiceOrders, async (_, req) => {
    if (mechanicChanged.has(req)) await repriceLabor(req, req.data.ID, req.data.mechanic_ID)
    await updateTotals(req.data.ID)
  })
}

// The intake date is today, unless the client sends one (e.g. a paper order entered a few days
// later), and it can't be in the future. Not @mandatory in the schema: CAP checks that before our
// handlers run, so a missing date would be rejected before it could be filled in here.
function setOrderDate(req) {
  if (req.event === 'CREATE' || 'orderDate' in req.data) req.data.orderDate ??= today()
  if (req.data.orderDate > today()) req.reject(400, 'ORDER_DATE_IN_FUTURE', 'orderDate')
}

// The odometer reading at intake can't be lower than the vehicle's recorded mileage (usually a
// typo). If the recorded mileage itself is wrong, it can be corrected on the vehicle first.
async function assertIntakeMileage(req, vehicleID, mileage) {
  if (mileage == null || !vehicleID) return
  const { Vehicles } = cds.entities('workshop')
  const vehicle = await SELECT.one.from(Vehicles, vehicleID).columns('mileage')
  if (vehicle && mileage < vehicle.mileage) {
    req.reject(409, 'MILEAGE_BELOW_RECORDED', 'mileageAtIntake', [mileage, vehicle.mileage])
  }
}
