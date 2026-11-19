export type UserRole = 'staff' | 'owner' | 'super_admin';
export type OrderStatus = 'done' | 'pending_void' | 'voided';
export type PaymentMethod = 'cash' | 'card' | 'other' | 'tab';
export type ShiftStatus = 'open' | 'closed';

export interface PermissionDefinition {
  id: string;
  group: string;
  label: string;
}

export interface PositionRecord {
  id: string;
  storeId: string;
  name: string;
  permissionIds: string[];
  selfServiceItemIds?: string[];
  selfServiceCategoryIds?: string[];
  maxStaffDrinkQuantityPerShift?: number;
}

export type CompReason = 'dropped' | 'staff_drink' | 'free_customer' | 'remake' | 'other';

export interface CompRecord {
  id: string;
  storeId: string;
  staffId: string;
  shiftId: string;
  itemId: string;
  name: string;
  quantity: number;
  valueMillimes: number;
  reason: CompReason;
  note?: string;
  createdAt: string;
}

export interface PermissionOverrides {
  granted: string[];
  revoked: string[];
}

export interface UserRecord {
  id: string;
  role: UserRole;
  name: string;
  phone?: string;
  notes?: string;
  email?: string;
  username?: string;
  password?: string;
  passwordHash?: string;
  pinHash?: string;
  mustChangePassword: boolean;
  isActive: boolean;
  storeId?: string;
  positionId?: string;
  permissionOverrides?: PermissionOverrides;
  sessionVersion?: number;
  createdAt: string;
}

export type UserSummary = Omit<UserRecord, 'password' | 'passwordHash' | 'pinHash'>;

export interface StoreRecord {
  id: string;
  ownerId: string;
  code: string;
  name: string;
  allowCustomerCreditBalance?: boolean;
  allowCardPayments?: boolean;
  allowOtherPayments?: boolean;
  staffAutoLockMinutes?: number;
  cashOutAlertThresholdMillimes?: number;
  dailySalesTargetMillimes?: number;
  adminPin?: string;
  adminPinHash?: string;
  pinMustChange?: boolean;
  isActive: boolean;
  dayClosedOn?: string;
  createdAt: string;
}

export interface CategoryRecord {
  id: string;
  storeId: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
}

export interface CatalogItemRecord {
  id: string;
  storeId: string;
  categoryId: string;
  name: string;
  icon: string;
  priceMillimes: number;
  stockCount: number | null;
  lowStockThreshold?: number;
  description?: string;
  sku?: string;
  modifiers?: CatalogModifierRecord[];
  modifierGroupName?: string;
  modifiersRequired?: boolean;
  modifierSelectionMode?: 'single' | 'multiple';
  outOfStock: boolean;
  outOfStockBy?: string;
  outOfStockAt?: string;
  isActive: boolean;
}

export interface CatalogModifierRecord {
  id: string;
  name: string;
  priceMillimes: number;
}

export interface OrderLineRecord {
  itemId: string;
  categoryId?: string;
  categoryName?: string;
  name: string;
  quantity: number;
  unitPriceMillimes: number;
  lineTotalMillimes: number;
  modifiers: string[];
}

export interface OrderRecord {
  id: string;
  number: number;
  storeId: string;
  storeName?: string;
  staffId: string;
  staffName?: string;
  shiftId: string;
  location?: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  customerId?: string;
  note?: string;
  items: OrderLineRecord[];
  totalMillimes: number;
  createdAt: string;
  voidRequestedAt?: string;
  voidedAt?: string;
  voidedBy?: string;
  voidedByUserId?: string;
  voidReason?: string;
}

export interface ShiftRecord {
  id: string;
  storeId: string;
  staffId: string;
  status: ShiftStatus;
  startingCashMillimes: number;
  countedCashMillimes?: number;
  expectedCashMillimes?: number;
  differenceMillimes?: number;
  openedAt: string;
  closedAt?: string;
  forceClosedByOwner?: boolean;
  closedByUserId?: string;
  differenceNote?: string;
  voidAdjustments?: ShiftVoidAdjustment[];
}

export type CashMovementReason = 'supplier' | 'change' | 'expense' | 'other';

export interface CashMovementRecord {
  id: string;
  storeId: string;
  shiftId: string;
  staffId: string;
  kind: 'in' | 'out';
  amountMillimes: number;
  reason: CashMovementReason;
  note?: string;
  createdAt: string;
}

export interface SupplierRecord {
  id: string;
  storeId: string;
  name: string;
  phone?: string;
  notes?: string;
}

export type ExpenseCategory = 'rent' | 'electricity' | 'water' | 'supplier' | 'salary' | 'other';

export interface ExpenseRecord {
  id: string;
  storeId: string;
  category: ExpenseCategory;
  supplierId?: string;
  amountMillimes: number;
  paidMillimes: number;
  date: string;
  note?: string;
  createdBy: string;
}

