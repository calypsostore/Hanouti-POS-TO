import type { ReportRecord } from '../../types/domain';
import type { ShiftOverviewAnalytics, ShiftOverviewPeriodValues, ShiftOverviewPoint } from '../../lib/shiftOverview';
import { readData } from '../storage';
import { seedReports } from '../seedData';
import { shiftService } from '../shiftService';
import { getUnreportedShiftsAfterLastZ } from '../reportPeriod';

export const getReports = () => readData('reports', seedReports);

export function datePartsInTimezone(date: Date, timeZone: string): Record<string, string> {
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

export function todayKey(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const parts = datePartsInTimezone(new Date(), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function startOfBusinessDay(timeZone: string, referenceDate = new Date()): string {
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

export function getRangeStart(period: 'day' | 'week' | 'month' | 'year'): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else if (period === 'month') start.setDate(1);
  else if (period === 'year') start.setMonth(0, 1);
  return start;
}

export function sinceLastZ(
  storeId: string,
  reports: ReportRecord[],
  timeZone: string,
  shifts: Awaited<ReturnType<typeof shiftService.listShifts>>,
  through = Number.POSITIVE_INFINITY,
): string {
  const firstShift = getUnreportedShiftsAfterLastZ(storeId, reports, shifts, through)[0];
  return firstShift?.openedAt ?? startOfBusinessDay(timeZone);
}

export function expensesIncludedInZReports(storeId: string, reports: ReportRecord[]): Set<string> {
  return new Set(reports
    .filter((report) => report.storeId === storeId && report.type === 'Z')
    .flatMap((report) => report.expenseDetails?.map((expense) => expense.expenseId) ?? []));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseOverviewValues(value: unknown, context: string): ShiftOverviewPeriodValues {
  if (!isRecord(value)) throw new Error(`Shift KPI analytics is missing ${context} values.`);
  const keys: (keyof ShiftOverviewPeriodValues)[] = [
    'sales', 'transactions', 'cash', 'cards', 'other', 'expenses', 'netSales',
  ];
  const values: ShiftOverviewPeriodValues = {
    sales: 0,
    transactions: 0,
    cash: 0,
    cards: 0,
    other: 0,
    expenses: 0,
    netSales: 0,
  };
  for (const key of keys) {
    const field = value[key];
    if (typeof field !== 'number' || !Number.isFinite(field)) {
      throw new Error(`Shift KPI analytics returned an invalid ${context} ${key} value.`);
    }
    values[key] = field;
  }
  return values;
}

export function parseRemoteShiftKpiAnalytics(value: Record<string, unknown>): ShiftOverviewAnalytics {
  if (typeof value.comparisonAvailable !== 'boolean' || !Array.isArray(value.series)) {
    throw new Error('Shift KPI analytics returned an incomplete response.');
  }
  const series = value.series.map((point, index): ShiftOverviewPoint => {
    if (!isRecord(point) || typeof point.label !== 'string') {
      throw new Error(`Shift KPI analytics returned an invalid trend point at index ${index}.`);
    }
    return { label: point.label, ...parseOverviewValues(point, `trend point ${index}`) };
  });
  return {
    current: parseOverviewValues(value.current, 'current period'),
    previous: parseOverviewValues(value.previous, 'previous period'),
    comparisonAvailable: value.comparisonAvailable,
    series,
  };
}
