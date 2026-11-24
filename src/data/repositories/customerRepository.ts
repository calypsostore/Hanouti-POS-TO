import type { CustomerRecord, OrderRecord, OrderSummaryRecord, SettlementTerms, TabRecord } from '../../types/domain';
import { getSupabaseClient } from '../supabaseClient';
import { listOrderSummaries, listOrders } from './orderRepository';

const CUSTOMER_ID_BATCH_SIZE = 50;
const CUSTOMER_ORDER_LIMIT = 200;
const CUSTOMER_TRANSACTION_LIMIT = 1000;
const QUERY_PAGE_SIZE = 1000;
const TAB_COLUMNS = 'id, store_id, customer_id, order_id, shift_id, staff_id, kind, payment_method, amount_millimes, note, reverses_tab_id, created_at, reversal_attribution, reversal_post_close_at' as const;

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
  payment_method: TabRecord['paymentMethod'];
  amount_millimes: number;
  note: string | null;
  reverses_tab_id: string | null;
  created_at: string;
  reversal_attribution: 'same_shift' | 'post_close' | null;
  reversal_post_close_at: string | null;
}

export interface CustomerCreditBalance {
  customerId: string;
  balanceMillimes: number;
  creditLimitMillimes: number | null;
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
    paymentMethod: row.payment_method,
    amountMillimes: Number(row.amount_millimes),
    note: row.note ?? undefined,
    reversesTabId: row.reverses_tab_id ?? undefined,
    createdAt: row.created_at,
    reversalPostCloseAt: row.reversal_post_close_at ?? undefined,
    reversalAttribution: row.reversal_attribution ?? undefined,
  };
}

