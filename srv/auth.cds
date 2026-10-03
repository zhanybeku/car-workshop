using { WorkshopService } from './workshop-service';

// Who may do what. Roles:
//   Manager     customers, vehicles and orders (create, edit, delete, cancel)
//   Mechanic    order items, start and complete orders
//   Accountant  invoice completed orders
//   Admin       everything, including mechanics and parts (prices, hourly rates)
// Everyone logged in can read all data. Local test users are in package.json.

annotate WorkshopService with @(requires: 'authenticated-user');

annotate WorkshopService.Customers with @(restrict: [
  { grant: 'READ',  to: ['Manager', 'Mechanic', 'Accountant'] },
  { grant: 'WRITE', to: 'Manager' },
  { grant: '*',     to: 'Admin' }
]);

annotate WorkshopService.Vehicles with @(restrict: [
  { grant: 'READ',  to: ['Manager', 'Mechanic', 'Accountant'] },
  { grant: 'WRITE', to: 'Manager' },
  { grant: '*',     to: 'Admin' }
]);

annotate WorkshopService.Mechanics with @(restrict: [
  { grant: 'READ', to: ['Manager', 'Mechanic', 'Accountant'] },
  { grant: '*',    to: 'Admin' }
]);

annotate WorkshopService.Parts with @(restrict: [
  { grant: 'READ', to: ['Manager', 'Mechanic', 'Accountant'] },
  { grant: '*',    to: 'Admin' }
]);

annotate WorkshopService.ServiceOrders with @(restrict: [
  { grant: 'READ',                to: ['Manager', 'Mechanic', 'Accountant'] },
  { grant: ['WRITE', 'cancel'],   to: 'Manager' },
  { grant: ['start', 'complete'], to: 'Mechanic' },
  { grant: 'invoice',             to: 'Accountant' },
  { grant: '*',                   to: 'Admin' }
]);

annotate WorkshopService.ServiceOrderItems with @(restrict: [
  { grant: 'READ',  to: ['Manager', 'Mechanic', 'Accountant'] },
  { grant: 'WRITE', to: ['Manager', 'Mechanic'] },
  { grant: '*',     to: 'Admin' }
]);
