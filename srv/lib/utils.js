import cds from "@sap/cds";

// Today as 'YYYY-MM-DD' in the workshop's timezone
export function today() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: cds.env.workshop?.timezone ?? "UTC",
  });
}

// quantity × price, calculated in cents
export function multiply(quantity, price) {
  return (
    Math.round(
      (Math.round(Number(quantity) * 100) * Math.round(Number(price) * 100)) /
        100,
    ) / 100
  );
}

// Adds months to a date
export function addMonths(isoDate, months) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const lastDay = new Date(
    Date.UTC(year, month - 1 + months + 1, 0),
  ).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

// Last service date + interval
export function nextServiceDue(lastServiceDate, serviceIntervalMonths) {
  return lastServiceDate && serviceIntervalMonths
    ? addMonths(lastServiceDate, serviceIntervalMonths)
    : null;
}

// Readable entity name
export function label(entity) {
  return (
    entity["@title"] ??
    entity.name
      .split(".")
      .pop()
      .replace(/([a-z])([A-Z])/g, "$1 $2")
  );
}
