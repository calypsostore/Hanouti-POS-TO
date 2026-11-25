import { getSupabaseClient } from '../../data/supabaseClient';

export type FiscalPreset =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'previous_month'
  | 'this_year'
  | 'previous_year'
  | 'custom';

export interface FiscalTransaction {
  id: string;
  number: number;
  businessDate: string;
  createdAt: string;
  customer?: string;
  staff?: string;
  paymentMethod: 'cash' | 'card' | 'other' | 'tab';
  paymentStatus: 'paid' | 'outstanding';
  status: 'done' | 'pending_void' | 'voided';
  voidedAt?: string;
  voidReason?: string;
  snapshot?: Record<string, unknown>;
  items: Array<{ itemId?: string; name: string; quantity: number; unitPriceMillimes: number; lineTotalMillimes: number }>;
}

export interface FiscalVatLine {
  taxType: string;
  treatment: string;
  ruleId?: string;
  ruleVersion?: number;
  ruleName?: string;
  ratePpm?: number;
  taxableHTMillimes: number;
  vatMillimes: number;
  ttcMillimes: number;
  transactionCount: number;
  transactionIds: string[];
}

export interface FiscalReport {
  store: {
    id: string;
    name: string;
    timezone: string;
    address?: string;
    phone?: string;
    taxId?: string;
  };
  period: { startDate: string; endDateExclusive: string; timezone: string };
  generatedAt: string;
  profile?: {
    legalName?: string;
    tradingName?: string;
    taxId?: string;
    pricingMode?: 'inclusive' | 'exclusive';
    reviewStatus: string;
  };
  summary: {
    transactionCount: number;
    voidedTransactionCount: number;
    netAmountMillimes: number;
    vatAmountMillimes: number;
    grossAmountMillimes: number;
    payableAmountMillimes: number;
    missingSnapshotCount: number;
    reconciliationValid: boolean;
  };
  vatBreakdown: FiscalVatLine[];
  payments: {
    sales: { cash: number; card: number; other: number; tab: number };
    collected: { cash: number; card: number; other: number; tab: number };
    tabSettlements: { cash: number; card: number; other: number; reversed: number };
  };
  adjustments: {
    voidedCount: number;
    voidedGrossMillimes: number;
    cashMovements: Array<Record<string, unknown>>;
    cashMovementsNetMillimes: number;
    voidAdjustments: Array<Record<string, unknown>>;
    voidAdjustmentsTotalMillimes: number;
    refundsAvailable: boolean;
    refundsMillimes: number | null;
    creditNotesAvailable: boolean;
  };
  transactions: FiscalTransaction[];
}

export type FiscalSnapshotAmountKey = 'netAmountMillimes' | 'totalTaxMillimes' | 'totalAmountMillimes';

