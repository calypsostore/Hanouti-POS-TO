import type {
  PaymentMethod,
  ReportCashMovementLine,
  ReportCashOutLine,
  ReportCustomerTabLine,
  ReportEmployeeLine,
  ReportExpenseLine,
  ReportRecord,
  ReportShiftLine,
  ReportVoidAdjustmentLine,
  TabRecord,
} from '../types/domain';
import { resolveStoreSettings } from '../types/domain';
import { catalogService } from './catalogService';
import { compService } from './compService';
import { orderService } from './orderService';
import { shiftService } from './shiftService';
import { userService } from './userService';
import { customerService } from './customerService';
import { readData, writeData } from './storage';
import { seedReports } from './seedData';
import { activityService } from './activityService';
import { expenseService } from './expenseService';
import { notificationService } from './notificationService';
import { isSupabaseDriver } from '../data/driver';
import { listReports as listRemoteReports, saveReport as saveRemoteReport } from '../data/repositories/reportRepository';

const getReports = () => readData('reports', seedReports);
function datePartsInTimezone(date: Date, timeZone: string): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
}

function todayKey(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const parts = datePartsInTimezone(new Date(), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function startOfBusinessDay(timeZone: string): string {
  const parts = datePartsInTimezone(new Date(), timeZone);
  const targetMidnight = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  let timestamp = targetMidnight;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const localParts = datePartsInTimezone(new Date(timestamp), timeZone);
    const representedTimestamp = Date.UTC(
      Number(localParts.year),
      Number(localParts.month) - 1,
      Number(localParts.day),
      Number(localParts.hour),
      Number(localParts.minute),
      Number(localParts.second),
    );
    const correction = targetMidnight - representedTimestamp;
    timestamp += correction;
    if (correction === 0) break;
  }
  return new Date(timestamp).toISOString();
}

function getRangeStart(period: 'day' | 'week' | 'month' | 'year'): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else if (period === 'month') start.setDate(1);
  else if (period === 'year') start.setMonth(0, 1);
  return start;
}

