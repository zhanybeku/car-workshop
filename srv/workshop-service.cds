using {workshop as db} from '../db/schema';

service WorkshopService {

  // Master data
  @odata.draft.enabled
  entity Customers     as projection on db.Customers;

  @odata.draft.enabled
  entity Vehicles      as projection on db.Vehicles;

  entity Mechanics     as projection on db.Mechanics;
  entity Parts         as projection on db.Parts;

  // Transactional data
  @odata.draft.enabled
  entity ServiceOrders as projection on db.ServiceOrders
    actions {
      action start()                                 returns ServiceOrders; // OPEN → IN_PROGRESS
      action complete()                              returns ServiceOrders; // IN_PROGRESS → COMPLETED
      action invoice()                               returns ServiceOrders; // COMPLETED → INVOICED
      action cancel( @mandatory reason: String(500)) returns ServiceOrders; // OPEN | IN_PROGRESS → CANCELLED
    };

  // Code lists
  @readonly
  entity OrderStatus   as projection on db.OrderStatus;

  @readonly
  entity ItemTypes     as projection on db.ItemTypes;
}
