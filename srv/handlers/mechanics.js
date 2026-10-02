import cds from '@sap/cds'

export default function (srv) {
  const { Mechanics, ServiceOrders } = srv.entities

  // A mechanic can't be set inactive while orders are still waiting for them
  srv.before('UPDATE', Mechanics, async req => {
    if (req.data.isActive !== false) return
    const { count } = await SELECT.one.from(ServiceOrders).columns('count(1) as count')
      .where({ mechanic_ID: req.data.ID, status_code: { in: ['OPEN', 'IN_PROGRESS'] } })
    if (count) req.reject(409, 'MECHANIC_HAS_OPEN_ORDERS', 'isActive', [count])
  })
}

// Only active mechanics can be given work. A mechanic that doesn't exist at all is
// already rejected by @assert.target in the schema.
export async function assertActiveMechanic(req, mechanicID) {
  const { Mechanics } = cds.entities('workshop')
  const mechanic = await SELECT.one.from(Mechanics, mechanicID).columns('fullName', 'isActive')
  if (mechanic && !mechanic.isActive) req.reject(409, 'MECHANIC_INACTIVE', 'mechanic_ID', [mechanic.fullName])
}

// The hourly rate that labor on an order is charged at
export async function hourlyRate(req, mechanicID) {
  const { Mechanics } = cds.entities('workshop')
  if (!mechanicID) req.reject(409, 'LABOR_NEEDS_MECHANIC')
  const mechanic = await SELECT.one.from(Mechanics, mechanicID).columns('hourlyRate')
  // SAFETY NET: normally caught earlier by @assert.target on `mechanic`, and a mechanic with orders
  // can't be deleted. Without this, `mechanic.hourlyRate` below would fail with a 500.
  if (!mechanic) req.reject(400, 'MECHANIC_NOT_FOUND')
  return mechanic.hourlyRate
}
