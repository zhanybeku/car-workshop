using WorkshopService as service from '../../srv/workshop-service';

// List page
annotate service.Customers with @(
  UI.LineItem: [
    { Value: fullName, ![@UI.Importance]: #High },
    { Value: phone,    ![@UI.Importance]: #High },
    { Value: email }
  ],
  UI.PresentationVariant: {
    SortOrder: [{ Property: lastName }, { Property: firstName }],
    Visualizations: ['@UI.LineItem']
  }
);

// Customer page
annotate service.Customers with @(
  UI.HeaderInfo: {
    TypeName: '{i18n>Customer}',
    TypeNamePlural: '{i18n>Customers}',
    Title: { Value: fullName },
    Description: { Value: phone }
  },
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', ID: 'Contact',  Label: '{i18n>Contact}',        Target: '@UI.FieldGroup#Contact' },
    { $Type: 'UI.ReferenceFacet', ID: 'Vehicles', Label: '{i18n>Vehicles}',       Target: 'vehicles/@UI.LineItem#OfCustomer',
      ![@UI.Hidden]: { $edmJson: { $Not: { $Path: 'IsActiveEntity' } } } },
    { $Type: 'UI.ReferenceFacet', ID: 'Orders',   Label: '{i18n>ServiceHistory}', Target: 'orders/@UI.LineItem#History',
      ![@UI.Hidden]: { $edmJson: { $Not: { $Path: 'IsActiveEntity' } } } },
    { $Type: 'UI.ReferenceFacet', ID: 'Changes',  Label: '{i18n>Changes}',        Target: '@UI.FieldGroup#Changes' }
  ],
  UI.FieldGroup #Contact: { Data: [
    { Value: firstName },
    { Value: lastName },
    { Value: phone },
    { Value: email }
  ]},
  UI.FieldGroup #Changes: { Data: [
    { Value: createdBy },
    { Value: createdAt },
    { Value: modifiedBy },
    { Value: modifiedAt }
  ]},
  Capabilities.NavigationRestrictions: { RestrictedProperties: [
    { NavigationProperty: vehicles, InsertRestrictions: { Insertable: false }, DeleteRestrictions: { Deletable: false } },
    { NavigationProperty: orders,   InsertRestrictions: { Insertable: false }, DeleteRestrictions: { Deletable: false } }
  ]}
);

// Vehicles of a customer
annotate service.Vehicles with @(
  UI.LineItem #OfCustomer: [
    { $Type: 'UI.DataFieldWithUrl', Value: licensePlate, ![@UI.Importance]: #High,
      Url: { $edmJson: { $Apply: ['/vehicles/webapp/index.html#/Vehicles(ID=', { $Path: 'ID' }, ',IsActiveEntity=true)'], $Function: 'odata.concat' } } },
    { Value: make },
    { Value: model },
    { Value: year },
    { Value: mileage },
    { Value: nextServiceDue, ![@UI.Importance]: #High }
  ]
);

// Service history of a customer or vehicle
annotate service.ServiceOrders with @(
  UI.LineItem #History: [
    { $Type: 'UI.DataFieldWithUrl', Value: orderNumber,
      Url: { $edmJson: { $Apply: ['/orders/webapp/index.html#/ServiceOrders(ID=', { $Path: 'ID' }, ',IsActiveEntity=true)'], $Function: 'odata.concat' } } },
    { Value: orderDate },
    { Value: status_code, Criticality: status.criticality },
    { Value: vehicle_ID },
    { Value: mechanic_ID },
    { Value: totalAmount }
  ]
);
