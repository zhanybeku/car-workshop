import { label } from '../lib/utils.js'

// Checks that apply to every entity, driven by annotations and associations in the model
export default function (srv) {

  // CAP's annotation checks (@assert.range, @assert.format, ...) collect their errors but still let
  // the before handlers run, and a later req.reject() would replace those errors with its own.
  // So stop right here and report them. This must stay the first handler and synchronous: a
  // synchronous throw ends the before phase before the other handlers are even called.
  // Our own null check runs here too, so its errors are reported together with CAP's.
  srv.before('*', req => {
    if (['CREATE', 'UPDATE'].includes(req.event)) assertNoNullDefaults(req, req.target, req.data)
    if (req.errors) req.reject()
  })

  // Friendly duplicate check for every @assert.unique constraint in the model, e.g.
  // 'License Plate "01KG123ABC" is already in use' (409) instead of a raw database error (500).
  // The database constraint stays as a safety net for two simultaneous inserts.
  srv.before(['CREATE', 'UPDATE'], async req => {
    const { elements } = req.target
    for (const [anno, refs] of Object.entries(req.target)) {
      if (!anno.startsWith('@assert.unique.')) continue
      const fields = refs.map(ref => ref['='])

      // Skip constraints this request doesn't touch, and server-generated fields like orderNumber
      if (!fields.some(f => f in req.data)) continue
      if (fields.some(f => elements[f]['@readonly'])) continue

      // For a partial UPDATE of a multi-field constraint, take the missing values from the stored row
      const missing = fields.filter(f => !(f in req.data))
      const stored = missing.length && req.event === 'UPDATE' ? await SELECT.one.from(req.target, req.data.ID).columns(missing) : {}
      const values = Object.fromEntries(fields.map(f => [f, f in req.data ? req.data[f] : stored?.[f]]))
      if (Object.values(values).some(v => v == null)) continue  // NULLs never clash

      const duplicate = await SELECT.one.from(req.target).columns('ID').where({ ...values, ID: { '!=': req.data.ID } })
      if (duplicate) {
        const fieldNames = fields.map(f => elements[f]['@title'] ?? f).join(' + ')
        req.reject(409, 'ALREADY_IN_USE', fields[0], [fieldNames, Object.values(values).join(' + ')])
      }
    }
  })

  // Who points to whom, worked out once from the model, e.g. Customers → [Vehicles.owner].
  // Only managed to-one associations count (back-links like Customers.vehicles are just the
  // reverse view). A composition's children (an order's items) are left out: they're deleted
  // together with their parent.
  const referencesTo = new Map()
  for (const entity of Object.values(srv.entities)) {
    for (const assoc of Object.values(entity.associations ?? {})) {
      if (assoc.on || !assoc.is2one) continue
      const target = assoc._target
      if (Object.values(target.compositions ?? {}).some(c => c._target === entity)) continue
      if (!referencesTo.has(target)) referencesTo.set(target, [])
      referencesTo.get(target).push({ entity, foreignKeys: assoc.keys })
    }
  }

  // Blocks deleting a record that others still point to, e.g. a customer who still has vehicles,
  // with a 409 instead of leaving orphans. Database foreign keys are the safety net.
  srv.before('DELETE', async req => {
    const usedIn = []
    for (const { entity, foreignKeys } of referencesTo.get(req.target) ?? []) {
      // e.g. Vehicles.owner → { owner_ID: <customer ID> }
      const where = Object.fromEntries(foreignKeys.map(k => [k.$generatedFieldName, req.data[k.ref[0]]]))
      const { count } = await SELECT.one.from(entity).columns('count(1) as count').where(where)
      if (count) usedIn.push(`${label(entity)} (${count})`)
    }

    if (usedIn.length) {
      const key = req.target.elements.isActive ? 'STILL_IN_USE_DEACTIVATE' : 'STILL_IN_USE'
      req.reject(409, key, [usedIn.join(', ')])
    }
  })
}

// Fields with a default (stock 0, isActive true, ...) may be left out, but not set to null, e.g. a
// part with stock null would never be flagged for reordering. Neither schema option fits: @mandatory
// would require the field on CREATE too, and `not null` only gives a raw database error. Includes
// items sent along with their parent; @readonly fields are skipped, the client can't set them anyway.
function assertNoNullDefaults(req, entity, data) {
  for (const row of Array.isArray(data) ? data : [data]) {
    for (const [name, value] of Object.entries(row ?? {})) {
      const element = entity.elements[name]
      if (value === null && element?.default !== undefined && !element['@readonly']) {
        req.error(400, 'ASSERT_MANDATORY', name)
      } else if (element?.isComposition) {
        assertNoNullDefaults(req, element._target, value)
      }
    }
  }
}

// Trims all string values and uppercases @uppercase ones, including items sent along
// with their parent (deep insert/update). Called from WorkshopService.handle().
export function normalize(entity, data) {
  for (const row of Array.isArray(data) ? data : [data]) {
    for (const [name, value] of Object.entries(row ?? {})) {
      const element = entity.elements[name]
      if (typeof value === 'string' && element?.type === 'cds.String') {
        row[name] = element['@uppercase'] ? value.trim().toUpperCase() : value.trim()
      } else if (element?.isComposition) {
        normalize(element._target, value)
      }
    }
  }
}
