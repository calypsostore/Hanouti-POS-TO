import type { PaymentMethod, ReportRecord, ReportShiftLine } from '../../types/domain';
import { compService } from '../compService';
import { orderService } from '../orderService';
import { shiftService } from '../shiftService';
import { userService } from '../userService';
import { isSupabaseDriver } from '../../data/driver';
import { getShiftSummary as getRemoteShiftSummary } from '../../data/repositories/reportRepository';
import { datePartsInTimezone, isRecord } from './reportHelpers';

export const ownShiftXReportMethods = {
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
        'orderCount', 'salesMillimes', 'cashInMillimes', 'cashOutMillimes',
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
      const expectedCashValue = summary.expectedCashMillimes;
      const expectedCashMillimes = typeof expectedCashValue === 'number' && Number.isFinite(expectedCashValue)
        ? expectedCashValue
        : undefined;
      const cashInMillimes = getNumber('cashInMillimes');
      const cashOutMillimes = getNumber('cashOutMillimes');
      const tabPaymentsMillimes = getNumber('tabPaymentsMillimes');
      const staffName = typeof summary.staffName === 'string' ? summary.staffName : generatedBy;
      const timeZone = remoteStore.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const dateParts = datePartsInTimezone(now, timeZone);
      const shiftLine: ReportShiftLine = {
        shiftId: shift.id,
        staffId: shift.staffId,
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
        cashFlowExFloatMillimes: expectedCashMillimes === undefined
          ? undefined
          : expectedCashMillimes - shift.startingCashMillimes,
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
        expectedCashExFloatMillimes: expectedCashMillimes === undefined
          ? undefined
          : expectedCashMillimes - shift.startingCashMillimes,
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
    const expectedCashResult = await shiftService.getExpectedCash(shift.id);
    const expectedCashMillimes = expectedCashResult === null ? undefined : expectedCashResult;
    const cashFlowExFloatMillimes = expectedCashMillimes === undefined
      ? undefined
      : expectedCashMillimes - shift.startingCashMillimes;
    const staffName = users.find((user) => user.id === staffId)?.name ?? generatedBy;
    const shiftLine: ReportShiftLine = {
      shiftId: shift.id,
      staffId: shift.staffId,
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
      cashFlowExFloatMillimes,
      forceClosedByOwner: false,
    };
    const comps = allComps.filter((comp) => comp.shiftId === shift.id &&
      new Date(comp.createdAt).getTime() >= periodFrom && new Date(comp.createdAt).getTime() <= periodTo);
    const cashFloatMillimes = shift.startingCashMillimes;
    const expectedCashExFloatMillimes = expectedCashMillimes === undefined
      ? undefined
      : expectedCashMillimes - cashFloatMillimes;
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
  }
};