export interface SupplierPaymentRecord {
  id: string;
  supplierId: string;
  expenseId?: string;
  amountMillimes: number;
  date: string;
}

export interface ScheduleShiftRecord {
  id: string;
  storeId: string;
  staffId: string;
  date: string;
  startTime: string;
  endTime: string;
  note?: string;
  publishedAt?: string;
}

export interface ScheduleTemplateRecord {
  id: string;
  storeId: string;
  name: string;
  startTime: string;
  endTime: string;
}

export interface NotificationRecord {
  id: string;
  storeId: string;
  staffId: string;
  type: 'schedule_published' | 'customer_credit_warning' | 'customer_credit_limit' | 'customer_overdue' | 'stock_depleted' | 'cash_out_alert';
  title: string;
  message: string;
  createdAt: string;
  customerId?: string;
  catalogItemId?: string;
  shiftId?: string;
  cashMovementId?: string;
  dueAt?: string;
  readAt?: string;
}

export interface ShiftVoidAdjustment {
  orderId: string;
  orderNumber: number;
  amountMillimes: number;
  createdAt: string;
}

export interface ReportCategoryLine {
  categoryId: string;
  name: string;
  quantity: number;
  totalMillimes: number;
}

export interface ReportItemLine {
  itemId: string;
  name: string;
  quantity: number;
  totalMillimes: number;
}

export interface ReportVoidLine {
  ticketNumber: number;
  reason: string;
  totalMillimes: number;
  approvedBy?: string;
}

export interface ReportCompLine {
  staffName: string;
  itemName: string;
  quantity: number;
  valueMillimes: number;
  reason: CompReason;
  note?: string;
  createdAt?: string;
}

export interface ReportCustomerTabLine {
  customerId: string;
  customerName: string;
  issuedMillimes: number;
  paymentsMillimes: number;
  outstandingMillimes: number;
}

export interface ReportCashOutLine {
  shiftId: string;
  staffName: string;
  reason: CashMovementReason;
  amountMillimes: number;
  note?: string;
  createdAt: string;
}

export interface ReportShiftLine {
  shiftId: string;
  staffName: string;
  status?: 'in_progress' | 'closed';
  openedAt: string;
  closedAt?: string;
  startingCashMillimes: number;
  cashSalesMillimes?: number;
  tabPaymentsMillimes?: number;
  cashInMillimes?: number;
  cashOutMillimes?: number;
  expectedCashMillimes?: number;
  countedCashMillimes?: number;
  differenceMillimes?: number;
  forceClosedByOwner: boolean;
  voidAdjustmentMillimes?: number;
}

export interface ReportRecord {
  id: string;
  storeId: string;
  storeName?: string;
  type: 'X' | 'Z';
  businessDate: string;
  createdAt: string;
  salesMillimes: number;
  salesCollectedMillimes?: number;
  expensesMillimes?: number;
  netProfitMillimes?: number;
  receivableMillimes?: number;
  orderCount: number;
  cashDifferenceMillimes: number;
  zNumber?: number;
  periodFrom?: string;
  periodTo?: string;
  generatedBy?: string;
  salesByCategory?: ReportCategoryLine[];
  itemsSold?: ReportItemLine[];
  voids?: { count: number; totalMillimes: number; orders: ReportVoidLine[] };
  comps?: { count: number; quantity: number; totalMillimes: number; records: ReportCompLine[] };
  shifts?: ReportShiftLine[];
  paymentSplit?: Record<PaymentMethod, number>;
  totalExpectedCashMillimes?: number;
  totalCountedMillimes?: number;
  totalDifferenceMillimes?: number;
  cashSalesMillimes?: number;
  tabSalesMillimes?: number;
  tabPaymentsReceivedMillimes?: number;
  cashFloatMillimes?: number;
  cashOuts?: ReportCashOutLine[];
  customerTabs?: ReportCustomerTabLine[];
  tabsIssuedMillimes?: number;
  tabsSettledMillimes?: number;
  tabsOutstandingMillimes?: number;
}

export interface CustomerRecord {
  id: string;
  storeId: string;
  name: string;
  phone?: string;
  email?: string;
  notes?: string;
  creditLimitMillimes?: number;
  settlementTerms: 'weekly' | 'monthly' | 'anytime';
  isActive: boolean;
  lastPaymentAt?: string;
  createdAt: string;
}

export interface TabRecord {
  id: string;
  storeId: string;
  customerId: string;
  orderId?: string;
  shiftId: string;
  staffId: string;
  kind: 'issued' | 'settled' | 'reversal';
  amountMillimes: number;
  note?: string;
  reversesTabId?: string;
  createdAt: string;
}

export interface ActivityRecord {
  id: string;
  storeId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  summary: string;
  entityType: string;
  entityId: string;
  meta: {
    before?: unknown;
    after?: unknown;
    [key: string]: unknown;
  };
  createdAt: string;
}

export interface AuthSession {
  userId: string;
  sessionVersion?: number;
  locked?: boolean;
}
