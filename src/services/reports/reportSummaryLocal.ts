import type {
  PaymentMethod, ReportCashMovementLine, ReportCashOutLine, ReportCustomerTabLine, ReportEmployeeLine,
  ReportExpenseLine, ReportPendingVoidLine, ReportShiftLine, ReportVoidAdjustmentLine,
  OrderSummaryRecord, TabRecord, UnresolvedTabReversalRecord,
} from '../../types/domain';
import { getTabReversalStatus } from '../../lib/shiftOverview';
import { catalogService } from '../catalogService';
import { compService } from '../compService';
import { orderService } from '../orderService';
import { shiftService } from '../shiftService';
import { userService } from '../userService';
import { customerService } from '../customerService';
import { readData } from '../storage';
import { expenseService } from '../expenseService';
import { isSupabaseDriver } from '../../data/driver';

export async function summarizeLocal(
  storeId: string,
  from: number,
  to: number,
  excludedExpenseIds = new Set<string>(),
  useExpenseCreationPeriod = false,
  excludedShiftIds = new Set<string>(),
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
    : readData<import('../../types/domain').CustomerRecord[]>('customers', []).filter((customer) => customer.storeId === storeId);
  const allCustomerTransactions = isSupabaseDriver()
    ? (await Promise.all(customers.map((customer) => customerService.listTransactions(customer.id)))).flat()
    : readData<TabRecord[]>('tabs', []).filter((tab) => tab.storeId === storeId);
  const includedShifts = shifts.filter((shift) => {
    const opened = new Date(shift.openedAt).getTime();
    return opened >= from && opened <= to && !excludedShiftIds.has(shift.id);
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
    const expected = typeof expectedCash === 'number'
      ? (!inProgress && shift.expectedCashMillimes !== undefined
        ? expectedCash + voidAdjustmentMillimes
        : expectedCash)
      : undefined;
    const counted = shift.countedCashMillimes;
    const staffName = staff.find((user) => user.id === shift.staffId)?.name ?? 'Staff';
    const shiftOrders = orders.filter((order) => order.shiftId === shift.id);
    const shiftPaymentSplit: Record<PaymentMethod, number> = { cash: 0, card: 0, other: 0, tab: 0 };
    for (const order of shiftOrders) shiftPaymentSplit[order.paymentMethod] += order.totalMillimes;
    return {
      shiftId: shift.id,
      staffId: shift.staffId,
      staffName,
      orderCount: shiftOrders.length,
      status: inProgress ? 'in_progress' : 'closed',
      openedAt: shift.openedAt,
      closedAt: shift.closedAt,
      includedTabReversalIds: shift.includedTabReversalIds,
      startingCashMillimes: shift.startingCashMillimes,
      cashSalesMillimes: cashBreakdown.cashSalesMillimes,
      cardSalesMillimes: shiftPaymentSplit.card,
      otherSalesMillimes: shiftPaymentSplit.other,
      tabSalesMillimes: shiftPaymentSplit.tab,
      tabPaymentsMillimes: cashBreakdown.tabPaymentsMillimes,
      cardTabPaymentsMillimes: cashBreakdown.cardTabPaymentsMillimes,
      otherTabPaymentsMillimes: cashBreakdown.otherTabPaymentsMillimes,
      cashInMillimes,
      cashOutMillimes,
      expectedCashMillimes: expected,
      cashFlowExFloatMillimes: expected === undefined ? undefined : expected - shift.startingCashMillimes,
      countedCashMillimes: inProgress ? undefined : counted,
      differenceMillimes: inProgress || counted === undefined || expected === undefined
        ? undefined
        : counted - expected,
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
    cashReversals.filter((reversal) => getTabReversalStatus(reversal, shifts) !== 'ambiguous')
      .reduce((sum, tab) => sum + tab.amountMillimes, 0);
  const nonCashTabPaymentsMillimes = nonCashSettlements.reduce((sum, tab) => sum + tab.amountMillimes, 0) -
    nonCashReversals.filter((reversal) => getTabReversalStatus(reversal, shifts) !== 'ambiguous')
      .reduce((sum, tab) => sum + tab.amountMillimes, 0);
  const cardTabPaymentsMillimes = allCustomerTransactions
    .filter((tab) => tab.storeId === storeId && tab.paymentMethod === 'card' &&
      (tab.kind === 'settled' || tab.kind === 'reversal') &&
      new Date(tab.createdAt).getTime() >= from && new Date(tab.createdAt).getTime() <= to)
    .reduce((sum, tab) => sum + (
      tab.kind === 'settled'
        ? tab.amountMillimes
        : getTabReversalStatus(tab, shifts) === 'ambiguous'
          ? 0
          : -tab.amountMillimes
    ), 0);
  const otherTabPaymentsMillimes = allCustomerTransactions
    .filter((tab) => tab.storeId === storeId && tab.paymentMethod === 'other' &&
      (tab.kind === 'settled' || tab.kind === 'reversal') &&
      new Date(tab.createdAt).getTime() >= from && new Date(tab.createdAt).getTime() <= to)
    .reduce((sum, tab) => sum + (
      tab.kind === 'settled'
        ? tab.amountMillimes
        : getTabReversalStatus(tab, shifts) === 'ambiguous'
          ? 0
          : -tab.amountMillimes
    ), 0);
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
    .filter((reversal) => getTabReversalStatus(reversal, shifts) === 'proven_post_close')
    .reduce((sum, reversal) => sum + reversal.amountMillimes, 0);
  const ambiguousTabReversalIds = reversals
    .filter((reversal) => getTabReversalStatus(reversal, shifts) === 'ambiguous')
    .map((reversal) => reversal.id);
  const unresolvedTabReversals: UnresolvedTabReversalRecord[] = reversals
    .filter((reversal) => getTabReversalStatus(reversal, shifts) === 'ambiguous')
    .map((reversal) => {
      const original = allCustomerTransactions.find((tab) => tab.id === reversal.reversesTabId);
      return {
        reversalId: reversal.id,
        originalSettlementId: reversal.reversesTabId ?? '',
        originalShiftId: original?.shiftId,
        reversalShiftId: reversal.shiftId,
        paymentMethod: reversal.paymentMethod ?? 'cash',
        amountMillimes: reversal.amountMillimes,
        originalSettlementCreatedAt: original?.createdAt,
        reversalCreatedAt: reversal.createdAt,
        reason: reversal.note,
        state: 'ambiguous',
      };
    });
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
        staffId: order.staffId,
        staffName: order.staffName ?? staffById.get(order.staffId)?.name ?? 'Staff',
        shiftId: order.shiftId,
        voidedAt: order.voidedAt,
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
    ambiguousTabReversalIds,
    unresolvedTabReversals,
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

export type ReportSummary = Awaited<ReturnType<typeof summarizeLocal>>;
