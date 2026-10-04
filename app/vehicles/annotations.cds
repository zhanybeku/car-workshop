using WorkshopService as service from '../../srv/workshop-service';

// List page
annotate service.Vehicles with @(
  UI.SelectionFields    : [
    owner_ID,
    make,
    nextServiceDue
  ],
  UI.LineItem           : [
    {
      Value            : licensePlate,
      ![@UI.Importance]: #High
    },
    {Value: make},
    {Value: model},
    {Value: year},
    {
      Value            : owner_ID,
      ![@UI.Importance]: #High
    },
    {Value: mileage},
    {
      Value            : nextServiceDue,
      ![@UI.Importance]: #High
    }
  ],
  UI.PresentationVariant: {
    SortOrder     : [{Property: licensePlate}],
    Visualizations: ['@UI.LineItem']
  }
);

// Vehicle page
annotate service.Vehicles with @(
  UI.HeaderInfo                      : {
    TypeName      : '{i18n>Vehicle}',
    TypeNamePlural: '{i18n>Vehicles}',
    Title         : {Value: licensePlate},
    Description   : {Value: vin}
  },
  UI.Facets                          : [
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Vehicle',
      Label : '{i18n>VehicleData}',
      Target: '@UI.FieldGroup#Vehicle'
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Service',
      Label : '{i18n>Service}',
      Target: '@UI.FieldGroup#Service'
    },
    {
      $Type        : 'UI.ReferenceFacet',
      ID           : 'Orders',
      Label        : '{i18n>ServiceHistory}',
      Target       : 'orders/@UI.LineItem#History',
      ![@UI.Hidden]: {$edmJson: {$Not: {$Path: 'IsActiveEntity'}}}
    },
    {
      $Type : 'UI.ReferenceFacet',
      ID    : 'Changes',
      Label : '{i18n>Changes}',
      Target: '@UI.FieldGroup#Changes'
    }
  ],
  UI.FieldGroup #Vehicle             : {Data: [
    {Value: licensePlate},
    {Value: vin},
    {Value: make},
    {Value: model},
    {Value: year},
    {Value: owner_ID}
  ]},
  UI.FieldGroup #Service             : {Data: [
    {Value: mileage},
    {Value: serviceIntervalMonths},
    {Value: lastServiceDate},
    {Value: nextServiceDue}
  ]},
  UI.FieldGroup #Changes             : {Data: [
    {Value: createdBy},
    {Value: createdAt},
    {Value: modifiedBy},
    {Value: modifiedAt}
  ]},
  Capabilities.NavigationRestrictions: {RestrictedProperties: [{
    NavigationProperty: orders,
    InsertRestrictions: {Insertable: false},
    DeleteRestrictions: {Deletable: false}
  }]}
);
