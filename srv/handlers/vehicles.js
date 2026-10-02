import { today, nextServiceDue } from '../lib/utils.js'

export default function (srv) {
  const { Vehicles } = srv.entities

  // Model year: from the first car (1886) up to next year's models. Not an @assert.range in the
  // schema, because the upper limit moves every year.
  srv.before(['CREATE', 'UPDATE'], Vehicles, req => {
    const { year } = req.data
    const latest = Number(today().slice(0, 4)) + 1
    if (year != null && (year < 1886 || year > latest)) req.reject(400, 'YEAR_OUT_OF_RANGE', 'year', [1886, latest])
  })

  // nextServiceDue = lastServiceDate + serviceIntervalMonths, recalculated whenever either one is set.
  // Stored rather than a calculated element, because databases have no common "add months" function.
  srv.before(['CREATE', 'UPDATE'], Vehicles, async req => {
    const changed = 'lastServiceDate' in req.data || 'serviceIntervalMonths' in req.data
    if (req.event === 'UPDATE' && !changed) return

    const stored = req.event === 'UPDATE'
      ? await SELECT.one.from(Vehicles, req.data.ID).columns('lastServiceDate', 'serviceIntervalMonths')
      : { serviceIntervalMonths: Vehicles.elements.serviceIntervalMonths.default?.val }  // not in req.data yet on CREATE
    const { lastServiceDate, serviceIntervalMonths } = { ...stored, ...req.data }

    if (lastServiceDate > today()) req.reject(400, 'LAST_SERVICE_IN_FUTURE', 'lastServiceDate')
    req.data.nextServiceDue = nextServiceDue(lastServiceDate, serviceIntervalMonths)
  })
}