export function getFiscalSnapshotAmount(
  transaction: FiscalTransaction,
  key: FiscalSnapshotAmountKey,
): number | undefined {
  const value = transaction.snapshot?.[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

export function getFiscalReportCounts(report: Pick<FiscalReport, 'summary' | 'transactions'>) {
  return {
    completed: report.summary.transactionCount,
    voided: report.summary.voidedTransactionCount,
    pendingVoid: report.transactions.filter((transaction) => transaction.status === 'pending_void').length,
    missingSnapshots: report.summary.missingSnapshotCount,
  };
}

export function hasSnapshotBackedFiscalAmounts(report: Pick<FiscalReport, 'transactions'>): boolean {
  return report.transactions.some((transaction) => transaction.status === 'done'
    && getFiscalSnapshotAmount(transaction, 'netAmountMillimes') !== undefined
    && getFiscalSnapshotAmount(transaction, 'totalTaxMillimes') !== undefined
    && getFiscalSnapshotAmount(transaction, 'totalAmountMillimes') !== undefined);
}

export function getFiscalSnapshotNotice(report: Pick<FiscalReport, 'summary'>): string {
  const missingCount = report.summary.missingSnapshotCount;
  if (missingCount === 0) return 'No transactions are missing stored fiscal snapshots.';
  return `WARNING: ${missingCount} transaction(s) are missing stored fiscal snapshots. HT, VAT, and TTC cannot be reliably reconstructed for those transactions; no historical VAT has been estimated.`;
}

export function getFiscalReconciliationStatus(report: FiscalReport): string {
  if (report.summary.missingSnapshotCount > 0 && !hasSnapshotBackedFiscalAmounts(report)) {
    return 'Not verifiable: no stored fiscal snapshots';
  }
  if (report.summary.missingSnapshotCount > 0) {
    return `${report.summary.reconciliationValid ? 'PASS' : 'FAIL'}: stored fiscal snapshots only`;
  }
  return report.summary.reconciliationValid ? 'PASS' : 'FAIL';
}

export function formatFiscalTimestamp(value: string, timezone: string): string {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return 'Unavailable';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(instant);
}

export interface FiscalReportHistoryRecord {
  id: string;
  storeId: string;
  periodStart: string;
  periodEndExclusive: string;
  timezone: string;
  parameters: Record<string, unknown>;
  snapshot: FiscalReport;
  generatedAt: string;
  generatedBy?: string;
}

function raise(error: { message: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

export function shiftDateKey(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function dateKeyInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function resolveFiscalPeriod(
  preset: FiscalPreset,
  timezone: string,
  customStart = '',
  customEnd = '',
): { start: string; endExclusive: string; label: string } | null {
  const today = dateKeyInTimezone(new Date(), timezone);
  if (preset === 'custom') {
    if (!isValidDateKey(customStart) || !isValidDateKey(customEnd) || customStart > customEnd) return null;
    return { start: customStart, endExclusive: shiftDateKey(customEnd, 1), label: `${customStart} to ${customEnd}` };
  }
  if (preset === 'today') return { start: today, endExclusive: shiftDateKey(today, 1), label: 'Today' };
  if (preset === 'yesterday') {
    const start = shiftDateKey(today, -1);
    return { start, endExclusive: today, label: 'Yesterday' };
  }
  if (preset === 'this_week') {
    const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const start = shiftDateKey(today, mondayOffset);
    return { start, endExclusive: shiftDateKey(today, 1), label: 'This week' };
  }
  if (preset === 'this_month') {
    const start = `${today.slice(0, 7)}-01`;
    return { start, endExclusive: monthEndExclusive(start), label: 'This month' };
  }
  if (preset === 'previous_month') {
    const [year, month] = today.slice(0, 7).split('-').map(Number);
    const startMonth = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
    const endMonth = `${year}-${String(month).padStart(2, '0')}`;
    return { start: `${startMonth}-01`, endExclusive: `${endMonth}-01`, label: 'Previous month' };
  }
  if (preset === 'this_year') return { start: `${today.slice(0, 4)}-01-01`, endExclusive: `${Number(today.slice(0, 4)) + 1}-01-01`, label: 'This year' };
  const year = Number(today.slice(0, 4)) - 1;
  return { start: `${year}-01-01`, endExclusive: `${year + 1}-01-01`, label: 'Previous year' };
}

function monthEndExclusive(start: string): string {
  const [year, month] = start.slice(0, 7).split('-').map(Number);
  return month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`;
}

export function fiscalPeriodForPreset(
  preset: FiscalPreset,
  timezone: string,
  customStart = '',
  customEnd = '',
): { start: string; endExclusive: string; label: string } | null {
  return resolveFiscalPeriod(preset, timezone, customStart, customEnd);
}

export async function getFiscalReport(storeId: string, start: string, endExclusive: string, timezone: string): Promise<FiscalReport> {
  const { data, error } = await getSupabaseClient().rpc('get_fiscal_arbitrary_report', {
    p_store_id: storeId,
    p_period_start: start,
    p_period_end_exclusive: endExclusive,
    p_timezone: timezone,
  });
  if (error) raise(error, 'Could not load fiscal report');
  if (!data || typeof data !== 'object') throw new Error('Fiscal report response is invalid.');
  return data as FiscalReport;
}

export async function saveFiscalReportHistory(storeId: string, report: FiscalReport): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('save_fiscal_report_history', {
    p_store_id: storeId,
    p_period_start: report.period.startDate,
    p_period_end_exclusive: report.period.endDateExclusive,
    p_timezone: report.period.timezone,
    p_parameters: { presetSnapshot: true, currency: 'TND' },
    p_snapshot: report,
  });
  if (error) raise(error, 'Could not save fiscal report');
  if (typeof data !== 'string') throw new Error('Saved fiscal report id is invalid.');
  return data;
}

export async function listFiscalReportHistory(storeId: string): Promise<FiscalReportHistoryRecord[]> {
  const { data, error } = await getSupabaseClient().rpc('list_fiscal_report_history', { p_store_id: storeId });
  if (error) raise(error, 'Could not load fiscal report history');
  return Array.isArray(data) ? data as FiscalReportHistoryRecord[] : [];
}
