using WorkshopService as service from '../srv/workshop-service';

// Labels, texts and value helps shared by all apps

annotate service.Customers with {
  ID        @Core.Computed  @Common.Text: fullName  @Common.TextArrangement: #TextOnly;
  firstName @title: '{i18n>FirstName}';
  lastName  @title: '{i18n>LastName}';
  fullName  @title: '{i18n>FullName}';
  email     @title: '{i18n>Email}';
  phone     @title: '{i18n>Phone}';
}

annotate service.Vehicles with {
  ID                    @Core.Computed                     @Common.Text: licensePlate    @Common.TextArrangement: #TextOnly;
  make                  @title: '{i18n>Make}';
  model                 @title: '{i18n>Model}';
  year                  @title: '{i18n>Year}';
  mileage               @title: '{i18n>Mileage}';
  serviceIntervalMonths @title: '{i18n>ServiceInterval}';
  lastServiceDate       @title: '{i18n>LastServiceDate}';
  nextServiceDue        @title: '{i18n>NextServiceDue}';
  owner                 @title           : '{i18n>Owner}'  @Common.Text: owner.fullName  @Common.TextArrangement: #TextOnly
                        @Common.ValueList: {
    CollectionPath: 'Customers',
    Parameters    : [
      {
        $Type            : 'Common.ValueListParameterInOut',
        LocalDataProperty: owner_ID,
        ValueListProperty: 'ID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'phone'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'email'
      }
    ]
  };
}

annotate service.Mechanics with {
  ID             @Common.Text: fullName  @Common.TextArrangement: #TextOnly;
  firstName      @title: '{i18n>FirstName}';
  lastName       @title: '{i18n>LastName}';
  fullName       @title: '{i18n>FullName}';
  specialization @title: '{i18n>Specialization}';
  hourlyRate     @title: '{i18n>HourlyRate}';
  isActive       @title: '{i18n>IsActive}';
}

annotate service.Parts with {
  ID           @Common.Text: name  @Common.TextArrangement: #TextOnly;
  name         @title: '{i18n>Name}';
  description  @title: '{i18n>Description}';
  unitPrice    @title: '{i18n>UnitPrice}';
  stock        @title: '{i18n>Stock}';
  minStock     @title: '{i18n>MinStock}';
  needsReorder @title: '{i18n>NeedsReorder}';
}

annotate service.ServiceOrders with {
  orderNumber        @title: '{i18n>OrderNumber}';
  orderDate          @title: '{i18n>OrderDate}';
  status             @title           : '{i18n>Status}'     @Common.Text: status.name           @Common.TextArrangement: #TextOnly
                     @Common.ValueListWithFixedValues;
  vehicle            @title           : '{i18n>Vehicle}'    @Common.Text: vehicle.licensePlate  @Common.TextArrangement: #TextOnly
                     @Common.ValueList: {
    CollectionPath: 'Vehicles',
    Parameters    : [
      {
        $Type            : 'Common.ValueListParameterInOut',
        LocalDataProperty: vehicle_ID,
        ValueListProperty: 'ID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'make'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'model'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'mileage'
      }
    ]
  };
  customer           @title           : '{i18n>Customer}'   @Common.Text: customer.fullName     @Common.TextArrangement: #TextOnly
                     @Common.ValueList: {
    CollectionPath: 'Customers',
    Parameters    : [
      {
        $Type            : 'Common.ValueListParameterInOut',
        LocalDataProperty: customer_ID,
        ValueListProperty: 'ID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'phone'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'email'
      }
    ]
  };
  mechanic           @title           : '{i18n>Mechanic}'   @Common.Text: mechanic.fullName     @Common.TextArrangement: #TextOnly
                     @Common.ValueList: {
    CollectionPath: 'Mechanics',
    Parameters    : [
      {
        $Type            : 'Common.ValueListParameterInOut',
        LocalDataProperty: mechanic_ID,
        ValueListProperty: 'ID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'specialization'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'hourlyRate'
      },
      {
        $Type            : 'Common.ValueListParameterConstant',
        ValueListProperty: 'isActive',
        Constant         : 'true'
      }
    ]
  };
  complaint          @title           : '{i18n>Complaint}'  @UI.MultiLineText;
  mileageAtIntake    @title: '{i18n>MileageAtIntake}';
  startedAt          @title: '{i18n>StartedAt}';
  completedAt        @title: '{i18n>CompletedAt}';
  invoicedAt         @title: '{i18n>InvoicedAt}';
  cancelledAt        @title: '{i18n>CancelledAt}';
  cancellationReason @title: '{i18n>CancellationReason}';
  partsTotal         @title: '{i18n>PartsTotal}';
  laborTotal         @title: '{i18n>LaborTotal}';
  totalAmount        @title: '{i18n>TotalAmount}';
}

annotate service.ServiceOrderItems with {
  ID          @UI.Hidden;
  order       @UI.Hidden;
  itemType    @title           : '{i18n>ItemType}'  @Common.Text: itemType.name  @Common.TextArrangement: #TextOnly
              @Common.ValueListWithFixedValues;
  part        @title           : '{i18n>Part}'      @Common.Text: part.name      @Common.TextArrangement: #TextOnly
              @Common.ValueList: {
    CollectionPath: 'Parts',
    Parameters    : [
      {
        $Type            : 'Common.ValueListParameterInOut',
        LocalDataProperty: part_ID,
        ValueListProperty: 'ID'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'partNumber'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'unitPrice'
      },
      {
        $Type            : 'Common.ValueListParameterDisplayOnly',
        ValueListProperty: 'stock'
      }
    ]
  };
  description @title: '{i18n>Description}';
  quantity    @title: '{i18n>Quantity}';
  unitPrice   @title: '{i18n>UnitPrice}';
  lineTotal   @title: '{i18n>LineTotal}';
}

annotate service.OrderStatus with {
  code  @Common.Text: name  @Common.TextArrangement: #TextOnly;
}

annotate service.ItemTypes with {
  code  @Common.Text: name  @Common.TextArrangement: #TextOnly;
}