function sinceLastZ(storeId: string, reports: ReportRecord[], timeZone: string): string {
  const previous = reports.filter((report) => report.storeId === storeId && report.type === 'Z')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  if (previous) return previous.periodTo ?? previous.createdAt;
  return startOfBusinessDay(timeZone);
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
  const periodCashMovements = cashMovements.filter((movement) => {
    const timestamp = new Date(movement.createdAt).getTime();
    return timestamp >= from && timestamp <= to;
  });
  const periodVoidAdjustments: ReportVoidAdjustmentLine[] = shifts.flatMap((shift) =>
    (shift.voidAdjustments ?? [])
      .filter((adjustment) => {
        const timestamp = new Date(adjustment.createdAt).getTime();
        return timestamp >= from && timestamp <= to;
      })
      .map((adjustment) => ({
        shiftId: shift.id,
        staffName: staffById.get(shift.staffId)?.name ?? 'Staff',
        orderNumber: adjustment.orderNumber,
        amountMillimes: adjustment.amountMillimes,
        createdAt: adjustment.createdAt,
      })),
  );
  const includedShifts = shifts.filter((shift) => {
    const opened = new Date(shift.openedAt).getTime();
    const closed = shift.closedAt ? new Date(shift.closedAt).getTime() : Number.POSITIVE_INFINITY;
    return opened <= to && closed >= from;
  });
  const shiftLines: ReportShiftLine[] = await Promise.all(includedShifts.map(async (shift) => {
    const inProgress = shift.status === 'open';
    const voidAdjustmentMillimes = periodVoidAdjustments
      .filter((adjustment) => adjustment.shiftId === shift.id)
      .reduce((sum, adjustment) => sum + adjustment.amountMillimes, 0);
    const [cashBreakdown, expectedCash] = await Promise.all([
      orderService.getShiftSalesBreakdown(shift.id),
      shiftService.getExpectedCash(shift.id),
    ]);
    const shiftMovements = periodCashMovements.filter((movement) => movement.shiftId === shift.id);
    const cashInMillimes = shiftMovements
      .filter((movement) => movement.kind === 'in')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0);
    const cashOutMillimes = shiftMovements
      .filter((movement) => movement.kind === 'out')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0);
    const expected = expectedCash + voidAdjustmentMillimes;
    const counted = shift.countedCashMillimes;
    const staffName = staff.find((user) => user.id === shift.staffId)?.name ?? 'Staff';
    const shiftOrders = orders.filter((order) => order.shiftId === shift.id);
    const shiftPaymentSplit: Record<PaymentMethod, number> = { cash: 0, card: 0, other: 0, tab: 0 };
    for (const order of shiftOrders) shiftPaymentSplit[order.paymentMethod] += order.totalMillimes;
    return {
      shiftId: shift.id,
      staffName,
      orderCount: shiftOrders.length,
      status: inProgress ? 'in_progress' : 'closed',
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      startingCashMillimes: shift.startingCashMillimes,
      cashSalesMillimes: shiftPaymentSplit.cash,
      cardSalesMillimes: shiftPaymentSplit.card,
      otherSalesMillimes: shiftPaymentSplit.other,
      tabSalesMillimes: shiftPaymentSplit.tab,
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
  const itemTotals = new Map<string, {
    name: string;
    quantity: number;
    totalMillimes: number;
    categoryId: string;
    categoryName: string;
    unitPriceMillimes: number;
  }>();
  for (const order of orders) {
    for (const line of order.items) {
      const catalogItem = itemIndex.get(line.itemId);
      const categoryId = line.categoryId ?? catalogItem?.categoryId ?? 'other';
      const categoryName = line.categoryName ?? categoryIndex.get(categoryId)?.name ?? 'Other';
      const category = categoryTotals.get(categoryId) ?? { name: categoryName, quantity: 0, totalMillimes: 0 };
      category.quantity += line.quantity;
      category.totalMillimes += line.lineTotalMillimes;
      categoryTotals.set(categoryId, category);
      const itemKey = `${line.itemId}\u0000${line.unitPriceMillimes}\u0000${categoryId}`;
      const item = itemTotals.get(itemKey) ?? {
        name: line.name,
        quantity: 0,
        totalMillimes: 0,
        categoryId,
        categoryName,
        unitPriceMillimes: line.unitPriceMillimes,
      };
      item.quantity += line.quantity;
      item.totalMillimes += line.lineTotalMillimes;
      itemTotals.set(itemKey, item);
    }
  }
  const paymentSplit: Record<PaymentMethod, number> = { cash: 0, card: 0, other: 0, tab: 0 };
  for (const order of orders) paymentSplit[order.paymentMethod] += order.totalMillimes;
  const customers = isSupabaseDriver()
    ? await customerService.listCustomers(storeId)
    : readData<import('../types/domain').CustomerRecord[]>('customers', []).filter((customer) => customer.storeId === storeId);
  const allCustomerTransactions = isSupabaseDriver()
    ? (await Promise.all(customers.map((customer) => customerService.listTransactions(customer.id)))).flat()
    : readData<TabRecord[]>('tabs', []).filter((tab) => tab.storeId === storeId);
  const settlements = allCustomerTransactions.filter((tab) =>
    tab.storeId === storeId && tab.kind === 'settled' &&
    new Date(tab.createdAt).getTime() >= from && new Date(tab.createdAt).getTime() <= to,
  );
  const reversals = allCustomerTransactions.filter((tab) =>
    tab.storeId === storeId && tab.kind === 'reversal' &&
    new Date(tab.createdAt).getTime() >= from && new Date(tab.createdAt).getTime() <= to,
  );
  const tabsIssuedMillimes = orders.filter((order) => order.paymentMethod === 'tab').reduce((sum, order) => sum + order.totalMillimes, 0);
  const tabsSettledMillimes = settlements.reduce((sum, tab) => sum + tab.amountMillimes, 0) -
    reversals.reduce((sum, tab) => sum + tab.amountMillimes, 0);
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
  const chronologicalOrders = [...orders].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const salesCollectedMillimes = paymentSplit.cash + paymentSplit.card + paymentSplit.other + tabsSettledMillimes;
  const expensesMillimes = expenses.reduce((sum, expense) => sum + expense.amountMillimes, 0);
  const netProfitMillimes = salesCollectedMillimes - expensesMillimes;
  const closedShiftLines = shiftLines.filter((shift) => shift.status !== 'in_progress');
  const includedShiftIds = new Set(shiftLines.map((shift) => shift.shiftId));
  const historicalVoidAdjustmentMillimes = periodVoidAdjustments
    .filter((adjustment) => !includedShiftIds.has(adjustment.shiftId))
    .reduce((sum, adjustment) => sum + adjustment.amountMillimes, 0);
  const cashDifferenceMillimes = closedShiftLines.reduce((sum, shift) => sum + (shift.differenceMillimes ?? 0), 0);
  const cashOuts: ReportCashOutLine[] = periodCashMovements
    .filter((movement) => movement.kind === 'out' && new Date(movement.createdAt).getTime() >= from && new Date(movement.createdAt).getTime() <= to)
    .map((movement) => ({
      shiftId: movement.shiftId,
      staffName: staffById.get(movement.staffId)?.name ?? 'Staff',
      reason: movement.reason,
      amountMillimes: movement.amountMillimes,
      note: movement.note,
      createdAt: movement.createdAt,
    }));
  const reportCashMovements: ReportCashMovementLine[] = periodCashMovements.map((movement) => ({
    shiftId: movement.shiftId,
    staffName: staffById.get(movement.staffId)?.name ?? 'Staff',
    kind: movement.kind,
    reason: movement.reason,
    amountMillimes: movement.amountMillimes,
    note: movement.note,
    createdAt: movement.createdAt,
  }));
  const employeeBreakdown: ReportEmployeeLine[] = [...orders.reduce((totals, order) => {
    const employee = totals.get(order.staffId) ?? {
      staffId: order.staffId,
      name: order.staffName ?? staffById.get(order.staffId)?.name ?? 'Staff',
      orderCount: 0,
      salesMillimes: 0,
    };
    employee.orderCount += 1;
    employee.salesMillimes += order.totalMillimes;
    totals.set(order.staffId, employee);
    return totals;
  }, new Map<string, ReportEmployeeLine>()).values()];
  const expenseDetails: ReportExpenseLine[] = expenses.map((expense) => ({
    expenseId: expense.id,
    category: expense.category,
    amountMillimes: expense.amountMillimes,
    paidMillimes: expense.paidMillimes,
    date: expense.date,
    supplierId: expense.supplierId,
    note: expense.note,
    createdBy: staffById.get(expense.createdBy)?.name ?? expense.createdBy,
  }));
  return {
    salesMillimes,
    salesCollectedMillimes,
    expensesMillimes,
    netProfitMillimes,
    receivableMillimes,
    orderCount: orders.length,
    firstTicketNumber: chronologicalOrders.length > 0 ? chronologicalOrders[0].number : undefined,
    lastTicketNumber: chronologicalOrders.length > 0 ? chronologicalOrders[chronologicalOrders.length - 1].number : undefined,
    cashDifferenceMillimes,
    topItems: [...itemTotals.values()].reduce<Record<string, number>>((totals, item) => {
      totals[item.name] = (totals[item.name] ?? 0) + item.quantity;
      return totals;
    }, {}),
    shifts: includedShifts,
    salesByCategory: [...categoryTotals].map(([categoryId, value]) => ({ categoryId, ...value })),
    itemsSold: [...itemTotals].map(([itemKey, value]) => ({ itemId: itemKey.split('\u0000')[0], ...value })),
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
    totalExpectedCashMillimes: shiftLines.reduce((sum, shift) => sum + (shift.expectedCashMillimes ?? 0), historicalVoidAdjustmentMillimes),
    totalCountedMillimes: closedShiftLines.reduce((sum, shift) => sum + (shift.countedCashMillimes ?? 0), 0),
    totalDifferenceMillimes: cashDifferenceMillimes,
    cashSalesMillimes: paymentSplit.cash,
    tabSalesMillimes: paymentSplit.tab,
    tabPaymentsReceivedMillimes: tabsSettledMillimes,
    cashFloatMillimes: shiftLines.reduce((sum, shift) => sum + shift.startingCashMillimes, 0),
    cashInMillimes: periodCashMovements
      .filter((movement) => movement.kind === 'in')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0),
    cashOutMillimes: periodCashMovements
      .filter((movement) => movement.kind === 'out')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0),
    cashMovements: reportCashMovements,
    voidAdjustments: periodVoidAdjustments,
    employeeBreakdown,
    cashOuts,
    expenseDetails,
    customerTabs,
    tabsIssuedMillimes,
    tabsSettledMillimes,
    tabsOutstandingMillimes,
  };
}

