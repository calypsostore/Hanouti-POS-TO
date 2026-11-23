import type { ReportRecord } from '../../types/domain';
import { getSupabaseClient } from '../supabaseClient';

interface ReportRow {
  id: string;
  store_id: string;
  type: ReportRecord['type'];
  business_date: string;
  created_at: string;
  sales_millimes: number;
  sales_collected_millimes: number | null;
  expenses_millimes: number | null;
  net_profit_millimes: number | null;
  receivable_millimes: number | null;
  order_count: number;
  cash_difference_millimes: number;
  z_number: number | null;
  period_from: string | null;
  period_to: string | null;
  generated_by: string | null;
  data: Record<string, unknown>;
}

function mapReport(row: ReportRow): ReportRecord {
  return {
    ...(row.data as Partial<ReportRecord>),
    id: row.id,
    storeId: row.store_id,
    type: row.type,
    businessDate: row.business_date,
    createdAt: row.created_at,
    salesMillimes: Number(row.sales_millimes),
    salesCollectedMillimes: row.sales_collected_millimes === null ? undefined : Number(row.sales_collected_millimes),
    expensesMillimes: row.expenses_millimes === null ? undefined : Number(row.expenses_millimes),
    netProfitMillimes: row.net_profit_millimes === null ? undefined : Number(row.net_profit_millimes),
    receivableMillimes: row.receivable_millimes === null ? undefined : Number(row.receivable_millimes),
    orderCount: row.order_count,
    cashDifferenceMillimes: Number(row.cash_difference_millimes),
    zNumber: row.z_number ?? undefined,
    periodFrom: typeof row.data.periodFrom === 'string' ? row.data.periodFrom : undefined,
    periodTo: typeof row.data.periodTo === 'string' ? row.data.periodTo : undefined,
    generatedBy: typeof row.data.generatedBy === 'string' ? row.data.generatedBy : row.generated_by ?? undefined,
  };
}

function fail(error: { message: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

function requireSummary(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${context} returned an invalid response.`);
  }
  return value as Record<string, unknown>;
}

export interface BusinessDayStatus {
  dayIsClosed: boolean;
  hasActivity: boolean;
  openShiftCount: number;
  periodFrom?: string;
  lastZBoundary?: string;
  lastZ?: { reportNumber: string; createdAt: string };
}

export async function getBusinessDayStatus(storeId: string): Promise<BusinessDayStatus> {
  const { data, error } = await getSupabaseClient().rpc('get_business_day_status', {
    p_store_id: storeId,
  });
  if (error) fail(error, 'Could not load business-day status');
  const status = requireSummary(data, 'Business-day status');
  if (typeof status.dayIsClosed !== 'boolean' || typeof status.hasActivity !== 'boolean' ||
    typeof status.openShiftCount !== 'number') {
    throw new Error('Business-day status returned an incomplete response.');
  }
  const lastZ = status.lastZ;
  const lastZRow = typeof lastZ === 'object' && lastZ !== null
    ? lastZ as Record<string, unknown>
    : undefined;
  return {
    dayIsClosed: status.dayIsClosed,
    hasActivity: status.hasActivity,
    openShiftCount: status.openShiftCount,
    periodFrom: typeof status.periodFrom === 'string' ? status.periodFrom : undefined,
    lastZBoundary: typeof status.lastZBoundary === 'string' ? status.lastZBoundary : undefined,
    lastZ: lastZRow &&
      typeof lastZRow.reportNumber === 'string' &&
      typeof lastZRow.createdAt === 'string'
      ? {
        reportNumber: lastZRow.reportNumber,
        createdAt: lastZRow.createdAt,
      }
      : undefined,
  };
}

export async function getDashboardSummary(
  storeId: string,
  from: string,
  to: string,
  useExpenseCreationPeriod = false,
): Promise<Record<string, unknown>> {
  const { data, error } = await getSupabaseClient().rpc('get_dashboard_summary', {
    p_store_id: storeId,
    p_from: from,
    p_to: to,
    p_use_expense_creation_period: useExpenseCreationPeriod,
  });
  if (error) fail(error, 'Could not load dashboard summary');
  return requireSummary(data, 'Dashboard summary');
}

export async function getShiftSummary(shiftId: string): Promise<Record<string, unknown>> {
  const { data, error } = await getSupabaseClient().rpc('get_shift_summary', {
    p_shift_id: shiftId,
  });
  if (error) fail(error, 'Could not load shift summary');
  return requireSummary(data, 'Shift summary');
}

export async function listReports(storeId: string): Promise<ReportRecord[]> {
  const { data, error } = await getSupabaseClient().from('reports').select('*')
    .eq('store_id', storeId).order('created_at', { ascending: false });
  if (error) fail(error, 'Could not load reports');
  return (data ?? []).map((row) => mapReport(row as ReportRow));
}

export async function saveReport(report: ReportRecord, ownerPin?: string): Promise<ReportRecord> {
  const { data, error } = await getSupabaseClient().rpc('record_report', {
    p_report: report,
    p_pin: ownerPin ?? null,
  });
  if (error) fail(error, 'Could not save report');
  return mapReport(data as ReportRow);
}
