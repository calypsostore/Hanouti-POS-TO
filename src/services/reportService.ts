import type {
  PaymentMethod,
  ReportCashMovementLine,
  ReportCashOutLine,
  ReportCustomerTabLine,
  ReportEmployeeLine,
  ReportExpenseLine,
  ReportPendingVoidLine,
  ReportRecord,
  ReportShiftLine,
  ReportVoidAdjustmentLine,
  OrderSummaryRecord,
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
import { getSupabaseClient } from '../data/supabaseClient';
import {
  getDashboardSummary as getRemoteDashboardSummary,
  getShiftSummary as getRemoteShiftSummary,
  listReports as listRemoteReports,
  saveReport as saveRemoteReport,
} from '../data/repositories/reportRepository';

const getReports = () => readData('reports', seedReports);

export interface ReportDayStatus {
  dayIsClosed: boolean;
  hasActivity: boolean;
  openShiftCount: number;
  lastZ?: { reportNumber: string; createdAt: string };
}

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

function startOfBusinessDay(timeZone: string, referenceDate = new Date()): string {
  const parts = datePartsInTimezone(referenceDate, timeZone);
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

function sinceLastZ(
  storeId: string,
  reports: ReportRecord[],
  timeZone: string,
  shifts: Awaited<ReturnType<typeof shiftService.listShifts>>,
): string {
  const previous = reports.filter((report) => report.storeId === storeId && report.type === 'Z')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const previousZAt = previous ? new Date(previous.periodTo ?? previous.createdAt).getTime() : Number.NEGATIVE_INFINITY;
  const firstShift = shifts
    .filter((shift) => shift.storeId === storeId && new Date(shift.openedAt).getTime() > previousZAt)
    .sort((left, right) => left.openedAt.localeCompare(right.openedAt))[0];
  return firstShift?.openedAt ?? startOfBusinessDay(timeZone);
}

function expensesIncludedInZReports(storeId: string, reports: ReportRecord[]): Set<string> {
  return new Set(reports
    .filter((report) => report.storeId === storeId && report.type === 'Z')
    .flatMap((report) => report.expenseDetails?.map((expense) => expense.expenseId) ?? []));
}

async function summarizeLocal(
  storeId: string,
  from: number,
  to: number,
  excludedExpenseIds = new Set<string>(),
  useExpenseCreationPeriod = false,
) {
  const allOrders = await orderService.listAll(storeId);
  const periodOrders = allOrders.filter((order) => {
      const timestamp = new Date(order.createdAt).getTime();
      return timestamp >= from && timestamp <= to;
    });
  const orders = periodOrders.filter((order) => order.status === 'done');
  const pendingVoidOrders = allOrders.filter((order) => order.status === 'pending_void');
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
    useExpenseCreationPeriod ? expenseService.list(storeId) : expenseService.listForRange(storeId, from, to),
  ]);
  const currentExpenses = expenses.filter((expense) => {
    if (excludedExpenseIds.has(expense.id)) return false;
    if (!useExpenseCreationPeriod) return true;
    if (!expense.createdAt) return false;
    const createdAt = new Date(expense.createdAt).getTime();
    return createdAt >= from && createdAt <= to;
  });
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
        kind: adjustment.kind ?? 'approved',
        amountMillimes: adjustment.amountMillimes,
        createdAt: adjustment.createdAt,
      })),
  );
  const customers = isSupabaseDriver()
    ? await customerService.listCustomers(storeId)
    : readData<import('../types/domain').CustomerRecord[]>('customers', []).filter((customer) => customer.storeId === storeId);
  const allCustomerTransactions = isSupabaseDriver()
    ? (await Promise.all(customers.map((customer) => customerService.listTransactions(customer.id)))).flat()
    : readData<TabRecord[]>('tabs', []).filter((tab) => tab.storeId === storeId);
  const includedShifts = shifts.filter((shift) => {
    const opened = new Date(shift.openedAt).getTime();
    return opened >= from && opened <= to;
  });
  const shiftLines: ReportShiftLine[] = await Promise.all(includedShifts.map(async (shift) => {
    const inProgress = shift.status === 'open';
    const voidAdjustmentMillimes = periodVoidAdjustments
      .filter((adjustment) => adjustment.shiftId === shift.id)
      .reduce((sum, adjustment) => sum + adjustment.amountMillimes, 0);
    const voidRequestsMillimes = periodVoidAdjustments
      .filter((adjustment) => adjustment.shiftId === shift.id && adjustment.kind === 'requested')
      .reduce((sum, adjustment) => sum + adjustment.amountMillimes, 0);
    const voidRejectionsMillimes = periodVoidAdjustments
      .filter((adjustment) => adjustment.shiftId === shift.id && adjustment.kind === 'rejected')
      .reduce((sum, adjustment) => sum + adjustment.amountMillimes, 0);
    const [cashBreakdown, expectedCash] = await Promise.all([
      orderService.getShiftSalesBreakdown(shift.id),
      !inProgress && shift.expectedCashMillimes !== undefined
        ? Promise.resolve(shift.expectedCashMillimes)
        : shiftService.getExpectedCash(shift.id),
    ]);
    const shiftMovements = periodCashMovements.filter((movement) => movement.shiftId === shift.id);
    const cashInMillimes = shiftMovements
      .filter((movement) => movement.kind === 'in')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0);
    const cashOutMillimes = shiftMovements
      .filter((movement) => movement.kind === 'out')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0);
    const expected = !inProgress && shift.expectedCashMillimes !== undefined
      ? expectedCash + voidAdjustmentMillimes
      : expectedCash;
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
      cashSalesMillimes: cashBreakdown.cashSalesMillimes,
      cardSalesMillimes: shiftPaymentSplit.card,
      otherSalesMillimes: shiftPaymentSplit.other,
      tabSalesMillimes: shiftPaymentSplit.tab,
      tabPaymentsMillimes: cashBreakdown.tabPaymentsMillimes,
      cashInMillimes,
      cashOutMillimes,
      expectedCashMillimes: expected,
      cashFlowExFloatMillimes: expected - shift.startingCashMillimes,
      countedCashMillimes: inProgress ? undefined : counted,
      differenceMillimes: inProgress ? undefined : (counted ?? 0) - expected,
      forceClosedByOwner: shift.forceClosedByOwner ?? false,
      voidsAutoApprovedCount: shift.voidsAutoApprovedCount ?? 0,
      voidAdjustmentMillimes: voidAdjustmentMillimes || undefined,
      voidRequestsMillimes: voidRequestsMillimes || undefined,
      voidRejectionsMillimes: voidRejectionsMillimes || undefined,
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
  const settlements = allCustomerTransactions.filter((tab) =>
    tab.storeId === storeId && tab.kind === 'settled' &&
    new Date(tab.createdAt).getTime() >= from && new Date(tab.createdAt).getTime() <= to,
  );
  const reversals = allCustomerTransactions.filter((tab) =>
    tab.storeId === storeId && tab.kind === 'reversal' &&
    new Date(tab.createdAt).getTime() >= from && new Date(tab.createdAt).getTime() <= to,
  );
  const tabsIssuedMillimes = orders.filter((order) => order.paymentMethod === 'tab').reduce((sum, order) => sum + order.totalMillimes, 0);
  const cashSettlements = settlements.filter((tab) => (tab.paymentMethod ?? 'cash') === 'cash');
  const nonCashSettlements = settlements.filter((tab) => tab.paymentMethod !== undefined && tab.paymentMethod !== 'cash');
  const cashReversals = reversals.filter((tab) => (tab.paymentMethod ?? 'cash') === 'cash');
  const nonCashReversals = reversals.filter((tab) => tab.paymentMethod !== undefined && tab.paymentMethod !== 'cash');
  const tabsSettledMillimes = cashSettlements.reduce((sum, tab) => sum + tab.amountMillimes, 0) -
    cashReversals.reduce((sum, tab) => sum + tab.amountMillimes, 0);
  const nonCashTabPaymentsMillimes = nonCashSettlements.reduce((sum, tab) => sum + tab.amountMillimes, 0) -
    nonCashReversals.reduce((sum, tab) => sum + tab.amountMillimes, 0);
  const cardTabPaymentsMillimes = allCustomerTransactions
    .filter((tab) => tab.storeId === storeId && tab.paymentMethod === 'card' &&
      (tab.kind === 'settled' || tab.kind === 'reversal') &&
      new Date(tab.createdAt).getTime() >= from && new Date(tab.createdAt).getTime() <= to)
    .reduce((sum, tab) => sum + (tab.kind === 'settled' ? tab.amountMillimes : -tab.amountMillimes), 0);
  const otherTabPaymentsMillimes = allCustomerTransactions
    .filter((tab) => tab.storeId === storeId && tab.paymentMethod === 'other' &&
      (tab.kind === 'settled' || tab.kind === 'reversal') &&
      new Date(tab.createdAt).getTime() >= from && new Date(tab.createdAt).getTime() <= to)
    .reduce((sum, tab) => sum + (tab.kind === 'settled' ? tab.amountMillimes : -tab.amountMillimes), 0);
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
      order.status !== 'pending_void' &&
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
  const chronologicalOrders = [...orders].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.number - right.number,
  );
  const salesCollectedMillimes = paymentSplit.cash + paymentSplit.card + paymentSplit.other +
    tabsSettledMillimes + nonCashTabPaymentsMillimes;
  const expensesMillimes = currentExpenses.reduce((sum, expense) => sum + expense.amountMillimes, 0);
  const netProfitMillimes = salesCollectedMillimes - expensesMillimes;
  const closedShiftLines = shiftLines.filter((shift) => shift.status !== 'in_progress');
  const includedShiftIds = new Set(shiftLines.map((shift) => shift.shiftId));
  const historicalVoidAdjustmentMillimes = periodVoidAdjustments
    .filter((adjustment) => !includedShiftIds.has(adjustment.shiftId))
    .reduce((sum, adjustment) => sum + adjustment.amountMillimes, 0);
  const cashRefundsMillimes = cashReversals
    .filter((reversal) => {
      const shift = shifts.find((candidate) => candidate.id === reversal.shiftId);
      return shift?.closedAt && new Date(shift.closedAt).getTime() < new Date(reversal.createdAt).getTime();
    })
    .reduce((sum, reversal) => sum + reversal.amountMillimes, 0);
  const cashDifferenceMillimes = closedShiftLines.reduce((sum, shift) => sum + (shift.differenceMillimes ?? 0), 0);
  const totalExpectedCashMillimes = shiftLines.reduce(
    (sum, shift) => sum + (shift.expectedCashMillimes ?? 0),
    historicalVoidAdjustmentMillimes,
  ) - cashRefundsMillimes;
  const cashFloatMillimes = shiftLines.reduce((sum, shift) => sum + shift.startingCashMillimes, 0);
  const expectedCashExFloatMillimes = totalExpectedCashMillimes - cashFloatMillimes;
  const cashSalesForDrawerMillimes = shiftLines.reduce((sum, shift) => sum + (shift.cashSalesMillimes ?? 0), 0);
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
  const salesByDayMap = new Map<string, number>();
  const salesByHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 }));
  for (const order of orders) {
    const date = new Date(order.createdAt);
    const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    salesByDayMap.set(dateKey, (salesByDayMap.get(dateKey) ?? 0) + order.totalMillimes);
    salesByHour[date.getHours()].orders += 1;
  }
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const lastWeekStart = new Date(todayStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const lastWeekEnd = new Date(lastWeekStart);
  lastWeekEnd.setDate(lastWeekEnd.getDate() + 1);
  const salesBetween = (start: number, end: number) => allOrders
    .filter((order) => {
      const timestamp = new Date(order.createdAt).getTime();
      return order.status === 'done' && timestamp >= start && timestamp < end;
    })
    .reduce((sum, order) => sum + order.totalMillimes, 0);
  const recentOrders: OrderSummaryRecord[] = [...periodOrders]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 6)
    .map(({ items: _items, ...order }) => order);
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
  const expenseDetails: ReportExpenseLine[] = currentExpenses.map((expense) => ({
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
        autoApprovedAtForcedClose: order.voidReason === 'Auto-approved at forced close',
        approvedBy: order.voidedByUserId
          ? staffById.get(order.voidedByUserId)?.name ?? 'Unknown'
          : order.voidedBy === 'owner' ? 'Owner' : order.voidedBy === 'pin' ? 'PIN authorized' : 'Unknown',
      })),
    },
    pendingVoids: {
      count: pendingVoidOrders.length,
      totalMillimes: pendingVoidOrders.reduce((sum, order) => sum + order.totalMillimes, 0),
      orders: pendingVoidOrders.map((order): ReportPendingVoidLine => ({
        ticketNumber: order.number,
        staffName: order.staffName ?? staffById.get(order.staffId)?.name ?? 'Staff',
        shiftId: order.shiftId,
        amountMillimes: order.totalMillimes,
        paymentMethod: order.paymentMethod,
        reason: order.voidReason ?? '',
        requestedAt: order.voidRequestedAt ?? order.createdAt,
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
    totalExpectedCashMillimes,
    expectedCashExFloatMillimes,
    totalCountedMillimes: closedShiftLines.reduce((sum, shift) => sum + (shift.countedCashMillimes ?? 0), 0),
    totalDifferenceMillimes: cashDifferenceMillimes,
    cashSalesMillimes: cashSalesForDrawerMillimes,
    tabSalesMillimes: paymentSplit.tab,
    tabPaymentsReceivedMillimes: tabsSettledMillimes,
    cashFloatMillimes,
    cashInMillimes: periodCashMovements
      .filter((movement) => movement.kind === 'in')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0),
    cashOutMillimes: periodCashMovements
      .filter((movement) => movement.kind === 'out')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0),
    cashRefundsMillimes,
    cashMovements: reportCashMovements,
    voidAdjustments: periodVoidAdjustments,
    employeeBreakdown,
    cashOuts,
    expenseDetails,
    customerTabs,
    tabsIssuedMillimes,
    tabsSettledMillimes,
    nonCashTabPaymentsMillimes,
    cardTabPaymentsMillimes,
    otherTabPaymentsMillimes,
    tabsOutstandingMillimes,
    salesByDay: [...salesByDayMap].sort(([left], [right]) => left.localeCompare(right))
      .map(([date, salesMillimes]) => ({ date, salesMillimes })),
    salesByHour,
    salesTodayMillimes: salesBetween(todayStart.getTime(), Date.now()),
    salesLastWeekMillimes: salesBetween(lastWeekStart.getTime(), lastWeekEnd.getTime()),
    recentOrders,
  };
}

