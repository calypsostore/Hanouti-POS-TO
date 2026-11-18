export type UserRole = 'staff' | 'owner' | 'super_admin';
export type OrderStatus = 'done' | 'pending_void' | 'voided';
export type PaymentMethod = 'cash' | 'card' | 'other' | 'tab';
export type ShiftStatus = 'open' | 'closed';

export interface PermissionDefinition {
  id: string;
  label: string;
}

export interface PositionRecord {
  id: string;
  storeId: string;
  name: string;
  permissionIds: string[];
}

export interface UserRecord {
  id: string;
  role: UserRole;
  name: string;
  email?: string;
  username?: string;
  password?: string;
  passwordHash?: string;
  mustChangePassword: boolean;
  isActive: boolean;
  storeId?: string;
  positionId?: string;
  createdAt: string;
}

export type UserSummary = Omit<UserRecord, 'password' | 'passwordHash'>;

export interface StoreRecord {
  id: string;
  ownerId: string;
  code: string;
  name: string;
  adminPin?: string;
  adminPinHash?: string;
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
  modifiers?: CatalogModifierRecord[];
  outOfStock: boolean;
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
}

export interface ReportShiftLine {
  shiftId: string;
  staffName: string;
  openedAt: string;
  closedAt?: string;
  startingCashMillimes: number;
  expectedCashMillimes: number;
  countedCashMillimes?: number;
  differenceMillimes?: number;
  forceClosedByOwner: boolean;
}

export interface ReportRecord {
  id: string;
  storeId: string;
  storeName?: string;
  type: 'X' | 'Z';
  businessDate: string;
  createdAt: string;
  salesMillimes: number;
  orderCount: number;
  cashDifferenceMillimes: number;
  zNumber?: number;
  periodFrom?: string;
  periodTo?: string;
  generatedBy?: string;
  salesByCategory?: ReportCategoryLine[];
  itemsSold?: ReportItemLine[];
  voids?: { count: number; totalMillimes: number; orders: ReportVoidLine[] };
  shifts?: ReportShiftLine[];
  paymentSplit?: Record<PaymentMethod, number>;
  totalExpectedCashMillimes?: number;
  totalCountedMillimes?: number;
  totalDifferenceMillimes?: number;
  tabsIssuedMillimes?: number;
  tabsSettledMillimes?: number;
  tabsOutstandingMillimes?: number;
}

export interface CustomerRecord {
  id: string;
  storeId: string;
  name: string;
  phone?: string;
  createdAt: string;
}

export interface TabRecord {
  id: string;
  storeId: string;
  customerId: string;
  orderId?: string;
  shiftId: string;
  staffId: string;
  kind: 'issued' | 'settled';
  amountMillimes: number;
  createdAt: string;
}

export interface AuthSession {
  userId: string;
}
