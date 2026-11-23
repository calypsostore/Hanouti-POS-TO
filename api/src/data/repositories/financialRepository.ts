import type { CompRecord, ExpenseRecord, SupplierPaymentRecord, SupplierRecord } from '../../types/domain';
import { getSupabaseClient } from '../supabaseClient';

interface ExpenseRow {
  id: string;
  store_id: string;
  category: ExpenseRecord['category'];
  supplier_id: string | null;
  amount_millimes: number;
  paid_millimes: number;
  date: string;
  created_at: string | null;
  note: string | null;
  created_by: string;
}

interface SupplierRow {
  id: string;
  store_id: string;
  name: string;
  phone: string | null;
  notes: string | null;
}

interface SupplierPaymentRow {
  id: string;
  supplier_id: string;
  expense_id: string | null;
  amount_millimes: number;
  date: string;
}

interface CompRow {
  id: string;
  store_id: string;
  staff_id: string;
  shift_id: string;
  item_id: string;
  name: string;
  quantity: number;
  value_millimes: number;
  reason: CompRecord['reason'];
  note: string | null;
  created_at: string;
}

const mapExpense = (row: ExpenseRow): ExpenseRecord => ({
  id: row.id,
  storeId: row.store_id,
  category: row.category,
  supplierId: row.supplier_id ?? undefined,
  amountMillimes: Number(row.amount_millimes),
  paidMillimes: Number(row.paid_millimes),
  date: row.date,
  createdAt: row.created_at ?? undefined,
  note: row.note ?? undefined,
  createdBy: row.created_by,
});

const mapSupplier = (row: SupplierRow): SupplierRecord => ({
  id: row.id,
  storeId: row.store_id,
  name: row.name,
  phone: row.phone ?? undefined,
  notes: row.notes ?? undefined,
});

const mapPayment = (row: SupplierPaymentRow): SupplierPaymentRecord => ({
  id: row.id,
  supplierId: row.supplier_id,
  expenseId: row.expense_id ?? undefined,
  amountMillimes: Number(row.amount_millimes),
  date: row.date,
});

const mapComp = (row: CompRow): CompRecord => ({
  id: row.id,
  storeId: row.store_id,
  staffId: row.staff_id,
  shiftId: row.shift_id,
  itemId: row.item_id,
  name: row.name,
  quantity: row.quantity,
  valueMillimes: Number(row.value_millimes),
  reason: row.reason,
  note: row.note ?? undefined,
  createdAt: row.created_at,
});

function fail(error: { message: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

export async function listExpenses(storeId: string, from?: string, to?: string): Promise<ExpenseRecord[]> {
  let query = getSupabaseClient().from('expenses').select('*').eq('store_id', storeId).order('date', { ascending: false });
  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);
  const { data, error } = await query;
  if (error) fail(error, 'Could not load expenses');
  return (data ?? []).map((row) => mapExpense(row as ExpenseRow));
}

export async function createExpense(input: Omit<ExpenseRecord, 'id'>): Promise<ExpenseRecord> {
  const { data, error } = await getSupabaseClient().from('expenses').insert({
    store_id: input.storeId,
    category: input.category,
    supplier_id: input.supplierId ?? null,
    amount_millimes: input.amountMillimes,
    paid_millimes: input.paidMillimes,
    date: input.date,
    note: input.note ?? null,
    created_by: input.createdBy,
  }).select('*').single();
  if (error) fail(error, 'Could not create expense');
  return mapExpense(data as ExpenseRow);
}

export async function listSuppliers(storeId: string): Promise<SupplierRecord[]> {
  const { data, error } = await getSupabaseClient().from('suppliers').select('*').eq('store_id', storeId).order('name');
  if (error) fail(error, 'Could not load suppliers');
  return (data ?? []).map((row) => mapSupplier(row as SupplierRow));
}

export async function getSupplier(storeId: string, supplierId: string): Promise<SupplierRecord | undefined> {
  const { data, error } = await getSupabaseClient().from('suppliers').select('*')
    .eq('store_id', storeId).eq('id', supplierId).maybeSingle();
  if (error) fail(error, 'Could not load supplier');
  return data ? mapSupplier(data as SupplierRow) : undefined;
}

export async function createSupplier(input: Omit<SupplierRecord, 'id'>): Promise<SupplierRecord> {
  const { data, error } = await getSupabaseClient().from('suppliers').insert({
    store_id: input.storeId,
    name: input.name,
    phone: input.phone ?? null,
    notes: input.notes ?? null,
  }).select('*').single();
  if (error) fail(error, 'Could not create supplier');
  return mapSupplier(data as SupplierRow);
}

export async function listSupplierPayments(supplierId: string): Promise<SupplierPaymentRecord[]> {
  const { data, error } = await getSupabaseClient().from('supplier_payments').select('*')
    .eq('supplier_id', supplierId).order('date', { ascending: false });
  if (error) fail(error, 'Could not load supplier payments');
  return (data ?? []).map((row) => mapPayment(row as SupplierPaymentRow));
}

export async function recordSupplierPayment(input: {
  supplierId: string;
  amountMillimes: number;
  date: string;
  expenseId?: string;
}): Promise<SupplierPaymentRecord> {
  const { data, error } = await getSupabaseClient().rpc('record_supplier_payment', {
    p_supplier_id: input.supplierId,
    p_expense_id: input.expenseId ?? null,
    p_amount_millimes: input.amountMillimes,
    p_date: input.date,
  });
  if (error) fail(error, 'Could not record supplier payment');
  return mapPayment(data as SupplierPaymentRow);
}

export async function listComps(storeId: string): Promise<CompRecord[]> {
  const { data, error } = await getSupabaseClient().from('comps').select('*')
    .eq('store_id', storeId).order('created_at', { ascending: false });
  if (error) fail(error, 'Could not load comps');
  return (data ?? []).map((row) => mapComp(row as CompRow));
}

export async function createComp(input: {
  shiftId: string;
  itemId: string;
  quantity: number;
  reason: CompRecord['reason'];
  note?: string;
}): Promise<CompRecord> {
  const { data, error } = await getSupabaseClient().rpc('create_comp', {
    p_shift_id: input.shiftId,
    p_item_id: input.itemId,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_note: input.note?.trim() || null,
  });
  if (error) fail(error, 'Could not record comp');
  return mapComp(data as CompRow);
}