type ReportSummary = Awaited<ReturnType<typeof summarizeLocal>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function summarizeRemote(
  storeId: string,
  from: number,
  to: number,
  useExpenseCreationPeriod: boolean,
): Promise<ReportSummary> {
  const [summary, shifts] = await Promise.all([
    getRemoteDashboardSummary(
      storeId,
      new Date(from).toISOString(),
      new Date(to).toISOString(),
      useExpenseCreationPeriod,
    ),
    shiftService.listShifts(storeId),
  ]);
  const requiredNumbers = [
    'salesMillimes', 'salesCollectedMillimes', 'expensesMillimes', 'netProfitMillimes',
    'receivableMillimes', 'orderCount', 'cashDifferenceMillimes', 'totalExpectedCashMillimes',
    'expectedCashExFloatMillimes', 'totalCountedMillimes', 'totalDifferenceMillimes',
    'cashSalesMillimes', 'tabSalesMillimes', 'tabPaymentsReceivedMillimes', 'cashFloatMillimes',
    'cashInMillimes', 'cashOutMillimes', 'cashRefundsMillimes', 'tabsIssuedMillimes',
    'tabsSettledMillimes', 'nonCashTabPaymentsMillimes', 'cardTabPaymentsMillimes',
    'otherTabPaymentsMillimes', 'tabsOutstandingMillimes', 'salesTodayMillimes', 'salesLastWeekMillimes',
  ];
  for (const key of requiredNumbers) {
    if (typeof summary[key] !== 'number' || !Number.isFinite(summary[key])) {
      throw new Error(`Dashboard summary is missing a valid ${key}.`);
    }
  }
  const requiredArrays = [
    'shiftLines', 'itemsSold', 'salesByCategory', 'salesByDay', 'salesByHour', 'recentOrders',
    'employeeBreakdown', 'cashMovements', 'cashOuts', 'voidAdjustments', 'expenseDetails', 'customerTabs',
  ];
  for (const key of requiredArrays) {
    if (!Array.isArray(summary[key])) throw new Error(`Dashboard summary is missing a valid ${key}.`);
  }
  for (const [key, arrayKey] of [
    ['voids', 'orders'],
    ['pendingVoids', 'orders'],
    ['comps', 'records'],
  ]) {
    const collection = summary[key];
    if (!isRecord(collection) || !Array.isArray(collection[arrayKey])) {
      throw new Error(`Dashboard summary is missing a valid ${key}.`);
    }
  }
  return {
    ...summary,
    shifts: shifts.filter((shift) => {
      const opened = new Date(shift.openedAt).getTime();
      return opened >= from && opened <= to;
    }),
  } as unknown as ReportSummary;
}

