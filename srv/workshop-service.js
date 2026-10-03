import cds from '@sap/cds'
import generic, { normalize } from './handlers/generic.js'
import vehicles from './handlers/vehicles.js'
import mechanics from './handlers/mechanics.js'
import orders from './handlers/orders.js'
import items from './handlers/items.js'
import actions from './handlers/actions.js'
import drafts from './handlers/drafts.js'

export default class WorkshopService extends cds.ApplicationService {
  async init() {
    generic(this)    // must come first
    vehicles(this)
    mechanics(this)
    orders(this)
    items(this)
    actions(this)
    drafts(this)
    await super.init()

    // Cleans input before CAP's own checks run. Wraps handle here, because draft replaces it in init.
    const handle = this.handle
    this.handle = function (req) {
      if (['CREATE', 'UPDATE', 'NEW'].includes(req.event)) normalize(req.target, req.data)
      return handle.call(this, req)
    }
  }
}
