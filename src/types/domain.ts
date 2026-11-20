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
  mustSetPin?: boolean;
  isActive: boolean;
  storeId?: string;
  positionId?: string;
  permissionOverrides?: PermissionOverrides;
  sessionVersion?: number;
  createdAt: string;
}

export type UserSummary = Omit<UserRecord, 'password' | 'passwordHash' | 'pinHash'>;

export type SettlementTerms = 'weekly' | 'monthly' | 'anytime';
export type NotificationType =
  | 'void_requested'
  | 'void_approved'
  | 'void_rejected'
  | 'schedule_published'
  | 'customer_credit_warning'
  | 'customer_credit_limit'
  | 'customer_overdue'
  | 'stock_depleted'
  | 'item_86'
  | 'low_stock'
  | 'shift_opened'
  | 'shift_closed'
  | 'cash_difference'
  | 'cash_out_alert'
  | 'z_report_closed'
  | 'app_update'
  | 'subscription_expiring';

export interface StoreSettings {
  defaultSettlementTerms: SettlementTerms;
  notificationPreferences: Partial<Record<NotificationType, boolean>>;
  quickPickMode: QuickPickMode;
  quickPickItemIds: string[];
  ticketHeaderText: string[];
  ticketFooterText: string[];
  reportFooterText: string[];
  storeLogoId: string;
  showLogo: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showStaffName: boolean;
  showDateTime: boolean;
  paperWidth: 58 | 80;
}

export type QuickPickMode = 'auto' | 'manual';

export type SubscriptionPlan = 'trial' | 'monthly' | 'yearly';

