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
    periodFrom: row.period_from ?? undefined,
    periodTo: row.period_to ?? undefined,
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
