import type { PaymentMethod, ReportRecord, ReportShiftLine, TabRecord } from '../types/domain';
import { catalogService } from './catalogService';
import { orderService } from './orderService';
import { shiftService } from './shiftService';
import { userService } from './userService';
import { readData, writeData } from './storage';
import { seedReports } from './seedData';

const getReports = () => readData('reports', seedReports);
const todayKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

function getRangeStart(period: 'day' | 'week' | 'month' | 'year'): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else if (period === 'month') start.setDate(1);
  else if (period === 'year') start.setMonth(0, 1);
  return start;
}

function sinceLastZ(storeId: string): string {
  const previous = getReports().filter((report) => report.storeId === storeId && report.type === 'Z')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (previous) return previous.createdAt;
  return getRangeStart('day').toISOString();
}

async function summarize(storeId: string, from: number, to: number) {
  const allOrders = await orderService.listAll(storeId);
  const periodOrders = allOrders.filter((order) => {
      const timestamp = new Date(order.createdAt).getTime();
      return timestamp >= from && timestamp <= to;
    });
  const orders = periodOrders.filter((order) => order.status === 'done');
  const voidedOrders = allOrders.filter((order) => {
    const voidedAt = new Date(order.voidedAt ?? order.createdAt).getTime();
    return order.status === 'voided' && voidedAt >= from && voidedAt <= to;
  });
  const [shifts, categories, catalogItems, staff] = await Promise.all([
    shiftService.listShifts(storeId),
    catalogService.listCategories(storeId),
    catalogService.listItems(storeId),
    userService.listUsers(storeId),
  ]);
  const includedShifts = shifts.filter((shift) => {
    const opened = new Date(shift.openedAt).getTime();
    const closed = shift.closedAt ? new Date(shift.closedAt).getTime() : Number.POSITIVE_INFINITY;
    const adjustedInPeriod = (shift.voidAdjustments ?? []).some((adjustment) => {
      const timestamp = new Date(adjustment.createdAt).getTime();
      return timestamp >= from && timestamp <= to;
    });
    return (opened <= to && closed >= from) || adjustedInPeriod;
  });
  const shiftLines: ReportShiftLine[] = await Promise.all(includedShifts.map(async (shift) => {
    const inProgress = shift.status === 'open';
    const periodAdjustments = (shift.voidAdjustments ?? []).filter((adjustment) => {
      const timestamp = new Date(adjustment.createdAt).getTime();
      return timestamp >= from && timestamp <= to;
    });
    const voidAdjustmentMillimes = periodAdjustments.reduce((sum, adjustment) => sum + adjustment.amountMillimes, 0);
    const cashSales = inProgress ? 0 : await orderService.getCashSalesForShift(shift.id);
    const expected = inProgress ? undefined : (shift.expectedCashMillimes ?? shift.startingCashMillimes + cashSales) + voidAdjustmentMillimes;
    const counted = shift.countedCashMillimes;
    const staffName = staff.find((user) => user.id === shift.staffId)?.name ?? 'Staff';
    return {
      shiftId: shift.id,
      staffName,
      status: inProgress ? 'in_progress' : 'closed',
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      startingCashMillimes: shift.startingCashMillimes,
      expectedCashMillimes: expected,
      countedCashMillimes: inProgress ? undefined : counted,
      differenceMillimes: inProgress ? undefined : (counted ?? 0) - (expected ?? 0),
      forceClosedByOwner: shift.forceClosedByOwner ?? false,
      voidAdjustmentMillimes: voidAdjustmentMillimes || undefined,
    };
  }));
  const itemIndex = new Map(catalogItems.map((item) => [item.id, item]));
  const categoryIndex = new Map(categories.map((category) => [category.id, category]));
  const categoryTotals = new Map<string, { name: string; quantity: number; totalMillimes: number }>();
  const itemTotals = new Map<string, { name: string; quantity: number; totalMillimes: number }>();
  for (const order of orders) {
    for (const line of order.items) {
      const catalogItem = itemIndex.get(line.itemId);
      const categoryId = line.categoryId ?? catalogItem?.categoryId ?? 'other';
      const categoryName = line.categoryName ?? categoryIndex.get(categoryId)?.name ?? 'Other';
      const category = categoryTotals.get(categoryId) ?? { name: categoryName, quantity: 0, totalMillimes: 0 };
      category.quantity += line.quantity;
      category.totalMillimes += line.lineTotalMillimes;
      categoryTotals.set(categoryId, category);
      const item = itemTotals.get(line.itemId) ?? { name: line.name, quantity: 0, totalMillimes: 0 };
      item.quantity += line.quantity;
      item.totalMillimes += line.lineTotalMillimes;
      itemTotals.set(line.itemId, item);
    }
  }
  const paymentSplit: Record<PaymentMethod, number> = { cash: 0, card: 0, other: 0, tab: 0 };
  for (const order of orders) paymentSplit[order.paymentMethod] += order.totalMillimes;
  const settlements = readData<TabRecord[]>('tabs', []).filter((tab) =>
    tab.storeId === storeId && tab.kind === 'settled' &&
    new Date(tab.createdAt).getTime() >= from && new Date(tab.createdAt).getTime() <= to,
  );
  const tabsIssuedMillimes = orders.filter((order) => order.paymentMethod === 'tab').reduce((sum, order) => sum + order.totalMillimes, 0);
  const tabsSettledMillimes = settlements.reduce((sum, tab) => sum + tab.amountMillimes, 0);
  const customers = readData<import('../types/domain').CustomerRecord[]>('customers', []).filter((customer) => customer.storeId === storeId);
  const allSettlements = readData<TabRecord[]>('tabs', []).filter((tab) => tab.storeId === storeId && tab.kind === 'settled');
  const tabsOutstandingMillimes = customers.reduce((total, customer) => {
    const issued = allOrders.filter((order) => order.customerId === customer.id && order.paymentMethod === 'tab' && order.status === 'done')
      .reduce((sum, order) => sum + order.totalMillimes, 0);
    const settled = allSettlements.filter((tab) => tab.customerId === customer.id).reduce((sum, tab) => sum + tab.amountMillimes, 0);
    return total + issued - settled;
  }, 0);
  const salesMillimes = orders.reduce((sum, order) => sum + order.totalMillimes, 0);
  const closedShiftLines = shiftLines.filter((shift) => shift.status !== 'in_progress');
  const cashDifferenceMillimes = closedShiftLines.reduce((sum, shift) => sum + (shift.differenceMillimes ?? 0), 0);
  return {
    salesMillimes,
    orderCount: orders.length,
    cashDifferenceMillimes,
    topItems: [...itemTotals.values()].reduce<Record<string, number>>((totals, item) => {
      totals[item.name] = (totals[item.name] ?? 0) + item.quantity;
      return totals;
    }, {}),
    shifts: includedShifts,
    salesByCategory: [...categoryTotals].map(([categoryId, value]) => ({ categoryId, ...value })),
    itemsSold: [...itemTotals].map(([itemId, value]) => ({ itemId, ...value })),
    voids: {
      count: voidedOrders.length,
      totalMillimes: voidedOrders.reduce((sum, order) => sum + order.totalMillimes, 0),
      orders: voidedOrders.map((order) => ({ ticketNumber: order.number, reason: order.voidReason ?? '', totalMillimes: order.totalMillimes })),
    },
    shiftLines,
    paymentSplit,
    totalExpectedCashMillimes: closedShiftLines.reduce((sum, shift) => sum + (shift.expectedCashMillimes ?? 0), 0),
    totalCountedMillimes: closedShiftLines.reduce((sum, shift) => sum + (shift.countedCashMillimes ?? 0), 0),
    totalDifferenceMillimes: cashDifferenceMillimes,
    tabsIssuedMillimes,
    tabsSettledMillimes,
    tabsOutstandingMillimes,
  };
}

