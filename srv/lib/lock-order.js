import cds from "@sap/cds";

// Locks the order and checks its status
export async function lockOrder(req, ...allowedStatuses) {
  const { ServiceOrders } = cds.entities("workshop");
  const order = await SELECT.one
    .from(ServiceOrders, req.params[0].ID)
    .forUpdate();
  if (!order) req.reject(404, "ORDER_NOT_FOUND");

  if (!allowedStatuses.includes(order.status_code)) {
    const key = req.target.name.endsWith(".ServiceOrderItems")
      ? "ORDER_ITEMS_LOCKED"
      : ({
          UPDATE: "ORDER_NOT_EDITABLE",
          EDIT: "ORDER_NOT_EDITABLE",
          DELETE: "ORDER_NOT_DELETABLE",
        }[req.event] ?? "ORDER_ACTION_NOT_ALLOWED");
    req.reject(409, key, [order.status_code, req.event]);
  }
  return order;
}
