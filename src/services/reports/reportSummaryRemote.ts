import type { ReportShiftLine } from '../../types/domain';
import { shiftService } from '../shiftService';
import { isSupabaseDriver } from '../../data/driver';
import { getDashboardSummary as getRemoteDashboardSummary } from '../../data/repositories/reportRepository';
import { summarizeLocal, type ReportSummary } from './reportSummaryLocal';
import { isRecord } from './reportHelpers';

export async function summarizeRemote(
  storeId: string,
  from: number,
  to: number,
  useExpenseCreationPeriod: boolean,
  periodFromIso?: string,
): Promise<ReportSummary> {
  const [summary, shifts] = await Promise.all([
    getRemoteDashboardSummary(
      storeId,
      periodFromIso ?? new Date(from).toISOString(),
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
  const shiftsInPeriod = shifts.filter((shift) => {
    const opened = new Date(shift.openedAt).getTime();
    return opened >= from && opened <= to;
  });
  const staffIdByShiftId = new Map(shiftsInPeriod.map((shift) => [shift.id, shift.staffId]));
  const shiftLines = (summary.shiftLines as ReportShiftLine[]).map((line) => ({
    ...line,
    staffId: staffIdByShiftId.get(line.shiftId),
  }));
  return {
    ...summary,
    shiftLines,
    shifts: shiftsInPeriod,
  } as unknown as ReportSummary;
}

export async function summarize(
  storeId: string,
  from: number,
  to: number,
  excludedExpenseIds = new Set<string>(),
  useExpenseCreationPeriod = false,
  periodFromIso?: string,
  excludedShiftIds?: Set<string>,
): Promise<ReportSummary> {
  if (isSupabaseDriver()) return summarizeRemote(storeId, from, to, useExpenseCreationPeriod, periodFromIso);
  return summarizeLocal(storeId, from, to, excludedExpenseIds, useExpenseCreationPeriod, excludedShiftIds);
}
