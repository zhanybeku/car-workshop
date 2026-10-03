using WorkshopService as service from '../../srv/workshop-service';

// List page
annotate service.ServiceOrders with @(
  UI.SelectionFields: [ status_code, orderDate, vehicle_ID, customer_ID, mechanic_ID ],
  UI.LineItem: [
    { Value: orderNumber, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '10rem' } },
    { Value: orderDate,                             ![@HTML5.CssDefaults]: { width: '8rem' } },
    { Value: status_code, Criticality: status.criticality, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '9rem' } },
    { Value: vehicle_ID,                            ![@HTML5.CssDefaults]: { width: '9rem' } },
    { Value: customer_ID,                           ![@HTML5.CssDefaults]: { width: '12rem' } },
    { Value: mechanic_ID,                           ![@HTML5.CssDefaults]: { width: '12rem' } },
    { Value: totalAmount, ![@UI.Importance]: #High, ![@HTML5.CssDefaults]: { width: '8rem' } },
    { $Type: 'UI.DataFieldForAction', Action: 'WorkshopService.start',    Label: '{i18n>Start}' },
    { $Type: 'UI.DataFieldForAction', Action: 'WorkshopService.complete', Label: '{i18n>Complete}' },
    { $Type: 'UI.DataFieldForAction', Action: 'WorkshopService.invoice',  Label: '{i18n>Invoice}' },
    { $Type: 'UI.DataFieldForAction', Action: 'WorkshopService.cancel',   Label: '{i18n>Cancel}' }
  ],
  UI.PresentationVariant: {
    SortOrder: [{ Property: orderNumber, Descending: true }],
    Visualizations: ['@UI.LineItem']
  }
);

// Object page
annotate service.ServiceOrders with @(
  UI.HeaderInfo: {
    TypeName: '{i18n>ServiceOrder}',
    TypeNamePlural: '{i18n>ServiceOrders}',
    Title: { Value: orderNumber },
    Description: { Value: vehicle.licensePlate }
  },
  UI.HeaderFacets: [
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Status' },
    { $Type: 'UI.ReferenceFacet', Target: '@UI.DataPoint#Total' }
  ],
  UI.DataPoint #Status: { Value: status_code, Title: '{i18n>Status}', Criticality: status.criticality },
  UI.DataPoint #Total: { Value: totalAmount, Title: '{i18n>TotalAmount}' },
  UI.Identification: [
    { $Type: 'UI.DataFieldForAction', Action: 'WorkshopService.start',    Label: '{i18n>Start}' },
    { $Type: 'UI.DataFieldForAction', Action: 'WorkshopService.complete', Label: '{i18n>Complete}' },
    { $Type: 'UI.DataFieldForAction', Action: 'WorkshopService.invoice',  Label: '{i18n>Invoice}' },
    { $Type: 'UI.DataFieldForAction', Action: 'WorkshopService.cancel',   Label: '{i18n>Cancel}' }
  ],
  UI.Facets: [
    { $Type: 'UI.ReferenceFacet', ID: 'Intake',   Label: '{i18n>Intake}',     Target: '@UI.FieldGroup#Intake' },
    { $Type: 'UI.ReferenceFacet', ID: 'Items',    Label: '{i18n>OrderItems}', Target: 'items/@UI.LineItem' },
    { $Type: 'UI.ReferenceFacet', ID: 'Totals',   Label: '{i18n>Totals}',     Target: '@UI.FieldGroup#Totals' },
    { $Type: 'UI.ReferenceFacet', ID: 'Progress', Label: '{i18n>Progress}',   Target: '@UI.FieldGroup#Progress' },
    { $Type: 'UI.ReferenceFacet', ID: 'Changes',  Label: '{i18n>Changes}',    Target: '@UI.FieldGroup#Changes' }
  ],
  UI.FieldGroup #Intake: { Data: [
    { Value: orderDate },
    { Value: vehicle_ID },
    { Value: customer_ID },
    { Value: mileageAtIntake },
    { Value: mechanic_ID },
    { Value: complaint }
  ]},
  UI.FieldGroup #Totals: { Data: [
    { Value: partsTotal },
    { Value: laborTotal },
    { Value: totalAmount }
  ]},
  UI.FieldGroup #Progress: { Data: [
    { Value: startedAt },
    { Value: completedAt },
    { Value: invoicedAt },
    { Value: cancelledAt },
    { Value: cancellationReason }
  ]},
  UI.FieldGroup #Changes: { Data: [
    { Value: createdBy },
    { Value: createdAt },
    { Value: modifiedBy },
    { Value: modifiedAt }
  ]}
);