async function createReport(storeId: string, type: 'X' | 'Z', generatedBy: string): Promise<ReportRecord> {
  const store = await userService.getStore(storeId);
  if (!store) throw new Error('The store could not be found.');
  const createdAt = new Date().toISOString();
  const periodFrom = sinceLastZ(storeId);
  const summary = await summarize(storeId, new Date(periodFrom).getTime(), Date.now());
  const zNumber = type === 'Z'
    ? Math.max(0, ...getReports().filter((report) => report.storeId === storeId && report.type === 'Z').map((report) => report.zNumber ?? 0)) + 1
    : undefined;
  const report: ReportRecord = {
    id: `report-${crypto.randomUUID()}`,
    storeId,
    storeName: store.name,
    type,
    businessDate: todayKey(),
    createdAt,
    salesMillimes: summary.salesMillimes,
    orderCount: summary.orderCount,
    cashDifferenceMillimes: summary.cashDifferenceMillimes,
    zNumber,
    periodFrom,
    periodTo: createdAt,
    generatedBy,
    salesByCategory: summary.salesByCategory,
    itemsSold: summary.itemsSold,
    voids: summary.voids,
    shifts: summary.shiftLines,
    paymentSplit: summary.paymentSplit,
    totalExpectedCashMillimes: summary.totalExpectedCashMillimes,
    totalCountedMillimes: summary.totalCountedMillimes,
    totalDifferenceMillimes: summary.totalDifferenceMillimes,
    tabsIssuedMillimes: summary.tabsIssuedMillimes,
    tabsSettledMillimes: summary.tabsSettledMillimes,
    tabsOutstandingMillimes: summary.tabsOutstandingMillimes,
  };
  writeData('reports', [...getReports(), report]);
  return report;
}

export const reportService = {
  async getCurrentPeriodSummary(storeId: string) {
    return await summarize(storeId, new Date(sinceLastZ(storeId)).getTime(), Date.now());
  },

  async getDashboard(storeId: string, period: 'day' | 'week' | 'month' | 'year' = 'day') {
    const from = getRangeStart(period).getTime();
    return await summarize(storeId, from, Date.now());
  },

  async listReports(storeId: string): Promise<ReportRecord[]> {
    return getReports().filter((report) => report.storeId === storeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createXReport(storeId: string, generatedBy = 'Owner'): Promise<ReportRecord> {
    return createReport(storeId, 'X', generatedBy);
  },

  async closeDayWithZReport(storeId: string, generatedBy = 'Owner', ownerPin?: string): Promise<ReportRecord> {
    if ((await shiftService.listOpenShifts(storeId)).length > 0) throw new Error('Force-close or close every shift before creating a Z report.');
    const store = await userService.getStore(storeId);
    if (!store) throw new Error('The store could not be found.');
    if (store.dayClosedOn === todayKey()) {
      if (!ownerPin) throw new Error('Owner PIN is required to create another Z report today.');
      if (!await userService.verifyStorePin(storeId, ownerPin)) throw new Error('The owner PIN is incorrect.');
    }
    const report = await createReport(storeId, 'Z', generatedBy);
    writeData('stores', (await userService.listStores()).map((candidate) => candidate.id === storeId ? { ...candidate, dayClosedOn: todayKey() } : candidate));
    return report;
  },
};