export interface StoreSubscription {
  plan: SubscriptionPlan;
  paidUntil: string | null;
  notes: string;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: Record<NotificationType, boolean> = {
  void_requested: true,
  void_approved: true,
  void_rejected: true,
  schedule_published: true,
  customer_credit_warning: true,
  customer_credit_limit: true,
  customer_overdue: true,
  stock_depleted: true,
  item_86: true,
  low_stock: true,
  shift_opened: true,
  shift_closed: true,
  cash_difference: true,
  cash_out_alert: true,
  z_report_closed: true,
  app_update: true,
  subscription_expiring: true,
};

export function resolveStoreSettings(settings?: Partial<StoreSettings>): StoreSettings {
  return {
    defaultSettlementTerms: settings?.defaultSettlementTerms ?? 'monthly',
    notificationPreferences: {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      ...settings?.notificationPreferences,
    },
    quickPickMode: settings?.quickPickMode === 'manual' ? 'manual' : 'auto',
    quickPickItemIds: Array.isArray(settings?.quickPickItemIds)
      ? [...new Set(settings.quickPickItemIds.filter((id) => typeof id === 'string' && id.trim()))]
      : [],
    ticketHeaderText: settings?.ticketHeaderText?.slice(0, 2).map((line) => line.slice(0, 60)) ?? [],
    ticketFooterText: settings?.ticketFooterText?.slice(0, 2).map((line) => line.slice(0, 60)) ?? ['Thank you'],
    reportFooterText: settings?.reportFooterText?.slice(0, 2).map((line) => line.slice(0, 60)) ?? [],
    storeLogoId: typeof settings?.storeLogoId === 'string' ? settings.storeLogoId : '',
    showLogo: settings?.showLogo ?? true,
    showAddress: settings?.showAddress ?? true,
    showPhone: settings?.showPhone ?? true,
    showStaffName: settings?.showStaffName ?? true,
    showDateTime: settings?.showDateTime ?? true,
    paperWidth: settings?.paperWidth === 58 ? 58 : 80,
  };
}

export interface StoreRecord {
  id: string;
  ownerId: string;
  code: string;
  name: string;
  timezone?: string;
  address?: string;
  phone?: string;
  taxId?: string;
  allowCustomerCreditBalance?: boolean;
  allowCardPayments?: boolean;
  allowOtherPayments?: boolean;
  settings?: StoreSettings;
  subscription?: StoreSubscription;
  archivedAt?: string;
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

export function isSubscriptionExpired(store: StoreRecord, now = new Date()): boolean {
  const paidUntil = store.subscription?.paidUntil;
  if (!paidUntil) return false;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return paidUntil < today;
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

export interface ItemHistoryRecord {
  id: string;
  itemId: string;
  field: 'price' | 'name' | 'category' | 'stockTracking' | 'outOfStock';
  oldValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
  changedBy: string;
  changedAt: string;
  reason?: 'restock' | 'correction' | 'waste';
}

export type StockAdjustmentReason = 'restock' | 'correction' | 'waste';

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
  idempotencyKey?: string;
  syncStatus?: 'queued' | 'needs_attention';
  verificationStatus?: 'to_verify';
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
  voidsAutoApprovedCount?: number;
  pendingVoidCount?: number;
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
  storeId?: string;
  userId?: string;
  targetRole?: UserRole;
  type: NotificationType;
  title: string;
  body: string;
  createdAt: string;
  entityType?: string;
  entityId?: string;
  readAt?: string;
  staffId?: string;
  message?: string;
  customerId?: string;
  catalogItemId?: string;
  shiftId?: string;
  cashMovementId?: string;
  dueAt?: string;
}

export interface ShiftVoidAdjustment {
  orderId: string;
  orderNumber: number;
  kind: 'requested' | 'rejected' | 'approved';
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
  categoryId?: string;
  categoryName?: string;
  unitPriceMillimes?: number;
}

export interface ReportVoidLine {
  ticketNumber: number;
  reason: string;
  totalMillimes: number;
  approvedBy?: string;
  autoApprovedAtForcedClose?: boolean;
}

export interface ReportVoidAdjustmentLine {
  shiftId: string;
  staffName: string;
  orderNumber: number;
  kind: 'requested' | 'rejected' | 'approved';
  amountMillimes: number;
  createdAt: string;
}

export interface ReportPendingVoidLine {
  ticketNumber: number;
  staffName: string;
  shiftId: string;
  amountMillimes: number;
  paymentMethod: PaymentMethod;
  reason: string;
  requestedAt: string;
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

export interface ReportExpenseLine {
  expenseId: string;
  category: ExpenseCategory;
  amountMillimes: number;
  paidMillimes: number;
  date: string;
  supplierId?: string;
  note?: string;
  createdBy: string;
}

export interface ReportCashMovementLine {
  shiftId: string;
  staffName: string;
  kind: 'in' | 'out';
  reason: CashMovementReason;
  amountMillimes: number;
  note?: string;
  createdAt: string;
}

export interface ReportEmployeeLine {
  staffId: string;
  name: string;
  orderCount: number;
  salesMillimes: number;
}

export interface ReportShiftLine {
  shiftId: string;
  staffName: string;
  orderCount?: number;
  status?: 'in_progress' | 'closed';
  openedAt: string;
  closedAt?: string;
  startingCashMillimes: number;
  cashSalesMillimes?: number;
  cardSalesMillimes?: number;
  otherSalesMillimes?: number;
  tabSalesMillimes?: number;
  tabPaymentsMillimes?: number;
  cashInMillimes?: number;
  cashOutMillimes?: number;
  expectedCashMillimes?: number;
  cashFlowExFloatMillimes?: number;
  countedCashMillimes?: number;
  differenceMillimes?: number;
  forceClosedByOwner: boolean;
  voidsAutoApprovedCount?: number;
  voidAdjustmentMillimes?: number;
  voidRequestsMillimes?: number;
  voidRejectionsMillimes?: number;
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
  reportNumber?: string;
  dayOpenedAt?: string;
  dayClosedAt?: string;
  firstTicketNumber?: number;
  lastTicketNumber?: number;
  grossMillimes?: number;
  discountsMillimes?: number;
  netMillimes?: number;
  countedCashMillimes?: number;
  countedCash?: number;
  cashDifference?: number;
  cashDifferenceNote?: string;
  pinVerified?: boolean;
  frozenStoreName?: string;
  frozenStoreAddress?: string;
  frozenStorePhone?: string;
  frozenStoreTaxId?: string;
  frozenSettings?: Partial<StoreSettings>;
  frozenReportFooterText?: string[];
  frozenPaperWidth?: 58 | 80;
  periodFrom?: string;
  periodTo?: string;
  generatedBy?: string;
  salesByCategory?: ReportCategoryLine[];
  itemsSold?: ReportItemLine[];
  voids?: { count: number; totalMillimes: number; orders: ReportVoidLine[] };
  pendingVoids?: { count: number; totalMillimes: number; orders: ReportPendingVoidLine[] };
  voidAdjustments?: ReportVoidAdjustmentLine[];
  expenseDetails?: ReportExpenseLine[];
  comps?: { count: number; quantity: number; totalMillimes: number; records: ReportCompLine[] };
  shifts?: ReportShiftLine[];
  paymentSplit?: Record<PaymentMethod, number>;
  totalExpectedCashMillimes?: number;
  expectedCashExFloatMillimes?: number;
  totalCountedMillimes?: number;
  totalDifferenceMillimes?: number;
  cashSalesMillimes?: number;
  tabSalesMillimes?: number;
  tabPaymentsReceivedMillimes?: number;
  cashFloatMillimes?: number;
  cashInMillimes?: number;
  cashOutMillimes?: number;
  cashRefundsMillimes?: number;
  cashMovements?: ReportCashMovementLine[];
  cashOuts?: ReportCashOutLine[];
  employeeBreakdown?: ReportEmployeeLine[];
  customerTabs?: ReportCustomerTabLine[];
  tabsIssuedMillimes?: number;
  tabsSettledMillimes?: number;
  nonCashTabPaymentsMillimes?: number;
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
  settlementTerms: SettlementTerms;
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
  paymentMethod: Exclude<PaymentMethod, 'tab'>;
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
  expiresAt?: number;
}