async function summarize(
  storeId: string,
  from: number,
  to: number,
  excludedExpenseIds = new Set<string>(),
  useExpenseCreationPeriod = false,
): Promise<ReportSummary> {
  if (isSupabaseDriver()) return summarizeRemote(storeId, from, to, useExpenseCreationPeriod);
  return summarizeLocal(storeId, from, to, excludedExpenseIds, useExpenseCreationPeriod);
}

async function createReport(
  storeId: string,
  type: 'X' | 'Z',
  generatedBy: string,
  ownerPin?: string,
  closeDetails?: {
    countedCashMillimes: number;
    countedCardMillimes?: number;
    countedOtherMillimes?: number;
    note?: string;
  },
): Promise<ReportRecord> {
  const dayStatus = await reportService.getDayStatus(storeId);
  if (dayStatus.dayIsClosed || !dayStatus.hasActivity) {
    throw new Error('The business day is closed. Open a new shift before creating another report.');
  }
  const store = await userService.getStore(storeId);
  if (!store) throw new Error('The store could not be found.');
  const createdAt = new Date().toISOString();
  const reports = isSupabaseDriver() ? await listRemoteReports(storeId) : getReports();
  const storeTimeZone = store.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const shifts = await shiftService.listShifts(storeId);
  const periodFrom = sinceLastZ(storeId, reports, storeTimeZone, shifts);
  const summary = await summarize(
    storeId,
    new Date(periodFrom).getTime(),
    new Date(createdAt).getTime(),
    expensesIncludedInZReports(storeId, reports),
    true,
  );
  if (type === 'Z' && summary.pendingVoids.count > 0) {
    throw new Error('Resolve every void request before creating a Z report.');
  }
  if (type === 'Z' && dayStatus.openShiftCount > 0) {
    throw new Error('Force-close or close every shift before creating a Z report.');
  }
  if (type === 'Z' && !closeDetails) throw new Error('Counted cash excluding opening floats is required to close the business day.');
  const cashDifference = closeDetails
    ? closeDetails.countedCashMillimes - summary.expectedCashExFloatMillimes
    : undefined;
  const expectedCardMillimes = summary.paymentSplit.card + summary.cardTabPaymentsMillimes;
  const expectedOtherMillimes = summary.paymentSplit.other + summary.otherTabPaymentsMillimes;
  const cardDifferenceMillimes = closeDetails
    ? (closeDetails.countedCardMillimes ?? 0) - expectedCardMillimes
    : undefined;
  const otherDifferenceMillimes = closeDetails
    ? (closeDetails.countedOtherMillimes ?? 0) - expectedOtherMillimes
    : undefined;
  if (closeDetails && (!Number.isSafeInteger(closeDetails.countedCashMillimes) || closeDetails.countedCashMillimes < 0)) {
    throw new Error('Counted cash must be a non-negative whole number of millimes.');
  }
  if (closeDetails && ((closeDetails.countedCardMillimes !== undefined &&
      (!Number.isSafeInteger(closeDetails.countedCardMillimes) || closeDetails.countedCardMillimes < 0)) ||
      (closeDetails.countedOtherMillimes !== undefined &&
      (!Number.isSafeInteger(closeDetails.countedOtherMillimes) || closeDetails.countedOtherMillimes < 0)))) {
    throw new Error('Card and other counts must be non-negative whole numbers of millimes.');
  }
  if ((cashDifference !== undefined && cashDifference !== 0 ||
      cardDifferenceMillimes !== undefined && cardDifferenceMillimes !== 0 ||
      otherDifferenceMillimes !== undefined && otherDifferenceMillimes !== 0) && !closeDetails?.note?.trim()) {
    throw new Error('A note is required for every Z count difference.');
  }
  const storeSettings = resolveStoreSettings(store.settings);
  const firstShiftAt = summary.shifts.map((shift) => shift.openedAt).sort()[0];
  const businessDate = firstShiftAt
    ? `${datePartsInTimezone(new Date(firstShiftAt), storeTimeZone).year}-${datePartsInTimezone(new Date(firstShiftAt), storeTimeZone).month}-${datePartsInTimezone(new Date(firstShiftAt), storeTimeZone).day}`
    : todayKey(storeTimeZone);
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
    cashDifferenceMillimes: cashDifference ?? summary.cashDifferenceMillimes,
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
    pendingVoids: summary.pendingVoids,
    voidAdjustments: summary.voidAdjustments,
    comps: summary.comps,
    expenseDetails: summary.expenseDetails,
    shifts: summary.shiftLines,
    paymentSplit: summary.paymentSplit,
    totalExpectedCashMillimes: summary.totalExpectedCashMillimes,
    expectedCashExFloatMillimes: summary.expectedCashExFloatMillimes,
    totalCountedMillimes: summary.totalCountedMillimes,
    totalDifferenceMillimes: summary.totalDifferenceMillimes,
    cashSalesMillimes: summary.cashSalesMillimes,
    tabSalesMillimes: summary.tabSalesMillimes,
    tabPaymentsReceivedMillimes: summary.tabPaymentsReceivedMillimes,
    cashFloatMillimes: summary.cashFloatMillimes,
    cashInMillimes: summary.cashInMillimes,
    cashOutMillimes: summary.cashOutMillimes,
    cashRefundsMillimes: summary.cashRefundsMillimes,
    cashMovements: summary.cashMovements,
    employeeBreakdown: summary.employeeBreakdown,
    cashOuts: summary.cashOuts,
    customerTabs: summary.customerTabs,
    tabsIssuedMillimes: summary.tabsIssuedMillimes,
    tabsSettledMillimes: summary.tabsSettledMillimes,
    nonCashTabPaymentsMillimes: summary.nonCashTabPaymentsMillimes,
    tabsOutstandingMillimes: summary.tabsOutstandingMillimes,
    countedCashMillimes: closeDetails?.countedCashMillimes,
    countedCashIncludesFloat: false,
    cashDifference,
    cashDifferenceNote: closeDetails?.note,
    countedCardMillimes: closeDetails ? closeDetails.countedCardMillimes ?? 0 : undefined,
    expectedCardMillimes: type === 'Z' ? expectedCardMillimes : undefined,
    cardDifferenceMillimes,
    countedOtherMillimes: closeDetails ? closeDetails.countedOtherMillimes ?? 0 : undefined,
    expectedOtherMillimes: type === 'Z' ? expectedOtherMillimes : undefined,
    otherDifferenceMillimes,
    nonCashDifferenceNote: cardDifferenceMillimes || otherDifferenceMillimes ? closeDetails?.note : undefined,
    pinVerified: type === 'Z',
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
  async getDayStatus(storeId: string): Promise<ReportDayStatus> {
    if (isSupabaseDriver()) {
      const { data: authData, error: authError } = await getSupabaseClient().auth.getUser();
      if (authError) throw authError;
      const actor = authData.user ? await userService.getUser(authData.user.id) : undefined;
      if (actor?.role !== 'owner') {
        const { data, error } = await getSupabaseClient().rpc('get_business_day_status', {
          p_store_id: storeId,
        });
        if (error) throw new Error(`Could not load business-day status: ${error.message}`, { cause: error });
        if (typeof data !== 'object' || data === null) {
          throw new Error('Business-day status response is invalid.');
        }
        const status = data as {
          dayIsClosed?: unknown;
          hasActivity?: unknown;
          openShiftCount?: unknown;
          lastZ?: { reportNumber?: unknown; createdAt?: unknown } | null;
        };
        if (typeof status.dayIsClosed !== 'boolean' || typeof status.hasActivity !== 'boolean' ||
          typeof status.openShiftCount !== 'number') {
          throw new Error('Business-day status response is incomplete.');
        }
        return {
          dayIsClosed: status.dayIsClosed,
          hasActivity: status.hasActivity,
          openShiftCount: status.openShiftCount,
          lastZ: status.lastZ && typeof status.lastZ.reportNumber === 'string' &&
            typeof status.lastZ.createdAt === 'string'
            ? { reportNumber: status.lastZ.reportNumber, createdAt: status.lastZ.createdAt }
            : undefined,
        };
      }
    }
    const [reports, shifts] = await Promise.all([
      this.listReports(storeId),
      shiftService.listShifts(storeId),
    ]);
    const lastZReport = reports
      .filter((report) => report.storeId === storeId && report.type === 'Z')
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const lastZPeriodTo = lastZReport?.periodTo ?? lastZReport?.createdAt;
    const activityShifts = shifts.filter((shift) =>
      !lastZPeriodTo || new Date(shift.openedAt).getTime() > new Date(lastZPeriodTo).getTime(),
    );
    const hasActivity = activityShifts.length > 0;
    return {
      dayIsClosed: Boolean(lastZReport) && !hasActivity,
      hasActivity,
      openShiftCount: shifts.filter((shift) => shift.status === 'open').length,
      lastZ: lastZReport
        ? {
          reportNumber: lastZReport.reportNumber ?? `Z-${String(lastZReport.zNumber ?? 0).padStart(6, '0')}`,
          createdAt: lastZReport.createdAt,
        }
        : undefined,
    };
  },

  async getCurrentPeriodSummary(storeId: string) {
    const [reports, store, shifts] = await Promise.all([
      isSupabaseDriver() ? listRemoteReports(storeId) : Promise.resolve(getReports()),
      userService.getStore(storeId),
      shiftService.listShifts(storeId),
    ]);
    if (!store) throw new Error('The store could not be found.');
    const timeZone = store.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const periodFrom = new Date(sinceLastZ(storeId, reports, timeZone, shifts)).getTime();
    const periodTo = Date.now();
    const summary = await summarize(
      storeId,
      periodFrom,
      periodTo,
      expensesIncludedInZReports(storeId, reports),
      true,
    );
    return {
      ...summary,
      shiftLines: summary.shiftLines.filter((shift) => {
        const openedAt = new Date(shift.openedAt).getTime();
        const closedAt = shift.closedAt ? new Date(shift.closedAt).getTime() : undefined;
        return openedAt >= periodFrom && openedAt <= periodTo &&
          (shift.status === 'in_progress' ||
            (closedAt !== undefined && closedAt >= periodFrom && closedAt <= periodTo));
      }),
    };
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

  async createOwnShiftXReport(storeId: string, staffId: string, generatedBy: string): Promise<ReportRecord> {
    if (!await userService.hasPermission(staffId, 'print_x_report')) {
      throw new Error('You do not have permission to print an X report.');
    }
    const shift = await shiftService.getOpenShiftForUser(storeId, staffId);
    if (!shift) throw new Error('Open your shift before printing its X report.');
    const now = new Date();
    const periodFrom = new Date(shift.openedAt).getTime();
    const periodTo = now.getTime();
    if (isSupabaseDriver()) {
      const [summary, remoteStore] = await Promise.all([
        getRemoteShiftSummary(shift.id),
        userService.getStore(storeId),
      ]);
      if (!remoteStore) throw new Error('The store could not be found.');
      const requiredNumbers = [
        'orderCount', 'salesMillimes', 'expectedCashMillimes', 'cashInMillimes', 'cashOutMillimes',
        'tabPaymentsMillimes', 'cashSalesMillimes', 'cardSalesMillimes', 'otherSalesMillimes', 'tabSalesMillimes',
      ];
      for (const key of requiredNumbers) {
        if (typeof summary[key] !== 'number' || !Number.isFinite(summary[key])) {
          throw new Error(`Shift summary is missing a valid ${key}.`);
        }
      }
      const getNumber = (key: string): number => {
        const value = summary[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new Error(`Shift summary is missing a valid ${key}.`);
        }
        return value;
      };
      const split = summary.paymentSplit;
      if (!isRecord(split)) {
        throw new Error('Shift summary is missing a valid paymentSplit.');
      }
      const paymentSplit: Record<PaymentMethod, number> = {
        cash: typeof split.cash === 'number' && Number.isFinite(split.cash) ? split.cash : NaN,
        card: typeof split.card === 'number' && Number.isFinite(split.card) ? split.card : NaN,
        other: typeof split.other === 'number' && Number.isFinite(split.other) ? split.other : NaN,
        tab: typeof split.tab === 'number' && Number.isFinite(split.tab) ? split.tab : NaN,
      };
      if (!Object.values(paymentSplit).every(Number.isFinite)) {
        throw new Error('Shift summary is missing a valid paymentSplit.');
      }
      for (const key of ['cashMovements', 'cashOuts']) {
        if (!Array.isArray(summary[key])) throw new Error(`Shift summary is missing a valid ${key}.`);
      }
      for (const [key, arrayKey] of [
        ['voids', 'orders'],
        ['pendingVoids', 'orders'],
        ['comps', 'records'],
      ]) {
        const collection = summary[key];
        if (!isRecord(collection) || !Array.isArray(collection[arrayKey])) {
          throw new Error(`Shift summary is missing a valid ${key}.`);
        }
      }
      const expectedCashMillimes = getNumber('expectedCashMillimes');
      const cashInMillimes = getNumber('cashInMillimes');
      const cashOutMillimes = getNumber('cashOutMillimes');
      const tabPaymentsMillimes = getNumber('tabPaymentsMillimes');
      const staffName = typeof summary.staffName === 'string' ? summary.staffName : generatedBy;
      const timeZone = remoteStore.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const dateParts = datePartsInTimezone(now, timeZone);
      const shiftLine: ReportShiftLine = {
        shiftId: shift.id,
        staffName,
        orderCount: getNumber('orderCount'),
        status: 'in_progress',
        openedAt: shift.openedAt,
        startingCashMillimes: shift.startingCashMillimes,
        cashSalesMillimes: getNumber('cashSalesMillimes'),
        cardSalesMillimes: getNumber('cardSalesMillimes'),
        otherSalesMillimes: getNumber('otherSalesMillimes'),
        tabSalesMillimes: getNumber('tabSalesMillimes'),
        tabPaymentsMillimes,
        cashInMillimes,
        cashOutMillimes,
        expectedCashMillimes,
        cashFlowExFloatMillimes: expectedCashMillimes - shift.startingCashMillimes,
        forceClosedByOwner: false,
      };
      return {
        id: `x-own-${crypto.randomUUID()}`,
        storeId,
        type: 'X',
        businessDate: `${dateParts.year}-${dateParts.month}-${dateParts.day}`,
        createdAt: now.toISOString(),
        periodFrom: shift.openedAt,
        periodTo: now.toISOString(),
        generatedBy,
        reportNumber: `X-SHIFT-${shift.id.slice(-6).toUpperCase()}`,
        salesMillimes: getNumber('salesMillimes'),
        salesCollectedMillimes: paymentSplit.cash + paymentSplit.card + paymentSplit.other + tabPaymentsMillimes,
        expensesMillimes: 0,
        netProfitMillimes: paymentSplit.cash + paymentSplit.card + paymentSplit.other + tabPaymentsMillimes,
        receivableMillimes: 0,
        orderCount: getNumber('orderCount'),
        cashDifferenceMillimes: 0,
        cashSalesMillimes: Number(summary.cashSalesMillimes),
        tabSalesMillimes: Number(summary.tabSalesMillimes),
        tabPaymentsReceivedMillimes: tabPaymentsMillimes,
        cashFloatMillimes: shift.startingCashMillimes,
        expectedCashExFloatMillimes: expectedCashMillimes - shift.startingCashMillimes,
        totalExpectedCashMillimes: expectedCashMillimes,
        cashInMillimes,
        cashOutMillimes,
        paymentSplit,
        shifts: [shiftLine],
        cashMovements: summary.cashMovements as ReportRecord['cashMovements'],
        cashOuts: summary.cashOuts as ReportRecord['cashOuts'],
        voids: summary.voids as ReportRecord['voids'],
        pendingVoids: summary.pendingVoids as ReportRecord['pendingVoids'],
        comps: summary.comps as ReportRecord['comps'],
        firstTicketNumber: typeof summary.firstTicketNumber === 'number' ? summary.firstTicketNumber : undefined,
        lastTicketNumber: typeof summary.lastTicketNumber === 'number' ? summary.lastTicketNumber : undefined,
      };
    }
    const [allOrders, movements, users, allComps, store, breakdown] = await Promise.all([
      orderService.listAll(storeId),
      shiftService.listCashMovements(storeId),
      userService.listUsers(storeId),
      compService.listComps(storeId),
      userService.getStore(storeId),
      orderService.getShiftSalesBreakdown(shift.id),
    ]);
    const orders = allOrders.filter((order) => order.shiftId === shift.id &&
      new Date(order.createdAt).getTime() >= periodFrom && new Date(order.createdAt).getTime() <= periodTo);
    const completed = orders.filter((order) => order.status === 'done');
    const pending = orders.filter((order) => order.status === 'pending_void');
    const voided = orders.filter((order) => order.status === 'voided');
    const paymentSplit: Record<PaymentMethod, number> = { cash: 0, card: 0, other: 0, tab: 0 };
    for (const order of completed) paymentSplit[order.paymentMethod] += order.totalMillimes;
    const cashMovementsForShift = movements.filter((movement) => movement.shiftId === shift.id &&
      new Date(movement.createdAt).getTime() >= periodFrom && new Date(movement.createdAt).getTime() <= periodTo);
    const cashInMillimes = cashMovementsForShift.filter((movement) => movement.kind === 'in')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0);
    const cashOutMillimes = cashMovementsForShift.filter((movement) => movement.kind === 'out')
      .reduce((sum, movement) => sum + movement.amountMillimes, 0);
    const expectedCashMillimes = await shiftService.getExpectedCash(shift.id);
    const staffName = users.find((user) => user.id === staffId)?.name ?? generatedBy;
    const shiftLine: ReportShiftLine = {
      shiftId: shift.id,
      staffName,
      orderCount: completed.length,
      status: 'in_progress',
      openedAt: shift.openedAt,
      startingCashMillimes: shift.startingCashMillimes,
      cashSalesMillimes: paymentSplit.cash,
      cardSalesMillimes: paymentSplit.card,
      otherSalesMillimes: paymentSplit.other,
      tabSalesMillimes: paymentSplit.tab,
      tabPaymentsMillimes: breakdown.tabPaymentsMillimes,
      cashInMillimes,
      cashOutMillimes,
      expectedCashMillimes,
      cashFlowExFloatMillimes: expectedCashMillimes - shift.startingCashMillimes,
      forceClosedByOwner: false,
    };
    const comps = allComps.filter((comp) => comp.shiftId === shift.id &&
      new Date(comp.createdAt).getTime() >= periodFrom && new Date(comp.createdAt).getTime() <= periodTo);
    const cashFloatMillimes = shift.startingCashMillimes;
    const expectedCashExFloatMillimes = expectedCashMillimes - cashFloatMillimes;
    const timeZone = store?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const dateParts = datePartsInTimezone(now, timeZone);
    const chronologicalCompleted = [...completed].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      id: `x-own-${crypto.randomUUID()}`,
      storeId,
      type: 'X',
      businessDate: `${dateParts.year}-${dateParts.month}-${dateParts.day}`,
      createdAt: now.toISOString(),
      periodFrom: shift.openedAt,
      periodTo: now.toISOString(),
      generatedBy,
      reportNumber: `X-SHIFT-${shift.id.slice(-6).toUpperCase()}`,
      salesMillimes: completed.reduce((sum, order) => sum + order.totalMillimes, 0),
      salesCollectedMillimes: paymentSplit.cash + paymentSplit.card + paymentSplit.other
        + breakdown.tabPaymentsMillimes,
      expensesMillimes: 0,
      netProfitMillimes: paymentSplit.cash + paymentSplit.card + paymentSplit.other
        + breakdown.tabPaymentsMillimes,
      receivableMillimes: 0,
      orderCount: completed.length,
      cashDifferenceMillimes: 0,
      cashSalesMillimes: paymentSplit.cash,
      tabSalesMillimes: paymentSplit.tab,
      tabPaymentsReceivedMillimes: breakdown.tabPaymentsMillimes,
      cashFloatMillimes,
      expectedCashExFloatMillimes,
      totalExpectedCashMillimes: expectedCashMillimes,
      cashInMillimes,
      cashOutMillimes,
      paymentSplit,
      shifts: [shiftLine],
      cashMovements: cashMovementsForShift.map((movement) => ({
        shiftId: movement.shiftId,
        staffName,
        kind: movement.kind,
        reason: movement.reason,
        amountMillimes: movement.amountMillimes,
        note: movement.note,
        createdAt: movement.createdAt,
      })),
      cashOuts: cashMovementsForShift.filter((movement) => movement.kind === 'out').map((movement) => ({
        shiftId: movement.shiftId,
        staffName,
        reason: movement.reason,
        amountMillimes: movement.amountMillimes,
        note: movement.note,
        createdAt: movement.createdAt,
      })),
      voids: {
        count: voided.length,
        totalMillimes: voided.reduce((sum, order) => sum + order.totalMillimes, 0),
        orders: voided.map((order) => ({
          ticketNumber: order.number,
          reason: order.voidReason ?? '',
          totalMillimes: order.totalMillimes,
          approvedBy: order.voidedBy ?? 'Unknown',
        })),
      },
      pendingVoids: {
        count: pending.length,
        totalMillimes: pending.reduce((sum, order) => sum + order.totalMillimes, 0),
        orders: pending.map((order) => ({
          ticketNumber: order.number,
          staffName,
          shiftId: shift.id,
          amountMillimes: order.totalMillimes,
          paymentMethod: order.paymentMethod,
          reason: order.voidReason ?? '',
          requestedAt: order.voidRequestedAt ?? order.createdAt,
        })),
      },
      comps: {
        count: comps.length,
        quantity: comps.reduce((sum, comp) => sum + comp.quantity, 0),
        totalMillimes: comps.reduce((sum, comp) => sum + comp.valueMillimes, 0),
        records: comps.map((comp) => ({
          staffName,
          itemName: comp.name,
          quantity: comp.quantity,
          valueMillimes: comp.valueMillimes,
          reason: comp.reason,
          note: comp.note,
          createdAt: comp.createdAt,
        })),
      },
      firstTicketNumber: chronologicalCompleted[0]?.number,
      lastTicketNumber: chronologicalCompleted.at(-1)?.number,
    };
  },

  async closeDayWithZReport(
    storeId: string,
    generatedBy = 'Owner',
    ownerPin?: string,
    closeDetails?: {
      countedCashMillimes: number;
      countedCardMillimes?: number;
      countedOtherMillimes?: number;
      note?: string;
    },
  ): Promise<ReportRecord> {
    if (!ownerPin || !/^\d{4}$/.test(ownerPin)) throw new Error('Owner PIN is required for every Z report.');
    const store = await userService.getStore(storeId);
    if (!store) throw new Error('The store could not be found.');
    if (!isSupabaseDriver()) {
      if ((await orderService.listAll(storeId)).some((order) => order.status === 'pending_void')) {
        throw new Error('Resolve every void request before creating a Z report.');
      }
      if (!await userService.verifyStorePin(storeId, ownerPin, 'z_report')) throw new Error('The owner PIN is incorrect.');
    }
    const report = await createReport(storeId, 'Z', generatedBy, ownerPin, closeDetails);
    if (!isSupabaseDriver()) {
      writeData('stores', (await userService.listStores()).map((candidate) => candidate.id === storeId ? { ...candidate, dayClosedOn: todayKey() } : candidate));
    }
    await notificationService.notifyZReportClosed(storeId, report.id, report.zNumber);
    return report;
  },
};
