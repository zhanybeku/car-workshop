import { lockOrder } from "../lib/lock-order.js";
import { today, nextServiceDue } from "../lib/utils.js";

// Status actions
export default function (srv) {
  const { ServiceOrders, ServiceOrderItems, Vehicles, Parts } = srv.entities;

  srv.on("start", ServiceOrders, async (req) => {
    const order = await lockOrder(req, "OPEN");
    if (!order.mechanic_ID) return req.reject(409, "START_NEEDS_MECHANIC");

    await UPDATE(req.subject).with({
      status_code: "IN_PROGRESS",
      startedAt: req.timestamp,
    });
    return SELECT.one.from(req.subject);
  });

  // Deducts stock and records the service on the vehicle
  srv.on("complete", ServiceOrders, async (req) => {
    const order = await lockOrder(req, "IN_PROGRESS");
    const items = await SELECT.from(ServiceOrderItems).where({
      order_ID: order.ID,
    });
    if (!items.length) return req.reject(409, "ORDER_HAS_NO_ITEMS");

    const needed = new Map();
    for (const item of items.filter((i) => i.itemType_code === "PART")) {
      // SAFETY NET: prepareItem already checks this
      if (!item.part_ID)
        return req.reject(409, "ITEM_WITHOUT_PART", [
          item.description ?? item.ID,
        ]);
      needed.set(
        item.part_ID,
        (needed.get(item.part_ID) ?? 0) + Number(item.quantity),
      );
    }

    for (const [partID, quantity] of needed) {
      const deducted = await UPDATE(Parts)
        .with({ stock: { "-=": quantity } })
        .where({ ID: partID, stock: { ">=": quantity } });
      if (!deducted) {
        const part = await SELECT.one
          .from(Parts, partID)
          .columns("partNumber", "name", "stock");
        req.error(409, "NOT_ENOUGH_STOCK", [
          part.partNumber,
          part.name,
          part.stock,
          quantity,
        ]);
      }
    }
    if (req.errors) return req.reject();

    const vehicle = await SELECT.one
      .from(Vehicles, order.vehicle_ID)
      .columns("mileage", "serviceIntervalMonths");
    const serviceDate = today();
    await UPDATE(Vehicles, order.vehicle_ID).with({
      mileage: Math.max(vehicle.mileage ?? 0, order.mileageAtIntake ?? 0),
      lastServiceDate: serviceDate,
      nextServiceDue: nextServiceDue(
        serviceDate,
        vehicle.serviceIntervalMonths,
      ),
    });

    await UPDATE(req.subject).with({
      status_code: "COMPLETED",
      completedAt: req.timestamp,
    });
    return SELECT.one.from(req.subject);
  });

  srv.on("invoice", ServiceOrders, async (req) => {
    await lockOrder(req, "COMPLETED");

    await UPDATE(req.subject).with({
      status_code: "INVOICED",
      invoicedAt: req.timestamp,
    });
    return SELECT.one.from(req.subject);
  });

  srv.on("cancel", ServiceOrders, async (req) => {
    await lockOrder(req, "OPEN", "IN_PROGRESS");

    await UPDATE(req.subject).with({
      status_code: "CANCELLED",
      cancelledAt: req.timestamp,
      cancellationReason: req.data.reason.trim(),
    });
    return SELECT.one.from(req.subject);
  });
}
