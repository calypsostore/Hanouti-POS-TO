import type { CustomerRecord, OrderRecord, SettlementTerms, TabRecord } from '../../types/domain';
import { getSupabaseClient } from '../supabaseClient';
import { listOrders } from './orderRepository';

interface CustomerRow {
  id: string;
  store_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  credit_limit_millimes: number | null;
  settlement_terms: SettlementTerms;
  is_active: boolean;
  last_payment_at: string | null;
  created_at: string;
}

interface TabRow {
  id: string;
  store_id: string;
  customer_id: string;
  order_id: string | null;
  shift_id: string;
  staff_id: string;
  kind: TabRecord['kind'];
  amount_millimes: number;
  note: string | null;
  reverses_tab_id: string | null;
  created_at: string;
}

function mapCustomer(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    notes: row.notes ?? undefined,
    creditLimitMillimes: row.credit_limit_millimes === null ? undefined : Number(row.credit_limit_millimes),
    settlementTerms: row.settlement_terms,
    isActive: row.is_active,
    lastPaymentAt: row.last_payment_at ?? undefined,
    createdAt: row.created_at,
  };
}

function mapTab(row: TabRow): TabRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    customerId: row.customer_id,
    orderId: row.order_id ?? undefined,
    shiftId: row.shift_id,
    staffId: row.staff_id,
    kind: row.kind,
    amountMillimes: Number(row.amount_millimes),
    note: row.note ?? undefined,
    reversesTabId: row.reverses_tab_id ?? undefined,
    createdAt: row.created_at,
  };
}

function repositoryError(error: { message: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

export async function listCustomers(storeId: string, activeOnly = true): Promise<CustomerRecord[]> {
  let query = getSupabaseClient().from('customers').select('*').eq('store_id', storeId).order('name');
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) repositoryError(error, 'Could not load customers');
  return (data ?? []).map((row) => mapCustomer(row as CustomerRow));
}

export async function getCustomer(customerId: string, storeId?: string): Promise<CustomerRecord | undefined> {
  let query = getSupabaseClient().from('customers').select('*').eq('id', customerId);
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query.maybeSingle();
  if (error) repositoryError(error, 'Could not load customer');
  return data ? mapCustomer(data as CustomerRow) : undefined;
}

export async function createCustomer(input: Omit<CustomerRecord, 'id' | 'createdAt' | 'lastPaymentAt'>): Promise<CustomerRecord> {
  const { data, error } = await getSupabaseClient().from('customers').insert({
    store_id: input.storeId,
    name: input.name,
    phone: input.phone ?? null,
    email: input.email ?? null,
    notes: input.notes ?? null,
    credit_limit_millimes: input.creditLimitMillimes ?? null,
    settlement_terms: input.settlementTerms,
    is_active: input.isActive,
  }).select('*').single();
  if (error) repositoryError(error, 'Could not create customer');
  return mapCustomer(data as CustomerRow);
}

export async function updateCustomer(customerId: string, changes: Partial<CustomerRecord>): Promise<CustomerRecord> {
  const { data, error } = await getSupabaseClient().from('customers').update({
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.phone !== undefined ? { phone: changes.phone || null } : {}),
    ...(changes.email !== undefined ? { email: changes.email || null } : {}),
    ...(changes.notes !== undefined ? { notes: changes.notes || null } : {}),
    ...(changes.creditLimitMillimes !== undefined ? { credit_limit_millimes: changes.creditLimitMillimes } : {}),
    ...(changes.settlementTerms !== undefined ? { settlement_terms: changes.settlementTerms } : {}),
    ...(changes.isActive !== undefined ? { is_active: changes.isActive } : {}),
  }).eq('id', customerId).select('*').single();
  if (error) repositoryError(error, 'Could not update customer');
  return mapCustomer(data as CustomerRow);
}

export async function getBalance(customerId: string): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc('get_customer_balance', { p_customer_id: customerId });
  if (error) repositoryError(error, 'Could not load customer balance');
  return Number(data);
}

export async function listTransactions(customerId: string): Promise<TabRecord[]> {
  const { data, error } = await getSupabaseClient().from('tabs').select('*')
    .eq('customer_id', customerId).order('created_at', { ascending: false });
  if (error) repositoryError(error, 'Could not load customer tab transactions');
  return (data ?? []).map((row) => mapTab(row as TabRow));
}

export async function listCustomerOrders(customerId: string): Promise<OrderRecord[]> {
  const customer = await getCustomer(customerId);
  if (!customer) return [];
  return (await listOrders(customer.storeId)).filter((order) => order.customerId === customerId);
}

export async function settleTab(input: {
  customerId: string;
  amountMillimes: number;
  shiftId: string;
  note?: string;
}): Promise<TabRecord> {
  const { data, error } = await getSupabaseClient().rpc('settle_customer_tab', {
    p_customer_id: input.customerId,
    p_amount_millimes: input.amountMillimes,
    p_shift_id: input.shiftId,
    p_payment_method: 'cash',
    p_note: input.note?.trim() || null,
  });
  if (error) repositoryError(error, 'Could not record tab payment');
  return mapTab(data as TabRow);
}

export async function reversePayment(paymentId: string, pin: string, reason: string): Promise<TabRecord> {
  const { data, error } = await getSupabaseClient().rpc('reverse_tab_payment', {
    p_payment_id: paymentId,
    p_pin: pin,
    p_reason: reason.trim(),
  });
  if (error) repositoryError(error, 'Could not reverse tab payment');
  return mapTab(data as TabRow);
}