async function createReport(
  storeId: string,
  type: 'X' | 'Z',
  generatedBy: string,
  ownerPin?: string,
  closeDetails?: { countedCashMillimes: number; differenceMillimes: number; note?: string },
): Promise<ReportRecord> {
  const store = await userService.getStore(storeId);
  if (!store) throw new Error('The store could not be found.');
  const createdAt = new Date().toISOString();
  const reports = isSupabaseDriver() ? await listRemoteReports(storeId) : getReports();
  const storeTimeZone = store.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const periodFrom = sinceLastZ(storeId, reports, storeTimeZone);
  const summary = await summarize(storeId, new Date(periodFrom).getTime(), new Date(createdAt).getTime());
  const storeSettings = resolveStoreSettings(store.settings);
  const businessDate = todayKey(storeTimeZone);
  const zNumber = type === 'Z'
    ? Math.max(0, ...reports.filter((report) => report.storeId === storeId && report.type === 'Z').map((report) => report.zNumber ?? 0)) + 1
    : undefined;
  const xNumber = type === 'X'
    ? reports.filter((report) => report.storeId === storeId && report.type === 'X' && report.businessDate === businessDate).length + 1
    : undefined;
  const report: ReportRecord = {
    id: `report-${crypto.randomUUID()}`,
    storeId,
    storeName: store.name,
    frozenStoreName: store.name,
    frozenStoreAddress: store.address,
    frozenStorePhone: store.phone,
    frozenStoreTaxId: store.taxId,
    frozenSettings: {
      reportFooterText: storeSettings.reportFooterText,
      storeLogoId: storeSettings.storeLogoId,
      showLogo: storeSettings.showLogo,
      showAddress: storeSettings.showAddress,
      showPhone: storeSettings.showPhone,
      paperWidth: storeSettings.paperWidth,
    },
    frozenReportFooterText: storeSettings.reportFooterText,
    frozenPaperWidth: storeSettings.paperWidth,
    type,
    businessDate,
    createdAt,
    salesMillimes: summary.salesMillimes,
    salesCollectedMillimes: summary.salesCollectedMillimes,
    expensesMillimes: summary.expensesMillimes,
    netProfitMillimes: summary.netProfitMillimes,
    receivableMillimes: summary.receivableMillimes,
    orderCount: summary.orderCount,
    cashDifferenceMillimes: summary.cashDifferenceMillimes,
    grossMillimes: summary.salesMillimes,
    netMillimes: summary.salesMillimes,
    zNumber,
    reportNumber: zNumber
      ? `Z-${String(zNumber).padStart(6, '0')}`
      : `X-${String(xNumber ?? 1).padStart(6, '0')}`,
    periodFrom,
    periodTo: createdAt,
    dayOpenedAt: summary.shifts.map((shift) => shift.openedAt).sort()[0] ?? periodFrom,
    dayClosedAt: type === 'Z' ? createdAt : undefined,
    firstTicketNumber: summary.firstTicketNumber,
    lastTicketNumber: summary.lastTicketNumber,
    generatedBy,
    salesByCategory: summary.salesByCategory,
    itemsSold: summary.itemsSold,
    voids: summary.voids,
    voidAdjustments: summary.voidAdjustments,
    comps: summary.comps,
    expenseDetails: summary.expenseDetails,
    shifts: summary.shiftLines,
    paymentSplit: summary.paymentSplit,
    totalExpectedCashMillimes: summary.totalExpectedCashMillimes,
    totalCountedMillimes: summary.totalCountedMillimes,
    totalDifferenceMillimes: summary.totalDifferenceMillimes,
    cashSalesMillimes: summary.cashSalesMillimes,
    tabSalesMillimes: summary.tabSalesMillimes,
    tabPaymentsReceivedMillimes: summary.tabPaymentsReceivedMillimes,
    cashFloatMillimes: summary.cashFloatMillimes,
    cashInMillimes: summary.cashInMillimes,
    cashOutMillimes: summary.cashOutMillimes,
    cashMovements: summary.cashMovements,
    employeeBreakdown: summary.employeeBreakdown,
    cashOuts: summary.cashOuts,
    customerTabs: summary.customerTabs,
    tabsIssuedMillimes: summary.tabsIssuedMillimes,
    tabsSettledMillimes: summary.tabsSettledMillimes,
    tabsOutstandingMillimes: summary.tabsOutstandingMillimes,
    countedCashMillimes: closeDetails?.countedCashMillimes,
    cashDifference: closeDetails?.differenceMillimes,
    cashDifferenceNote: closeDetails?.note,
    pinVerified: type === 'Z',
    ...(closeDetails ? {
      countedCashMillimes: closeDetails.countedCashMillimes,
      cashDifference: closeDetails.differenceMillimes,
      cashDifferenceNote: closeDetails.note,
      cashDifferenceMillimes: closeDetails.differenceMillimes,
    } : {}),
  };
  const savedReport = isSupabaseDriver()
    ? await saveRemoteReport(report, ownerPin)
    : report;
  if (!isSupabaseDriver()) writeData('reports', [...getReports(), report]);
  await activityService.log({
    storeId,
    action: type === 'X' ? 'report.x' : 'report.z',
    summary: `Generated ${type} report${savedReport.zNumber ? ` #${savedReport.zNumber}` : ''}.`,
    entityType: 'report',
    entityId: savedReport.id,
    meta: {
      after: {
        type: savedReport.type,
        businessDate: savedReport.businessDate,
        salesMillimes: savedReport.salesMillimes,
        salesCollectedMillimes: savedReport.salesCollectedMillimes,
        expensesMillimes: savedReport.expensesMillimes,
        netProfitMillimes: savedReport.netProfitMillimes,
        receivableMillimes: savedReport.receivableMillimes,
        orderCount: savedReport.orderCount,
        cashDifferenceMillimes: savedReport.cashDifferenceMillimes,
        generatedBy: savedReport.generatedBy,
      },
    },
  });
  return savedReport;
}

