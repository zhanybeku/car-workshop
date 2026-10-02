import cds from '@sap/cds'
import generic, { normalize } from './handlers/generic.js'
import vehicles from './handlers/vehicles.js'
import mechanics from './handlers/mechanics.js'
import orders from './handlers/orders.js'
import items from './handlers/items.js'
import actions from './handlers/actions.js'

export default class WorkshopService extends cds.ApplicationService {
  init() {
    generic(this)    // must come first: its error guard has to run before all other handlers
    vehicles(this)   // model year, next service date
    mechanics(this)  // deactivation rules
    orders(this)     // order number, edit/delete guards, checks, totals
    items(this)      // items edited one at a time, pricing
    actions(this)    // start, complete, invoice, cancel
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
