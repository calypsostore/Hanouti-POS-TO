export type UserRole = 'staff' | 'owner' | 'super_admin';
export type OrderStatus = 'done' | 'pending_void' | 'voided';
export type PaymentMethod = 'cash' | 'card' | 'other';
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
  password: string;
  mustChangePassword: boolean;
  isActive: boolean;
  storeId?: string;
  positionId?: string;
  createdAt: string;
}

export type UserSummary = Omit<UserRecord, 'password'>;

export interface StoreRecord {
  id: string;
  ownerId: string;
  code: string;
  name: string;
  adminPin: string;
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
  outOfStock: boolean;
  isActive: boolean;
}

export interface OrderLineRecord {
  itemId: string;
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
  staffId: string;
  shiftId: string;
  location?: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  items: OrderLineRecord[];
  totalMillimes: number;
  createdAt: string;
  voidRequestedAt?: string;
  voidedAt?: string;
  voidedBy?: string;
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
}

export interface ReportRecord {
  id: string;
  storeId: string;
  type: 'X' | 'Z';
  businessDate: string;
  createdAt: string;
  salesMillimes: number;
  orderCount: number;
  cashDifferenceMillimes: number;
}

export interface AuthSession {
  userId: string;
}