export const reportService = {
  async getCurrentPeriodSummary(storeId: string) {
    const [reports, store] = await Promise.all([
      isSupabaseDriver() ? listRemoteReports(storeId) : Promise.resolve(getReports()),
      userService.getStore(storeId),
    ]);
    if (!store) throw new Error('The store could not be found.');
    const timeZone = store.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    return await summarize(storeId, new Date(sinceLastZ(storeId, reports, timeZone)).getTime(), Date.now());
  },

  async getInsights(storeId: string, from: number, to: number) {
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
      throw new Error('Choose a valid insights date range.');
    }
    const toInclusive = to - 1;
    const [summary, allOrders, shifts, staff, comps] = await Promise.all([
      summarize(storeId, from, toInclusive),
      orderService.listAll(storeId),
      shiftService.listShifts(storeId),
      userService.listUsers(storeId),
      compService.listComps(storeId),
    ]);
    const orders = allOrders.filter((order) => {
      const timestamp = new Date(order.createdAt).getTime();
      return timestamp >= from && timestamp < to;
    });
    const completedOrders = orders.filter((order) => order.status === 'done');
    const dailySales = new Map<string, number>();
    const hourlySales = Array.from({ length: 24 }, (_, hour) => ({ hour, salesMillimes: 0 }));
    const staffTotals = new Map<string, {
      staffId: string;
      name: string;
      orders: number;
      salesMillimes: number;
      voids: number;
      compsMillimes: number;
      cashDifferenceMillimes: number;
    }>();
    const ensureStaff = (staffId: string, fallbackName = 'Staff') => {
      let total = staffTotals.get(staffId);
      if (!total) {
        total = {
          staffId,
          name: staff.find((member) => member.id === staffId)?.name ?? fallbackName,
          orders: 0,
          salesMillimes: 0,
          voids: 0,
          compsMillimes: 0,
          cashDifferenceMillimes: 0,
        };
        staffTotals.set(staffId, total);
      }
      return total;
    };
    for (const member of staff.filter((user) => user.role === 'staff')) ensureStaff(member.id, member.name);
    for (const order of orders) {
      if (order.status === 'done') {
        const total = ensureStaff(order.staffId, order.staffName);
        total.orders += 1;
        total.salesMillimes += order.totalMillimes;
        const date = new Date(order.createdAt);
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        dailySales.set(dateKey, (dailySales.get(dateKey) ?? 0) + order.totalMillimes);
        hourlySales[date.getHours()].salesMillimes += order.totalMillimes;
      }
    }
    for (const order of allOrders) {
      if (order.status !== 'voided') continue;
      const voidedAt = new Date(order.voidedAt ?? order.createdAt).getTime();
      if (voidedAt >= from && voidedAt < to) ensureStaff(order.staffId, order.staffName).voids += 1;
    }
    for (const comp of comps) {
      const timestamp = new Date(comp.createdAt).getTime();
      if (timestamp >= from && timestamp < to) {
        ensureStaff(comp.staffId).compsMillimes += comp.valueMillimes;
      }
    }
    for (const shift of shifts) {
      const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : Number.NaN;
      if (closedAt >= from && closedAt < to) {
        ensureStaff(shift.staffId).cashDifferenceMillimes += shift.differenceMillimes ?? 0;
      }
    }
    const firstDay = new Date(from);
    firstDay.setHours(0, 0, 0, 0);
    const lastDay = new Date(to - 1);
    lastDay.setHours(0, 0, 0, 0);
    const salesByDay: { date: string; salesMillimes: number }[] = [];
    for (const day = new Date(firstDay); day <= lastDay; day.setDate(day.getDate() + 1)) {
      const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      salesByDay.push({ date: dateKey, salesMillimes: dailySales.get(dateKey) ?? 0 });
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const lastWeekStart = new Date(todayStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const sumDay = (start: Date) => {
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const dayOrders = allOrders.filter((order) => {
        const timestamp = new Date(order.createdAt).getTime();
        return order.status === 'done' && timestamp >= start.getTime() && timestamp < end.getTime();
      });
      return {
        salesMillimes: dayOrders.reduce((sum, order) => sum + order.totalMillimes, 0),
        orderCount: dayOrders.length,
      };
    };
    return {
      salesByDay,
      salesByHour: hourlySales,
      salesByStaff: [...staffTotals.values()].sort((left, right) => right.salesMillimes - left.salesMillimes),
      salesByCategory: summary.salesByCategory,
      staffPerformance: [...staffTotals.values()].sort((left, right) => right.salesMillimes - left.salesMillimes)
        .map((member) => ({ ...member, averageOrderMillimes: member.orders ? member.salesMillimes / member.orders : 0 })),
      dayComparison: { today: sumDay(todayStart), lastWeek: sumDay(lastWeekStart) },
      salesCollectedMillimes: summary.salesCollectedMillimes,
      expensesMillimes: summary.expensesMillimes,
      netProfitMillimes: summary.netProfitMillimes,
      compsMillimes: summary.comps.totalMillimes,
      orderCount: completedOrders.length,
    };
  },

  async getDashboard(storeId: string, period: 'day' | 'week' | 'month' | 'year' = 'day') {
    const from = getRangeStart(period).getTime();
    return await summarize(storeId, from, Date.now());
  },

  async listReports(storeId: string): Promise<ReportRecord[]> {
    if (isSupabaseDriver()) return listRemoteReports(storeId);
    return getReports().filter((report) => report.storeId === storeId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async createXReport(storeId: string, generatedBy = 'Owner'): Promise<ReportRecord> {
    return createReport(storeId, 'X', generatedBy);
  },

  async closeDayWithZReport(
    storeId: string,
    generatedBy = 'Owner',
    ownerPin?: string,
    closeDetails?: { countedCashMillimes: number; differenceMillimes: number; note?: string },
  ): Promise<ReportRecord> {
    if (!ownerPin || !/^\d{4}$/.test(ownerPin)) throw new Error('Owner PIN is required for every Z report.');
    if ((await shiftService.listOpenShifts(storeId)).length > 0) throw new Error('Force-close or close every shift before creating a Z report.');
    const store = await userService.getStore(storeId);
    if (!store) throw new Error('The store could not be found.');
    if (!isSupabaseDriver()) {
      if (!await userService.verifyStorePin(storeId, ownerPin, 'z_report')) throw new Error('The owner PIN is incorrect.');
    }
    const report = await createReport(storeId, 'Z', generatedBy, ownerPin, closeDetails);
    if (closeDetails) {
      report.countedCashMillimes = closeDetails.countedCashMillimes;
      report.cashDifference = closeDetails.differenceMillimes;
      report.cashDifferenceNote = closeDetails.note;
      report.cashDifferenceMillimes = closeDetails.differenceMillimes;
      report.pinVerified = true;
    }
    if (!isSupabaseDriver()) {
      writeData('stores', (await userService.listStores()).map((candidate) => candidate.id === storeId ? { ...candidate, dayClosedOn: todayKey() } : candidate));
    }
    await notificationService.notifyZReportClosed(storeId, report.id, report.zNumber);
    return report;
  },
};
