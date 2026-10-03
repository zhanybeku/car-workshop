import cds from '@sap/cds'
import generic, { normalize } from './handlers/generic.js'
import vehicles from './handlers/vehicles.js'
import mechanics from './handlers/mechanics.js'
import orders from './handlers/orders.js'
import items from './handlers/items.js'
import actions from './handlers/actions.js'

export default class WorkshopService extends cds.ApplicationService {
  init() {
    generic(this)    // must come first
    vehicles(this)
    mechanics(this)
    orders(this)
    items(this)
    actions(this)
    return super.init()
  }

  // Cleans input before CAP's own checks run
  async handle(req) {
    if (['CREATE', 'UPDATE', 'NEW'].includes(req.event)) normalize(req.target, req.data)
    return super.handle(req)
  }
}
