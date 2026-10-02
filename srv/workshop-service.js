import cds from '@sap/cds'

export default class WorkshopService extends cds.ApplicationService {
  init() {
    const { ServiceOrders, ServiceOrderItems, Vehicles, Parts, Mechanics } = this.entities
    const { NumberRanges } = cds.entities('workshop')

    // Reads and locks the order addressed by the request, and rejects the request unless
    // the order is in one of the allowed statuses. The order's key is always the first key
    // in the URL: /ServiceOrders(ID), /ServiceOrders(ID)/items(...), /ServiceOrders(ID)/WorkshopService.start
    const lockOrder = async (req, ...allowedStatuses) => {
      const order = await SELECT.one.from(ServiceOrders, req.params[0].ID).forUpdate()
      if (!order) req.reject(404, 'ORDER_NOT_FOUND')

      if (!allowedStatuses.includes(order.status_code)) {
        const key = req.target === ServiceOrderItems ? 'ORDER_ITEMS_LOCKED'
          : { UPDATE: 'ORDER_NOT_EDITABLE', DELETE: 'ORDER_NOT_DELETABLE' }[req.event] ?? 'ORDER_ACTION_NOT_ALLOWED'
        req.reject(409, key, [order.status_code, req.event])
      }
      return order
    }

    const hourlyRate = async (req, mechanicID) => {
      if (!mechanicID) req.reject(409, 'LABOR_NEEDS_MECHANIC')
      const mechanic = await SELECT.one.from(Mechanics, mechanicID).columns('hourlyRate')
      if (!mechanic) req.reject(400, 'MECHANIC_NOT_FOUND')
      return mechanic.hourlyRate
    }

    // The odometer reading at intake can't be lower than the vehicle's recorded mileage (usually a
    // typo). If the recorded mileage itself is wrong, it can be corrected on the vehicle first.
    const assertIntakeMileage = async (req, vehicleID, mileage) => {
      if (mileage == null || !vehicleID) return
      const vehicle = await SELECT.one.from(Vehicles, vehicleID).columns('mileage')
      if (vehicle && mileage < vehicle.mileage) {
        req.reject(409, 'MILEAGE_BELOW_RECORDED', 'mileageAtIntake', [mileage, vehicle.mileage])
      }
    }

    // Only active mechanics can be given work. A mechanic that doesn't exist at all is
    // already rejected by @assert.target in the schema.
    const assertActiveMechanic = async (req, mechanicID) => {
      const mechanic = await SELECT.one.from(Mechanics, mechanicID).columns('fullName', 'isActive')
      if (mechanic && !mechanic.isActive) req.reject(409, 'MECHANIC_INACTIVE', 'mechanic_ID', [mechanic.fullName])
    }

    // Default values from the model (e.g. itemType PART, quantity 1). The database applies
    // them only on INSERT, so they're not yet in req.data when our handlers run.
    const itemDefaults = Object.fromEntries(Object.values(ServiceOrderItems.elements)
      .filter(e => e.default?.val !== undefined).map(e => [e.name, e.default.val]))

    // Validates an item and sets its unitPrice and lineTotal. `item` is the incoming data
    // and is changed in place; `existing` is the stored item when updating one.
    const prepareItem = async (req, order, item, existing) => {
      const { itemType_code, part_ID, quantity } = { ...itemDefaults, ...existing, ...item }
      if (!(Number(quantity) > 0)) req.reject(400, 'QUANTITY_NOT_POSITIVE')

      // A new item gets the current price. Later saves keep it, unless the item switches to a
      // different part or type. Values are compared, because Fiori sends unchanged fields too.
      const changed = field => field in item && item[field] !== existing[field]
      const repriced = !existing || changed('itemType_code') || changed('part_ID')
      let unitPrice = existing?.unitPrice

      if (itemType_code === 'PART') {
        if (!part_ID) req.reject(400, 'PART_REQUIRED')
        if (!Number.isInteger(Number(quantity))) req.reject(400, 'PART_WHOLE_PIECES')
        if (repriced) {
          const part = await SELECT.one.from(Parts, part_ID).columns('name', 'unitPrice')
          if (!part) req.reject(400, 'PART_NOT_FOUND')
          unitPrice = part.unitPrice
          if (!existing && !item.description) item.description = part.name
        }
      } else if (itemType_code === 'LABOR') {
        if (part_ID) req.reject(400, 'LABOR_WITH_PART')
        if (repriced) unitPrice = await hourlyRate(req, order.mechanic_ID)
      } else {
        req.reject(400, 'UNKNOWN_ITEM_TYPE', [itemType_code])
      }

      item.unitPrice = unitPrice
      item.lineTotal = multiply(quantity, unitPrice)
    }

    // Order updates that really change the mechanic (noted before the update, when the old value
    // is still known), so that only those reprice the labor afterwards
    const mechanicChanged = new WeakSet()

    // Labor is charged at the rate of the order's current mechanic
    const repriceLabor = async (req, orderID, mechanicID) => {
      const items = await SELECT.from(ServiceOrderItems).columns('ID', 'quantity').where({ order_ID: orderID, itemType_code: 'LABOR' })
      if (!items.length) return
      const rate = await hourlyRate(req, mechanicID)
      for (const { ID, quantity } of items) {
        await UPDATE(ServiceOrderItems, ID).with({ unitPrice: rate, lineTotal: multiply(quantity, rate) })
      }
    }

    // Sums the order's line totals in the database, so no rounding happens in JavaScript
    const updateTotals = async orderID => {
      const totals = await SELECT.one.from(ServiceOrderItems).where({ order_ID: orderID }).columns(
        `coalesce(sum(case when itemType_code = 'PART'  then lineTotal end), 0) as partsTotal`,
        `coalesce(sum(case when itemType_code = 'LABOR' then lineTotal end), 0) as laborTotal`,
        `coalesce(sum(lineTotal), 0) as totalAmount`,
      )
      await UPDATE(ServiceOrders, orderID).with(totals)
    }

    // CAP's annotation checks (@assert.range, @assert.format, ...) collect their errors but still let
    // the before handlers run, and a later req.reject() would replace those errors with its own.
    // So stop right here and report them. This must stay the first handler and synchronous: a
    // synchronous throw ends the before phase before the other handlers are even called.
    this.before('*', req => { if (req.errors) req.reject() })

    // Friendly duplicate check for every @assert.unique constraint in the model, e.g.
    // 'License Plate "01KG123ABC" is already in use' (409) instead of a raw database error (500).
    // The database constraint stays as a safety net for two simultaneous inserts.
    this.before(['CREATE', 'UPDATE'], async req => {
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
          const label = fields.map(f => elements[f]['@title'] ?? f).join(' + ')
          req.reject(409, 'ALREADY_IN_USE', fields[0], [label, Object.values(values).join(' + ')])
        }
      }
    })

    // Who points to whom, worked out once from the model, e.g. Customers → [Vehicles.owner].
    // Only managed to-one associations count (back-links like Customers.vehicles are just the
    // reverse view). A composition's children (an order's items) are left out: they're deleted
    // together with their parent.
    const referencesTo = new Map()
    for (const entity of Object.values(this.entities)) {
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
    this.before('DELETE', async req => {
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

    // Model year: from the first car (1886) up to next year's models. Not an @assert.range in the
    // schema, because the upper limit moves every year.
    this.before(['CREATE', 'UPDATE'], Vehicles, req => {
      const { year } = req.data
      const latest = Number(today().slice(0, 4)) + 1
      if (year != null && (year < 1886 || year > latest)) req.reject(400, 'YEAR_OUT_OF_RANGE', 'year', [1886, latest])
    })

    // nextServiceDue = lastServiceDate + serviceIntervalMonths, recalculated whenever either one is set.
    // Stored rather than a calculated element, because databases have no common "add months" function.
    this.before(['CREATE', 'UPDATE'], Vehicles, async req => {
      const changed = 'lastServiceDate' in req.data || 'serviceIntervalMonths' in req.data
      if (req.event === 'UPDATE' && !changed) return

      const stored = req.event === 'UPDATE'
        ? await SELECT.one.from(Vehicles, req.data.ID).columns('lastServiceDate', 'serviceIntervalMonths')
        : { serviceIntervalMonths: Vehicles.elements.serviceIntervalMonths.default?.val }  // not in req.data yet on CREATE
      const { lastServiceDate, serviceIntervalMonths } = { ...stored, ...req.data }

      if (lastServiceDate > today()) req.reject(400, 'LAST_SERVICE_IN_FUTURE', 'lastServiceDate')
      req.data.nextServiceDue = lastServiceDate && serviceIntervalMonths ? addMonths(lastServiceDate, serviceIntervalMonths) : null
    })

    // A mechanic can't be set inactive while orders are still waiting for them
    this.before('UPDATE', Mechanics, async req => {
      if (req.data.isActive !== false) return
      const { count } = await SELECT.one.from(ServiceOrders).columns('count(1) as count')
        .where({ mechanic_ID: req.data.ID, status_code: { in: ['OPEN', 'IN_PROGRESS'] } })
      if (count) req.reject(409, 'MECHANIC_HAS_OPEN_ORDERS', 'isActive', [count])
    })

    // Generate a human-readable order number, e.g. SO-2026-000001
    this.before('CREATE', ServiceOrders, async req => {
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
    this.before('CREATE', ServiceOrders, async req => {
      if (req.data.mechanic_ID) await assertActiveMechanic(req, req.data.mechanic_ID)
      await assertIntakeMileage(req, req.data.vehicle_ID, req.data.mileageAtIntake)
      for (const item of req.data.items ?? []) await prepareItem(req, req.data, item)
    })

    // Orders can be edited only while work is ongoing, and deleted only before it has started
    // (started orders are cancelled instead, so there's a record of them)
    this.before('UPDATE', ServiceOrders, async req => {
      const order = await lockOrder(req, 'OPEN', 'IN_PROGRESS')
      const merged = { ...order, ...req.data }

      if ('mechanic_ID' in req.data && !merged.mechanic_ID) {
        const labor = await SELECT.one.from(ServiceOrderItems).where({ order_ID: order.ID, itemType_code: 'LABOR' })
        if (order.status_code === 'IN_PROGRESS' || labor) {
          req.reject(409, 'MECHANIC_STILL_NEEDED')
        }
      }
      // Checked only when the values change, so re-saving an order as it is always works
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
    this.before('DELETE', ServiceOrders, req => lockOrder(req, 'OPEN'))

    this.after(['CREATE', 'UPDATE'], ServiceOrders, async (_, req) => {
      if (mechanicChanged.has(req)) await repriceLabor(req, req.data.ID, req.data.mechanic_ID)
      await updateTotals(req.data.ID)
    })

    // Items edited one at a time: /ServiceOrders(ID)/items(...)
    this.before(['CREATE', 'UPDATE'], ServiceOrderItems, async req => {
      const order = await lockOrder(req, 'OPEN', 'IN_PROGRESS')
      const existing = req.event === 'UPDATE' ? await SELECT.one.from(ServiceOrderItems, req.params[1].ID) : undefined
      await prepareItem(req, order, req.data, existing)
    })
    this.before('DELETE', ServiceOrderItems, req => lockOrder(req, 'OPEN', 'IN_PROGRESS'))
    this.after(['CREATE', 'UPDATE', 'DELETE'], ServiceOrderItems, (_, req) => updateTotals(req.params[0].ID))

    // Status actions — each one checks the current status, then moves the order on
    this.on('start', ServiceOrders, async req => {
      const order = await lockOrder(req, 'OPEN')
      if (!order.mechanic_ID) return req.reject(409, 'START_NEEDS_MECHANIC')

      await UPDATE(req.subject).with({ status_code: 'IN_PROGRESS', startedAt: req.timestamp })
      return SELECT.one.from(req.subject)
    })

    this.on('complete', ServiceOrders, async req => {
      const order = await lockOrder(req, 'IN_PROGRESS')
      const items = await SELECT.from(ServiceOrderItems).where({ order_ID: order.ID })
      if (!items.length) return req.reject(409, 'ORDER_HAS_NO_ITEMS')

      // Take the used parts out of stock. The stock condition makes the update affect
      // 0 rows instead of going negative; rejecting then rolls back all earlier deductions.
      for (const item of items.filter(i => i.itemType_code === 'PART')) {
        // Items are validated on entry; this only guards against data that bypassed the service
        if (!item.part_ID) return req.reject(409, 'ITEM_WITHOUT_PART', [item.description ?? item.ID])

        const deducted = await UPDATE(Parts)
          .with({ stock: { '-=': item.quantity } })
          .where({ ID: item.part_ID, stock: { '>=': item.quantity } })
        if (!deducted) {
          const part = await SELECT.one.from(Parts, item.part_ID).columns('partNumber', 'name', 'stock')
          return req.reject(409, 'NOT_ENOUGH_STOCK', [part.partNumber, part.name, part.stock, item.quantity])
        }
      }

      // Record the service on the vehicle
      const vehicle = await SELECT.one.from(Vehicles, order.vehicle_ID).columns('mileage', 'serviceIntervalMonths')
      const serviceDate = today()
      await UPDATE(Vehicles, order.vehicle_ID).with({
        mileage: Math.max(vehicle.mileage ?? 0, order.mileageAtIntake ?? 0),  // never turn the odometer back
        lastServiceDate: serviceDate,
        nextServiceDue: vehicle.serviceIntervalMonths ? addMonths(serviceDate, vehicle.serviceIntervalMonths) : null,
      })

      await UPDATE(req.subject).with({ status_code: 'COMPLETED', completedAt: req.timestamp })
      return SELECT.one.from(req.subject)
    })

    this.on('invoice', ServiceOrders, async req => {
      await lockOrder(req, 'COMPLETED')

      await UPDATE(req.subject).with({ status_code: 'INVOICED' })
      return SELECT.one.from(req.subject)
    })

    this.on('cancel', ServiceOrders, async req => {
      await lockOrder(req, 'OPEN', 'IN_PROGRESS')

      // Empty or whitespace-only reasons are already rejected by @mandatory in the CDS
      await UPDATE(req.subject).with({ status_code: 'CANCELLED', cancellationReason: req.data.reason.trim() })
      return SELECT.one.from(req.subject)
    })

    return super.init()
  }

  // Tidies text input before anything else sees it: trims every string, and uppercases fields
  // marked @uppercase (license plate, VIN, part number), so ' a1 ' and 'A1' are the same value.
  // This can't be a before handler: CAP runs its own input checks (@mandatory, @assert.format)
  // inside handle(), before any handlers, and those checks must see the tidied values too.
  async handle(req) {
    if (['CREATE', 'UPDATE', 'NEW'].includes(req.event)) normalize(req.target, req.data)
    return super.handle(req)
  }
}

// Trims all string values and uppercases @uppercase ones, including items sent along
// with their parent (deep insert/update)
function normalize(entity, data) {
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

// Readable entity name for messages: its @title, or e.g. 'ServiceOrders' → 'Service Orders'
function label(entity) {
  return entity['@title'] ?? entity.name.split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2')
}

// Today's date as 'YYYY-MM-DD' in the workshop's timezone (cds.workshop.timezone in package.json).
// Timestamps like completedAt stay in UTC; this is only for calendar dates and the order number year.
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: cds.env.workshop?.timezone ?? 'UTC' })
}

// quantity × price in whole cents; plain JS math would round e.g. 0.5 × 0.29 = 0.145 down to 0.14
function multiply(quantity, price) {
  return Math.round(Math.round(Number(quantity) * 100) * Math.round(Number(price) * 100) / 100) / 100
}

// Adds months to a 'YYYY-MM-DD' date, clamping to the month's last day (e.g. Jan 31 + 1 → Feb 28)
function addMonths(isoDate, months) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month - 1 + months + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, lastDay))).toISOString().slice(0, 10)
}
