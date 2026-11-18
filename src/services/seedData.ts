import type {
  CatalogItemRecord,
  CategoryRecord,
  OrderRecord,
  PositionRecord,
  ReportRecord,
  ShiftRecord,
  StoreRecord,
  UserRecord,
} from '../types/domain';

const now = new Date();
const todayAt = (hours: number, minutes: number) => {
  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};

const storeId = 'store-cafe12';
const sarahId = 'staff-sarah';
const abdullahId = 'staff-abdullah';

export const seedStores: StoreRecord[] = [
  {
    id: storeId,
    ownerId: 'owner-lamarsa',
    code: 'cafe12',
    name: 'Café Sidi Bou - Marsa',
    adminPin: '1234',
    isActive: true,
    createdAt: todayAt(6, 0),
  },
];

export const seedPositions: PositionRecord[] = [
  {
    id: 'position-barista',
    storeId,
    name: 'Barista',
    permissionIds: ['take_orders', 'request_void', '86_items', 'open_close_shift', 'view_order_history'],
  },
];

export const seedUsers: UserRecord[] = [
  {
    id: 'super-admin',
    role: 'super_admin',
    name: 'Platform Admin',
    email: 'admin@7anouti.tn',
    password: 'admin123',
    mustChangePassword: true,
    isActive: true,
    createdAt: todayAt(6, 0),
  },
  {
    id: 'owner-lamarsa',
    role: 'owner',
    name: 'Si Mohamed',
    email: 'owner@cafelamarsa.tn',
    password: 'owner123',
    mustChangePassword: true,
    isActive: true,
    storeId,
    createdAt: todayAt(6, 0),
  },
  {
    id: sarahId,
    role: 'staff',
    name: 'Sarah',
    username: 'cafe12.sarah',
    password: '1234',
    mustChangePassword: true,
    isActive: true,
    storeId,
    positionId: 'position-barista',
    createdAt: todayAt(6, 0),
  },
  {
    id: abdullahId,
    role: 'staff',
    name: 'Abdullah',
    username: 'cafe12.abdullah',
    password: '1234',
    mustChangePassword: true,
    isActive: true,
    storeId,
    positionId: 'position-barista',
    createdAt: todayAt(6, 0),
  },
];

const categorySeeds: Omit<CategoryRecord, 'storeId'>[] = [
  { id: 'coffee', name: 'Coffee', icon: 'coffee', sortOrder: 0, isActive: true },
  { id: 'cold-drinks', name: 'Cold Drinks', icon: 'local_cafe', sortOrder: 1, isActive: true },
  { id: 'pastry', name: 'Pastry', icon: 'bakery_dining', sortOrder: 2, isActive: true },
  { id: 'water', name: 'Water', icon: 'water_drop', sortOrder: 3, isActive: true },
  { id: 'food', name: 'Food', icon: 'lunch_dining', sortOrder: 4, isActive: true },
];

export const seedCategories: CategoryRecord[] = categorySeeds.map((category) => ({ ...category, storeId }));

