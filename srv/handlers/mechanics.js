import cds from "@sap/cds";

export default function (srv) {
  const { Mechanics, ServiceOrders } = srv.entities;

  // No deactivating while the mechanic has open orders
  srv.before("UPDATE", Mechanics, async (req) => {
    if (req.data.isActive !== false) return;
    const { count } = await SELECT.one
      .from(ServiceOrders)
      .columns("count(1) as count")
      .where({
        mechanic_ID: req.data.ID,
        status_code: { in: ["OPEN", "IN_PROGRESS"] },
      });
    if (count) req.reject(409, "MECHANIC_HAS_OPEN_ORDERS", "isActive", [count]);
  });
}

// Only active mechanics can be assigned
export async function assertActiveMechanic(req, mechanicID) {
  const { Mechanics } = cds.entities("workshop");
  const mechanic = await SELECT.one
    .from(Mechanics, mechanicID)
    .columns("fullName", "isActive");
  if (mechanic && !mechanic.isActive)
    req.reject(409, "MECHANIC_INACTIVE", "mechanic_ID", [mechanic.fullName]);
}

// The mechanic's rate for labor items
export async function hourlyRate(req, mechanicID) {
  const { Mechanics } = cds.entities("workshop");
  if (!mechanicID) req.reject(409, "LABOR_NEEDS_MECHANIC");
  const mechanic = await SELECT.one
    .from(Mechanics, mechanicID)
    .columns("hourlyRate");
  // SAFETY NET: @assert.target already checks this
  if (!mechanic) req.reject(400, "MECHANIC_NOT_FOUND");
  return mechanic.hourlyRate;
}
