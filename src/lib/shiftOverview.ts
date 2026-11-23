import type { ExpenseRecord, OrderRecord, ShiftRecord, TabRecord } from '../types/domain';

export type ShiftOverviewMetricKey =
  | 'sales'
  | 'transactions'
  | 'cash'
  | 'cards'
  | 'expenses'
  | 'netSales';

export type ShiftOverviewFilter = 'today' | 'yesterday' | 'last7' | 'last30' | 'month' | 'custom';

export interface ShiftOverviewPeriodValues {
  sales: number;
  transactions: number;
  cash: number;
  cards: number;
  other: number;
  expenses: number;
  netSales: number;
}

export interface ShiftOverviewPoint extends ShiftOverviewPeriodValues {
  label: string;
}

export interface ShiftOverviewAnalytics {
  current: ShiftOverviewPeriodValues;
  previous: ShiftOverviewPeriodValues;
  comparisonAvailable: boolean;
  series: ShiftOverviewPoint[];
}

export interface ShiftOverviewDateRange {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
}

export type ShiftOverviewChange = {
  direction: 'up' | 'down' | 'neutral' | 'new' | 'unavailable';
  percent?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

type OverviewOrder = Pick<OrderRecord, 'status' | 'createdAt' | 'totalMillimes' | 'paymentMethod'>;
type OverviewExpense = Pick<ExpenseRecord, 'date' | 'amountMillimes'>;
type OverviewTab = Pick<
  TabRecord,
  'id' | 'shiftId' | 'kind' | 'paymentMethod' | 'amountMillimes' | 'createdAt' | 'reversalAttribution'
>;
type OverviewShift = Pick<ShiftRecord, 'id' | 'includedTabReversalIds'>;

function dateFromKey(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : date;
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function shiftDate(value: string, days: number): string | undefined {
  const date = dateFromKey(value);
  if (!date) return undefined;
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

export function getShiftOverviewDateRange(
  filter: ShiftOverviewFilter,
  today: string,
  customFrom = today,
  customTo = today,
): ShiftOverviewDateRange | undefined {
  const validToday = dateFromKey(today);
  if (!validToday) return undefined;

  let from = today;
  let to = today;
  if (filter === 'yesterday') {
    from = shiftDate(today, -1)!;
    to = from;
  } else if (filter === 'last7') {
    from = shiftDate(today, -6)!;
  } else if (filter === 'last30') {
    from = shiftDate(today, -29)!;
  } else if (filter === 'month') {
    from = `${today.slice(0, 7)}-01`;
  } else if (filter === 'custom') {
    if (!dateFromKey(customFrom) || !dateFromKey(customTo) || customFrom > customTo) return undefined;
    from = customFrom;
    to = customTo;
  }

  const fromDate = dateFromKey(from);
  const toDate = dateFromKey(to);
  if (!fromDate || !toDate) return undefined;

  const periodDays = Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1;
  const previousTo = shiftDate(from, -1);
  const previousFrom = previousTo ? shiftDate(previousTo, -(periodDays - 1)) : undefined;
  if (!previousTo || !previousFrom) return undefined;

  return { from, to, previousFrom, previousTo };
}

export function getShiftOverviewChange(
  current: number,
  previous: number,
  comparisonAvailable = true,
): ShiftOverviewChange {
  if (!comparisonAvailable) return { direction: 'unavailable' };
  if (previous === 0) {
    return current === 0
      ? { direction: 'neutral', percent: 0 }
      : { direction: 'new' };
  }

  const percent = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(percent)) return { direction: 'unavailable' };
  if (percent === 0) return { direction: 'neutral', percent: 0 };
  return { direction: percent > 0 ? 'up' : 'down', percent };
}

export function getShiftOverviewSeries(
  analytics: ShiftOverviewAnalytics,
  metric: ShiftOverviewMetricKey,
): number[] {
  const values = analytics.series.map((point) => point[metric]);
  return values.some((value) => value !== 0) ? values : [];
}

export function getTabReversalStatus(
  reversal: OverviewTab,
  shifts: OverviewShift[],
): 'included' | 'proven_post_close' | 'ambiguous' {
  if (reversal.reversalAttribution === 'same_shift') return 'included';
  if (reversal.reversalAttribution === 'post_close') return 'proven_post_close';
  const reversalShift = shifts.find((shift) => shift.id === reversal.shiftId);
  if (reversalShift?.includedTabReversalIds?.includes(reversal.id)) return 'included';
  return 'ambiguous';
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

function dateKeyInTimezone(value: string, timeZone: string): string {
  const parts = datePartsInTimezone(new Date(value), timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateStartInTimezone(dateKeyValue: string, timeZone: string): number {
  const [year, month, day] = dateKeyValue.split('-').map(Number);
  const targetMidnight = Date.UTC(year, month - 1, day);
  let timestamp = targetMidnight;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = datePartsInTimezone(new Date(timestamp), timeZone);
    const represented = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const correction = targetMidnight - represented;
    timestamp += correction;
    if (correction === 0) break;
  }
  return timestamp;
}

function emptyPeriodValues(): ShiftOverviewPeriodValues {
  return { sales: 0, transactions: 0, cash: 0, cards: 0, other: 0, expenses: 0, netSales: 0 };
}

export function getShiftOverviewAnalyticsFromRecords(
  range: ShiftOverviewDateRange,
  orders: OverviewOrder[],
  expenses: OverviewExpense[],
  tabs: OverviewTab[],
  shifts: OverviewShift[],
  timeZone: string,
  storeCreatedAt: string,
): ShiftOverviewAnalytics {
  const summarizeRange = (from: string, to: string) => {
    const values = emptyPeriodValues();
    for (const order of orders) {
      if (order.status !== 'done') continue;
      const businessDate = dateKeyInTimezone(order.createdAt, timeZone);
      if (businessDate < from || businessDate > to) continue;
      values.sales += order.totalMillimes;
      values.transactions += 1;
      if (order.paymentMethod === 'cash') values.cash += order.totalMillimes;
      if (order.paymentMethod === 'card') values.cards += order.totalMillimes;
      if (order.paymentMethod === 'other') values.other += order.totalMillimes;
    }

    for (const tab of tabs) {
      if (tab.kind !== 'settled' && tab.kind !== 'reversal') continue;
      const businessDate = dateKeyInTimezone(tab.createdAt, timeZone);
      if (businessDate < from || businessDate > to) continue;
      if (tab.kind === 'reversal' && getTabReversalStatus(tab, shifts) === 'ambiguous') continue;
      const sign = tab.kind === 'settled' ? 1 : -1;
      if (tab.paymentMethod === 'cash') values.cash += sign * tab.amountMillimes;
      if (tab.paymentMethod === 'card') values.cards += sign * tab.amountMillimes;
      if (tab.paymentMethod === 'other') values.other += sign * tab.amountMillimes;
    }

    for (const expense of expenses) {
      if (expense.date >= from && expense.date <= to) values.expenses += expense.amountMillimes;
    }
    values.netSales = values.cash + values.cards + values.other - values.expenses;
    return values;
  };

  const series: ShiftOverviewPoint[] = [];
  const oneDay = range.from === range.to;
  if (oneDay) {
    for (let hour = 0; hour < 24; hour += 1) {
      series.push({ label: `${String(hour).padStart(2, '0')}:00`, ...emptyPeriodValues() });
    }
  } else {
    for (let timestamp = Date.parse(`${range.from}T00:00:00.000Z`), end = Date.parse(`${range.to}T00:00:00.000Z`);
      timestamp <= end;
      timestamp += DAY_MS) {
      const date = new Date(timestamp).toISOString().slice(0, 10);
      series.push({ label: date, ...emptyPeriodValues() });
    }
  }
  const seriesByLabel = new Map(series.map((point) => [point.label, point]));
  const labelForTimestamp = (value: string) => {
    if (!oneDay) return dateKeyInTimezone(value, timeZone);
    return `${datePartsInTimezone(new Date(value), timeZone).hour}:00`;
  };

  for (const order of orders) {
    if (order.status !== 'done') continue;
    const businessDate = dateKeyInTimezone(order.createdAt, timeZone);
    if (businessDate < range.from || businessDate > range.to) continue;
    const point = seriesByLabel.get(labelForTimestamp(order.createdAt));
    if (!point) continue;
    point.sales += order.totalMillimes;
    point.transactions += 1;
    if (order.paymentMethod === 'cash') point.cash += order.totalMillimes;
    if (order.paymentMethod === 'card') point.cards += order.totalMillimes;
    if (order.paymentMethod === 'other') point.other += order.totalMillimes;
  }

  for (const tab of tabs) {
    if (tab.kind !== 'settled' && tab.kind !== 'reversal') continue;
    const businessDate = dateKeyInTimezone(tab.createdAt, timeZone);
    if (businessDate < range.from || businessDate > range.to) continue;
    if (tab.kind === 'reversal' && getTabReversalStatus(tab, shifts) === 'ambiguous') continue;
    const point = seriesByLabel.get(labelForTimestamp(tab.createdAt));
    if (!point) continue;
    const sign = tab.kind === 'settled' ? 1 : -1;
    if (tab.paymentMethod === 'cash') point.cash += sign * tab.amountMillimes;
    if (tab.paymentMethod === 'card') point.cards += sign * tab.amountMillimes;
    if (tab.paymentMethod === 'other') point.other += sign * tab.amountMillimes;
  }

  for (const expense of expenses) {
    if (expense.date < range.from || expense.date > range.to) continue;
    const point = seriesByLabel.get(oneDay ? '00:00' : expense.date);
    if (point) point.expenses += expense.amountMillimes;
  }
  for (const point of series) point.netSales = point.cash + point.cards + point.other - point.expenses;

  const comparisonStart = dateStartInTimezone(range.previousFrom, timeZone);
  const createdAt = Date.parse(storeCreatedAt);
  return {
    current: summarizeRange(range.from, range.to),
    previous: summarizeRange(range.previousFrom, range.previousTo),
    comparisonAvailable: Number.isFinite(comparisonStart) && Number.isFinite(createdAt) && comparisonStart >= createdAt,
    series,
  };
}
