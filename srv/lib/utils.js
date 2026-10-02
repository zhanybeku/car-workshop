import cds from '@sap/cds'

// Today's date as 'YYYY-MM-DD' in the workshop's timezone (cds.workshop.timezone in package.json).
// Timestamps like completedAt stay in UTC; this is only for calendar dates and the order number year.
export function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: cds.env.workshop?.timezone ?? 'UTC' })
}

// quantity × price in whole cents; plain JS math would round e.g. 0.5 × 0.29 = 0.145 down to 0.14
export function multiply(quantity, price) {
  return Math.round(Math.round(Number(quantity) * 100) * Math.round(Number(price) * 100) / 100) / 100
}

// Adds months to a 'YYYY-MM-DD' date, clamping to the month's last day (e.g. Jan 31 + 1 → Feb 28)
export function addMonths(isoDate, months) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10)
}

// When a vehicle's next service is due: its last service date plus its service interval,
// or empty if either is missing. Used when a vehicle is edited and when an order is completed.
export function nextServiceDue(lastServiceDate, serviceIntervalMonths) {
  return lastServiceDate && serviceIntervalMonths ? addMonths(lastServiceDate, serviceIntervalMonths) : null
}

// Readable entity name for messages: its @title, or e.g. 'ServiceOrders' → 'Service Orders'
export function label(entity) {
  return entity['@title'] ?? entity.name.split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2')
}