export const seedCatalogItems: CatalogItemRecord[] = [
  { id: 'item-direct', storeId, categoryId: 'coffee', name: 'Café Direct', icon: 'coffee', priceMillimes: 2000, stockCount: null, outOfStock: false, isActive: true },
  { id: 'item-espresso', storeId, categoryId: 'coffee', name: 'Café Express', icon: 'coffee', priceMillimes: 1800, stockCount: null, outOfStock: false, isActive: true },
  { id: 'item-cappuccino', storeId, categoryId: 'coffee', name: 'Cappuccino', icon: 'local_cafe', priceMillimes: 2800, stockCount: null, outOfStock: false, isActive: true },
  { id: 'item-cream', storeId, categoryId: 'coffee', name: 'Café Crème', icon: 'local_cafe', priceMillimes: 2500, stockCount: null, outOfStock: false, isActive: true },
  { id: 'item-croissant', storeId, categoryId: 'pastry', name: 'Croissant Beurre', icon: 'bakery_dining', priceMillimes: 1400, stockCount: 18, outOfStock: false, isActive: true },
  { id: 'item-almond-croissant', storeId, categoryId: 'pastry', name: 'Croissant Amande', icon: 'bakery_dining', priceMillimes: 2200, stockCount: 8, outOfStock: false, isActive: true },
  { id: 'item-strawberry-juice', storeId, categoryId: 'cold-drinks', name: 'Jus de Fraise', icon: 'wine_bar', priceMillimes: 4500, stockCount: 0, outOfStock: true, isActive: true },
  { id: 'item-baguette', storeId, categoryId: 'food', name: 'Baguette Farcie', icon: 'lunch_dining', priceMillimes: 5500, stockCount: 7, outOfStock: false, isActive: true },
  { id: 'item-water', storeId, categoryId: 'water', name: 'Eau 0.5L Safia', icon: 'water_drop', priceMillimes: 1000, stockCount: 24, outOfStock: false, isActive: true },
  { id: 'item-lemonade', storeId, categoryId: 'cold-drinks', name: 'Citronnade Pressée', icon: 'nutrition', priceMillimes: 3500, stockCount: 12, outOfStock: false, isActive: true },
];

const seedShifts: ShiftRecord[] = [
  {
    id: 'shift-sarah-today',
    storeId,
    staffId: sarahId,
    status: 'closed',
    startingCashMillimes: 50000,
    expectedCashMillimes: 56200,
    countedCashMillimes: 56200,
    differenceMillimes: 0,
    openedAt: todayAt(7, 0),
    closedAt: todayAt(13, 0),
  },
  {
    id: 'shift-abdullah-today',
    storeId,
    staffId: abdullahId,
    status: 'closed',
    startingCashMillimes: 50000,
    expectedCashMillimes: 59000,
    countedCashMillimes: 59000,
    differenceMillimes: 0,
    openedAt: todayAt(8, 0),
    closedAt: todayAt(13, 0),
  },
];

const makeLine = (itemId: string, name: string, quantity: number, unitPriceMillimes: number) => ({
  itemId,
  name,
  quantity,
  unitPriceMillimes,
  lineTotalMillimes: quantity * unitPriceMillimes,
  modifiers: [],
});

export const seedOrders: OrderRecord[] = [
  {
    id: 'order-1042',
    number: 1042,
    storeId,
    staffId: sarahId,
    shiftId: seedShifts[0].id,
    location: 'Table 4 • Dine-in',
    status: 'done',
    paymentMethod: 'cash',
    items: [makeLine('item-direct', 'Café Direct', 2, 1800), makeLine('item-almond-croissant', 'Croissant Amande', 1, 2600)],
    totalMillimes: 6200,
    createdAt: todayAt(11, 24),
  },
  {
    id: 'order-1041',
    number: 1041,
    storeId,
    staffId: abdullahId,
    shiftId: seedShifts[1].id,
    location: 'Comptoir • Takeaway',
    status: 'pending_void',
    paymentMethod: 'cash',
    items: [makeLine('item-lemonade', 'Citronnade Pressée', 1, 3500), makeLine('item-baguette', 'Sandwich Thon Spécial', 1, 5500)],
    totalMillimes: 9000,
    createdAt: todayAt(11, 10),
    voidRequestedAt: todayAt(11, 12),
  },
  {
    id: 'order-1040',
    number: 1040,
    storeId,
    staffId: sarahId,
    shiftId: seedShifts[0].id,
    location: 'Terrace • Table 12',
    status: 'voided',
    paymentMethod: 'cash',
    items: [makeLine('item-espresso', 'Café Express', 3, 1800)],
    totalMillimes: 5400,
    createdAt: todayAt(10, 45),
    voidRequestedAt: todayAt(10, 50),
    voidedAt: todayAt(10, 52),
    voidedBy: 'owner',
    voidedByUserId: 'owner-lamarsa',
    voidReason: 'Customer left terrace before serving',
  },
];

export const seedReports: ReportRecord[] = [];

export const seedShiftsForStore = seedShifts;