function repositoryError(error: { message: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

export async function listCustomers(storeId: string, activeOnly = true): Promise<CustomerRecord[]> {
  let query = getSupabaseClient()
    .from('customers')
    .select('id, store_id, name, phone, email, notes, credit_limit_millimes, settlement_terms, is_active, last_payment_at, created_at')
    .eq('store_id', storeId)
    .order('name');
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) repositoryError(error, 'Could not load customers');
  return (data ?? []).map((row) => mapCustomer(row as CustomerRow));
}

export async function getCustomer(customerId: string, storeId?: string): Promise<CustomerRecord | undefined> {
  let query = getSupabaseClient()
    .from('customers')
    .select('id, store_id, name, phone, email, notes, credit_limit_millimes, settlement_terms, is_active, last_payment_at, created_at')
    .eq('id', customerId);
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

export async function listCreditBalances(storeId: string): Promise<CustomerCreditBalance[]> {
  const { data, error } = await getSupabaseClient().rpc('get_customers_credit_status', {
    p_store_id: storeId,
  });
  if (error) repositoryError(error, 'Could not load customer credit statuses');
  return ((data ?? []) as {
    customer_id: string;
    balance_millimes: number | string;
    credit_limit_millimes: number | string | null;
  }[]).map((row) => ({
    customerId: row.customer_id,
    balanceMillimes: Number(row.balance_millimes),
    creditLimitMillimes: row.credit_limit_millimes === null ? null : Number(row.credit_limit_millimes),
  }));
}

export async function listTransactions(customerId: string): Promise<TabRecord[]> {
  const { data, error } = await getSupabaseClient().from('tabs')
    .select(TAB_COLUMNS)
    .eq('customer_id', customerId).order('created_at', { ascending: false });
  if (error) repositoryError(error, 'Could not load customer tab transactions');
  return (data ?? []).map((row) => mapTab(row as TabRow));
}

export async function listCustomerOrderSummaries(
  storeId: string,
  customerIds: string[],
): Promise<OrderSummaryRecord[]> {
  const summaries: OrderSummaryRecord[] = [];
  for (let start = 0; start < customerIds.length; start += CUSTOMER_ID_BATCH_SIZE) {
    const batch = customerIds.slice(start, start + CUSTOMER_ID_BATCH_SIZE);
    const counts = new Map<string, number>();
    const seenOrderIds = new Set<string>();
    let remainingCustomerIds = batch;
    let offset = 0;
    while (remainingCustomerIds.length > 0) {
      const page = await listOrderSummaries(storeId, {
        customerIds: remainingCustomerIds,
        limit: QUERY_PAGE_SIZE,
        range: { from: offset, to: offset + QUERY_PAGE_SIZE - 1 },
      });
      for (const order of page) {
        const customerId = order.customerId;
        if (!customerId || seenOrderIds.has(order.id)) continue;
        seenOrderIds.add(order.id);
        const count = counts.get(customerId) ?? 0;
        if (count < CUSTOMER_ORDER_LIMIT) {
          summaries.push(order);
          counts.set(customerId, count + 1);
        }
      }
      const nextRemainingCustomerIds = remainingCustomerIds.filter((customerId) =>
        (counts.get(customerId) ?? 0) < CUSTOMER_ORDER_LIMIT,
      );
      if (nextRemainingCustomerIds.length === 0) break;
      if (nextRemainingCustomerIds.length < remainingCustomerIds.length) {
        remainingCustomerIds = nextRemainingCustomerIds;
        offset = 0;
      } else {
        if (page.length < QUERY_PAGE_SIZE) break;
        offset += page.length;
      }
    }
  }
  return summaries;
}

export async function listTransactionsForCustomers(customerIds: string[]): Promise<TabRecord[]> {
  const transactions: TabRecord[] = [];
  const client = getSupabaseClient();
  for (let start = 0; start < customerIds.length; start += CUSTOMER_ID_BATCH_SIZE) {
    const batch = customerIds.slice(start, start + CUSTOMER_ID_BATCH_SIZE);
    const counts = new Map<string, number>();
    const seenTransactionIds = new Set<string>();
    let remainingCustomerIds = batch;
    let offset = 0;
    while (remainingCustomerIds.length > 0) {
      const { data, error } = await client.from('tabs')
        .select(TAB_COLUMNS)
        .in('customer_id', remainingCustomerIds)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(offset, offset + QUERY_PAGE_SIZE - 1);
      if (error) repositoryError(error, 'Could not load customer tab transactions');
      const page = (data ?? []).map((row) => mapTab(row as TabRow));
      for (const transaction of page) {
        if (seenTransactionIds.has(transaction.id)) continue;
        seenTransactionIds.add(transaction.id);
        const count = counts.get(transaction.customerId) ?? 0;
        if (count < CUSTOMER_TRANSACTION_LIMIT) {
          transactions.push(transaction);
          counts.set(transaction.customerId, count + 1);
        }
      }
      const nextRemainingCustomerIds = remainingCustomerIds.filter((customerId) =>
        (counts.get(customerId) ?? 0) < CUSTOMER_TRANSACTION_LIMIT,
      );
      if (nextRemainingCustomerIds.length === 0) break;
      if (nextRemainingCustomerIds.length < remainingCustomerIds.length) {
        remainingCustomerIds = nextRemainingCustomerIds;
        offset = 0;
      } else {
        if (page.length < QUERY_PAGE_SIZE) break;
        offset += page.length;
      }
    }
  }
  return transactions;
}

export async function listCustomerOrders(customerId: string, storeId?: string): Promise<OrderRecord[]> {
  const customer = storeId ? undefined : await getCustomer(customerId);
  const resolvedStoreId = storeId ?? customer?.storeId;
  if (!resolvedStoreId) return [];
  return listOrders(resolvedStoreId, { customerId });
}

export async function settleTab(input: {
  customerId: string;
  amountMillimes: number;
  shiftId: string;
  paymentMethod?: 'cash' | 'card' | 'other';
  idempotencyKey?: string;
  note?: string;
}): Promise<TabRecord> {
  const { data, error } = await getSupabaseClient().rpc('settle_customer_tab', {
    p_customer_id: input.customerId,
    p_amount_millimes: input.amountMillimes,
    p_shift_id: input.shiftId,
    p_payment_method: input.paymentMethod ?? 'cash',
    p_idempotency_key: input.idempotencyKey ?? null,
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