// Refresh live values while editing (calculated in srv/handlers/drafts.js)
annotate service.ServiceOrders with @(
  Common.SideEffects #Vehicle:  { SourceProperties: [vehicle_ID],  TargetProperties: ['customer_ID'] },
  Common.SideEffects #Mechanic: { SourceProperties: [mechanic_ID], TargetEntities: [items], TargetProperties: ['partsTotal', 'laborTotal', 'totalAmount'] },
  Common.SideEffects #Items:    { SourceEntities: [items],         TargetEntities: [items], TargetProperties: ['partsTotal', 'laborTotal', 'totalAmount'] }
);
annotate service.ServiceOrderItems with @(
  Common.SideEffects #Price: {
    SourceProperties: [itemType_code, part_ID, quantity],
    TargetProperties: ['unitPrice', 'lineTotal', 'description']
  }
);

// Edit only while work is ongoing, delete only before it has started
annotate service.ServiceOrders with @(
  UI.UpdateHidden: { $edmJson: { $And: [
    { $Ne: [{ $Path: 'status_code' }, 'OPEN'] },
    { $Ne: [{ $Path: 'status_code' }, 'IN_PROGRESS'] }
  ]}},
  UI.DeleteHidden: { $edmJson: { $Ne: [{ $Path: 'status_code' }, 'OPEN'] } }
);

// Action buttons are enabled only on the saved order, in the matching status
annotate service.ServiceOrders actions {
  start @(
    Core.OperationAvailable: { $edmJson: { $And: [{ $Path: 'in/IsActiveEntity' }, { $Eq: [{ $Path: 'in/status_code' }, 'OPEN'] }] } },
    Common.SideEffects.TargetProperties: ['in/status_code', 'in/startedAt']
  );
  complete @(
    Core.OperationAvailable: { $edmJson: { $And: [{ $Path: 'in/IsActiveEntity' }, { $Eq: [{ $Path: 'in/status_code' }, 'IN_PROGRESS'] }] } },
    Common.SideEffects.TargetProperties: ['in/status_code', 'in/completedAt']
  );
  invoice @(
    Core.OperationAvailable: { $edmJson: { $And: [{ $Path: 'in/IsActiveEntity' }, { $Eq: [{ $Path: 'in/status_code' }, 'COMPLETED'] }] } },
    Common.SideEffects.TargetProperties: ['in/status_code', 'in/invoicedAt']
  );
  cancel @(
    Core.OperationAvailable: { $edmJson: { $And: [{ $Path: 'in/IsActiveEntity' }, { $Or: [
      { $Eq: [{ $Path: 'in/status_code' }, 'OPEN'] },
      { $Eq: [{ $Path: 'in/status_code' }, 'IN_PROGRESS'] }
    ]}]}},
    Common.SideEffects.TargetProperties: ['in/status_code', 'in/cancelledAt', 'in/cancellationReason']
  ) (reason @title: '{i18n>Reason}' @UI.MultiLineText);
}

// Items table
annotate service.ServiceOrderItems with @(
  UI.HeaderInfo: {
    TypeName: '{i18n>OrderItem}',
    TypeNamePlural: '{i18n>OrderItems}',
    Title: { Value: description }
  },
  UI.LineItem: [
    { Value: itemType_code },
    { Value: part_ID },
    { Value: description },
    { Value: quantity },
    { Value: unitPrice },
    { Value: lineTotal }
  ]
);
