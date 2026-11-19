import type {
  PaymentMethod,
  ReportCashOutLine,
  ReportCustomerTabLine,
  ReportRecord,
  ReportShiftLine,
  TabRecord,
} from '../types/domain';
import { catalogService } from './catalogService';
import { compService } from './compService';
import { orderService } from './orderService';
import { shiftService } from './shiftService';
import { userService } from './userService';
import { readData, writeData } from './storage';
import { seedReports } from './seedData';
import { activityService } from './activityService';
import { expenseService } from './expenseService';

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
  const [shifts, categories, catalogItems, staff, allComps, cashMovements, expenses] = await Promise.all([
    shiftService.listShifts(storeId),
    catalogService.listCategories(storeId),
    catalogService.listItems(storeId),
    userService.listUsers(storeId),
    compService.listComps(storeId),
    shiftService.listCashMovements(storeId),
    expenseService.listForRange(storeId, from, to),
  ]);
  const compRecords = allComps.filter((comp) => {
    const timestamp = new Date(comp.createdAt).getTime();
    return timestamp >= from && timestamp <= to;
  });
  const staffById = new Map(staff.map((user) => [user.id, user]));
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
    const voidAdjustmentMillimes = (shift.voidAdjustments ?? [])
      .reduce((sum, adjustment) => sum + adjustment.amountMillimes, 0);
    const [cashBreakdown, expectedCash] = await Promise.all([
      orderService.getShiftSalesBreakdown(shift.id),
      shiftService.getExpectedCash(shift.id),
    ]);
    const shiftMovements = cashMovements.filter((movement) => movement.shiftId === shift.id);
    const cashInMillimes = shiftMovements
      .filter((movement) => movement.kind === 'in')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0);
    const cashOutMillimes = shiftMovements
      .filter((movement) => movement.kind === 'out')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0);
    const expected = expectedCash + voidAdjustmentMillimes;
    const counted = shift.countedCashMillimes;
    const staffName = staff.find((user) => user.id === shift.staffId)?.name ?? 'Staff';
    return {
      shiftId: shift.id,
      staffName,
      status: inProgress ? 'in_progress' : 'closed',
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      startingCashMillimes: shift.startingCashMillimes,
      cashSalesMillimes: cashBreakdown.cashSalesMillimes,
      tabPaymentsMillimes: cashBreakdown.tabPaymentsMillimes,
      cashInMillimes,
      cashOutMillimes,
      expectedCashMillimes: expected,
      countedCashMillimes: inProgress ? undefined : counted,
      differenceMillimes: inProgress ? undefined : (counted ?? 0) - expected,
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
  const reversals = readData<TabRecord[]>('tabs', []).filter((tab) =>
    tab.storeId === storeId && tab.kind === 'reversal' &&
    new Date(tab.createdAt).getTime() >= from && new Date(tab.createdAt).getTime() <= to,
  );
  const tabsIssuedMillimes = orders.filter((order) => order.paymentMethod === 'tab').reduce((sum, order) => sum + order.totalMillimes, 0);
  const tabsSettledMillimes = settlements.reduce((sum, tab) => sum + tab.amountMillimes, 0) -
    reversals.reduce((sum, tab) => sum + tab.amountMillimes, 0);
  const customers = readData<import('../types/domain').CustomerRecord[]>('customers', []).filter((customer) => customer.storeId === storeId);
  const allCustomerTransactions = readData<TabRecord[]>('tabs', []).filter((tab) => tab.storeId === storeId);
  const customerTabs: ReportCustomerTabLine[] = customers.map((customer) => {
    const customerOrders = allOrders.filter((order) => order.customerId === customer.id && order.paymentMethod === 'tab');
    const transactions = allCustomerTransactions.filter((tab) => tab.customerId === customer.id);
    const orderIds = new Set(customerOrders.map((order) => order.id));
    const periodTransactions = transactions.filter((tab) => {
      const timestamp = new Date(tab.createdAt).getTime();
      return timestamp >= from && timestamp <= to;
    });
    const issuedInPeriod = orders
      .filter((order) => order.customerId === customer.id && order.paymentMethod === 'tab')
      .reduce((sum, order) => sum + order.totalMillimes, 0);
    const issuedTransactionMillimes = periodTransactions
      .filter((tab) => tab.kind === 'issued' && (!tab.orderId || !orderIds.has(tab.orderId)))
      .reduce((sum, tab) => sum + tab.amountMillimes, 0);
    const periodPayments = periodTransactions
      .filter((tab) => tab.kind === 'settled')
      .reduce((sum, tab) => sum + tab.amountMillimes, 0) -
      periodTransactions
        .filter((tab) => tab.kind === 'reversal')
        .reduce((sum, tab) => sum + tab.amountMillimes, 0);
    const ordersAtPeriodEnd = customerOrders.filter((order) =>
      new Date(order.createdAt).getTime() <= to &&
      !(order.status === 'voided' && new Date(order.voidedAt ?? order.createdAt).getTime() <= to),
    );
    const transactionsAtPeriodEnd = transactions.filter((tab) => new Date(tab.createdAt).getTime() <= to);
    const legacyIssuedAtPeriodEnd = transactionsAtPeriodEnd
      .filter((tab) => tab.kind === 'issued' && (!tab.orderId || !orderIds.has(tab.orderId)))
      .reduce((sum, tab) => sum + tab.amountMillimes, 0);
    const settledAtPeriodEnd = transactionsAtPeriodEnd
      .filter((tab) => tab.kind === 'settled')
      .reduce((sum, tab) => sum + tab.amountMillimes, 0);
    const reversedAtPeriodEnd = transactionsAtPeriodEnd
      .filter((tab) => tab.kind === 'reversal')
      .reduce((sum, tab) => sum + tab.amountMillimes, 0);
    const issuedAtPeriodEnd = ordersAtPeriodEnd.reduce((sum, order) => sum + order.totalMillimes, 0);
    return {
      customerId: customer.id,
      customerName: customer.name,
      issuedMillimes: issuedInPeriod + issuedTransactionMillimes,
      paymentsMillimes: periodPayments,
      outstandingMillimes: issuedAtPeriodEnd + legacyIssuedAtPeriodEnd - settledAtPeriodEnd + reversedAtPeriodEnd,
    };
  }).filter((customer) => customer.issuedMillimes !== 0 || customer.paymentsMillimes !== 0 || customer.outstandingMillimes !== 0);
  const tabsOutstandingMillimes = customerTabs.reduce((total, customer) => total + customer.outstandingMillimes, 0);
  const receivableMillimes = customerTabs.reduce((total, customer) => total + Math.max(0, customer.outstandingMillimes), 0);
  const salesMillimes = orders.reduce((sum, order) => sum + order.totalMillimes, 0);
  const salesCollectedMillimes = paymentSplit.cash + paymentSplit.card + paymentSplit.other + tabsSettledMillimes;
  const expensesMillimes = expenses.reduce((sum, expense) => sum + expense.amountMillimes, 0);
  const netProfitMillimes = salesCollectedMillimes - expensesMillimes;
  const closedShiftLines = shiftLines.filter((shift) => shift.status !== 'in_progress');
  const cashDifferenceMillimes = closedShiftLines.reduce((sum, shift) => sum + (shift.differenceMillimes ?? 0), 0);
  const cashOuts: ReportCashOutLine[] = cashMovements
    .filter((movement) => movement.kind === 'out' && new Date(movement.createdAt).getTime() >= from && new Date(movement.createdAt).getTime() <= to)
    .map((movement) => ({
      shiftId: movement.shiftId,
      staffName: staffById.get(movement.staffId)?.name ?? 'Staff',
      reason: movement.reason,
      amountMillimes: movement.amountMillimes,
      note: movement.note,
      createdAt: movement.createdAt,
    }));
  return {
    salesMillimes,
    salesCollectedMillimes,
    expensesMillimes,
    netProfitMillimes,
    receivableMillimes,
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
      orders: voidedOrders.map((order) => ({
        ticketNumber: order.number,
        reason: order.voidReason ?? '',
        totalMillimes: order.totalMillimes,
        approvedBy: order.voidedByUserId
          ? staffById.get(order.voidedByUserId)?.name ?? 'Unknown'
          : order.voidedBy === 'owner' ? 'Owner' : order.voidedBy === 'pin' ? 'PIN authorized' : 'Unknown',
      })),
    },
    comps: {
      count: compRecords.length,
      quantity: compRecords.reduce((sum, comp) => sum + comp.quantity, 0),
      totalMillimes: compRecords.reduce((sum, comp) => sum + comp.valueMillimes, 0),
      records: compRecords.map((comp) => ({
        staffName: staffById.get(comp.staffId)?.name ?? 'Staff',
        itemName: comp.name,
        quantity: comp.quantity,
        valueMillimes: comp.valueMillimes,
        reason: comp.reason,
        note: comp.note,
        createdAt: comp.createdAt,
      })),
    },
    shiftLines,
    paymentSplit,
    totalExpectedCashMillimes: shiftLines.reduce((sum, shift) => sum + (shift.expectedCashMillimes ?? 0), 0),
    totalCountedMillimes: closedShiftLines.reduce((sum, shift) => sum + (shift.countedCashMillimes ?? 0), 0),
    totalDifferenceMillimes: cashDifferenceMillimes,
    cashSalesMillimes: paymentSplit.cash,
    tabSalesMillimes: paymentSplit.tab,
    tabPaymentsReceivedMillimes: tabsSettledMillimes,
    cashFloatMillimes: shiftLines.reduce((sum, shift) => sum + shift.startingCashMillimes, 0),
    cashOuts,
    customerTabs,
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
    salesCollectedMillimes: summary.salesCollectedMillimes,
    expensesMillimes: summary.expensesMillimes,
    netProfitMillimes: summary.netProfitMillimes,
    receivableMillimes: summary.receivableMillimes,
    orderCount: summary.orderCount,
    cashDifferenceMillimes: summary.cashDifferenceMillimes,
    zNumber,
    periodFrom,
    periodTo: createdAt,
    generatedBy,
    salesByCategory: summary.salesByCategory,
    itemsSold: summary.itemsSold,
    voids: summary.voids,
    comps: summary.comps,
    shifts: summary.shiftLines,
    paymentSplit: summary.paymentSplit,
    totalExpectedCashMillimes: summary.totalExpectedCashMillimes,
    totalCountedMillimes: summary.totalCountedMillimes,
    totalDifferenceMillimes: summary.totalDifferenceMillimes,
    cashSalesMillimes: summary.cashSalesMillimes,
    tabSalesMillimes: summary.tabSalesMillimes,
    tabPaymentsReceivedMillimes: summary.tabPaymentsReceivedMillimes,
    cashFloatMillimes: summary.cashFloatMillimes,
    cashOuts: summary.cashOuts,
    customerTabs: summary.customerTabs,
    tabsIssuedMillimes: summary.tabsIssuedMillimes,
    tabsSettledMillimes: summary.tabsSettledMillimes,
    tabsOutstandingMillimes: summary.tabsOutstandingMillimes,
  };
  writeData('reports', [...getReports(), report]);
  await activityService.log({
    storeId,
    action: type === 'X' ? 'report.x' : 'report.z',
    summary: `Generated ${type} report${report.zNumber ? ` #${report.zNumber}` : ''}.`,
    entityType: 'report',
    entityId: report.id,
    meta: {
      after: {
        type: report.type,
        businessDate: report.businessDate,
        salesMillimes: report.salesMillimes,
        salesCollectedMillimes: report.salesCollectedMillimes,
        expensesMillimes: report.expensesMillimes,
        netProfitMillimes: report.netProfitMillimes,
        receivableMillimes: report.receivableMillimes,
        orderCount: report.orderCount,
        cashDifferenceMillimes: report.cashDifferenceMillimes,
        generatedBy: report.generatedBy,
      },
    },
  });
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
