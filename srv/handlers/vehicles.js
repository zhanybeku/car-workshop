import { today, nextServiceDue } from "../lib/utils.js";

export default function (srv) {
  const { Vehicles } = srv.entities;

  // Model year between 1886 and next year
  srv.before(["CREATE", "UPDATE"], Vehicles, (req) => {
    const { year } = req.data;
    const latest = Number(today().slice(0, 4)) + 1;
    if (year != null && (year < 1886 || year > latest))
      req.reject(400, "YEAR_OUT_OF_RANGE", "year", [1886, latest]);
  });

  // Calculates nextServiceDue
  srv.before(["CREATE", "UPDATE"], Vehicles, async (req) => {
    const changed =
      "lastServiceDate" in req.data || "serviceIntervalMonths" in req.data;
    if (req.event === "UPDATE" && !changed) return;

    const stored =
      req.event === "UPDATE"
        ? await SELECT.one
            .from(Vehicles, req.data.ID)
            .columns("lastServiceDate", "serviceIntervalMonths")
        : {
            serviceIntervalMonths:
              Vehicles.elements.serviceIntervalMonths.default?.val,
          };
    const { lastServiceDate, serviceIntervalMonths } = {
      ...stored,
      ...req.data,
    };

    if (lastServiceDate > today())
      req.reject(400, "LAST_SERVICE_IN_FUTURE", "lastServiceDate");
    req.data.nextServiceDue = nextServiceDue(
      lastServiceDate,
      serviceIntervalMonths,
    );
  });
}
