import type { OrderLineRecord, OrderRecord, OrderSummaryRecord, PaymentMethod, ShiftRecord } from '../../types/domain';
import { getSupabaseClient } from '../supabaseClient';

interface OrderRow {
  id: string;
  number: number;
  store_id: string;
  business_date: string;
  store_name?: string;
  staff_id: string;
  staff_name?: string;
  shift_id: string;
  location: string | null;
  status: OrderRecord['status'];
  payment_method: PaymentMethod;
  customer_id: string | null;
  note: string | null;
  total_millimes: number;
  created_at: string;
  void_requested_at: string | null;
  voided_at: string | null;
  voided_by: string | null;
  voided_by_user_id: string | null;
  void_reason: string | null;
}

interface OrderLineRow {
  item_id: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  quantity: number;
  unit_price_millimes: number;
  line_total_millimes: number;
  modifiers: string[];
}

function mapLine(row: OrderLineRow): OrderLineRecord {
  return {
    itemId: row.item_id,
    categoryId: row.category_id ?? undefined,
    categoryName: row.category_name ?? undefined,
    name: row.name,
    quantity: row.quantity,
    unitPriceMillimes: Number(row.unit_price_millimes),
    lineTotalMillimes: Number(row.line_total_millimes),
    modifiers: row.modifiers ?? [],
  };
}

function mapOrder(row: OrderRow, itemRows: OrderLineRow[] = []): OrderRecord {
  return {
    id: row.id,
    number: row.number,
    storeId: row.store_id,
    businessDate: row.business_date,
    storeName: row.store_name,
    staffId: row.staff_id,
    staffName: row.staff_name,
    shiftId: row.shift_id,
    location: row.location ?? undefined,
    status: row.status,
    paymentMethod: row.payment_method,
    customerId: row.customer_id ?? undefined,
    note: row.note ?? undefined,
    items: itemRows.map(mapLine),
    totalMillimes: Number(row.total_millimes),
    createdAt: row.created_at,
    voidRequestedAt: row.void_requested_at ?? undefined,
    voidedAt: row.voided_at ?? undefined,
    voidedBy: row.voided_by ?? undefined,
    voidedByUserId: row.voided_by_user_id ?? undefined,
    voidReason: row.void_reason ?? undefined,
  };
}

type JoinedOrderRow = OrderRow & { items?: OrderLineRow[] };

function mapJoinedOrder(row: JoinedOrderRow): OrderRecord {
  return mapOrder(row, row.items ?? []);
}

function mapOrderSummary(row: OrderRow): OrderSummaryRecord {
  const { items: _items, ...summary } = mapOrder(row);
  return summary;
}

export interface OrderListOptions {
  staffId?: string;
  businessDate?: string;
  createdAfter?: string;
  createdBefore?: string;
  shiftId?: string;
  status?: OrderRecord['status'];
  limit?: number;
  range?: { from: number; to: number };
}

function reportWorkflowError(error: { message: string; code?: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

function orderQuery(storeId: string, options: OrderListOptions, includeItems: boolean) {
  const limit = options.limit ?? 200;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Order page size must be a positive whole number.');
  const from = options.range?.from ?? 0;
  const requestedTo = options.range?.to ?? from + limit - 1;
  if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(requestedTo) || requestedTo < from) {
    throw new Error('Order page range is invalid.');
  }
  const to = Math.min(requestedTo, from + limit - 1);
  let query = getSupabaseClient()
    .from('orders')
    .select(includeItems ? '*, items:order_lines(*)' : [
      'id', 'number', 'store_id', 'business_date', 'staff_id', 'shift_id', 'location', 'status',
      'payment_method', 'customer_id', 'note', 'total_millimes', 'created_at',
      'void_requested_at', 'voided_at', 'voided_by', 'voided_by_user_id', 'void_reason',
    ].join(', '))
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (options.staffId) query = query.eq('staff_id', options.staffId);
  if (options.businessDate) query = query.eq('business_date', options.businessDate);
  if (options.createdAfter) query = query.gte('created_at', options.createdAfter);
  if (options.createdBefore) query = query.lte('created_at', options.createdBefore);
  if (options.shiftId) query = query.eq('shift_id', options.shiftId);
  if (options.status) query = query.eq('status', options.status);
  return query;
}

export async function listOrders(storeId: string, options: OrderListOptions = {}): Promise<OrderRecord[]> {
  const { data, error } = await orderQuery(storeId, options, true).returns<JoinedOrderRow[]>();
  if (error) reportWorkflowError(error, 'Could not load orders');
  return (data ?? []).map(mapJoinedOrder);
}

export async function listOrderSummaries(
  storeId: string,
  options: OrderListOptions = {},
): Promise<OrderSummaryRecord[]> {
  const { data, error } = await orderQuery(storeId, options, false).returns<OrderRow[]>();
  if (error) reportWorkflowError(error, 'Could not load order summaries');
  return (data ?? []).map(mapOrderSummary);
}

export async function getOrder(orderId: string): Promise<OrderRecord | undefined> {
  const { data, error } = await getSupabaseClient()
    .from('orders')
    .select('*, items:order_lines(*)')
    .eq('id', orderId)
    .maybeSingle();
  if (error) reportWorkflowError(error, 'Could not load order');
  return data ? mapJoinedOrder(data as JoinedOrderRow) : undefined;
}

export async function createOrder(input: {
  shift: ShiftRecord;
  items: OrderLineRecord[];
  idempotencyKey: string;
  paymentMethod?: PaymentMethod;
  customerId?: string;
  location?: string;
  adminPin?: string;
  note?: string;
}): Promise<OrderRecord> {
  const { data, error } = await getSupabaseClient().rpc('create_order_idempotent', {
    p_idempotency_key: input.idempotencyKey,
    p_shift_id: input.shift.id,
    p_items: input.items.map((item) => ({
      itemId: item.itemId,
      quantity: item.quantity,
      modifiers: item.modifiers ?? [],
    })),
    p_payment_method: input.paymentMethod ?? 'cash',
    p_customer_id: input.customerId ?? null,
    p_location: input.location ?? null,
    p_note: input.note?.trim() || null,
    p_admin_pin: input.adminPin ?? null,
  });
  if (error) {
    if (error.message.includes('credit limit')) throw new Error('Limit reached. Tell the customer.', { cause: error });
    reportWorkflowError(error, 'Could not create order');
  }
  const result = data as {
    order: OrderRow;
    items: OrderLineRow[];
    store_name: string;
    staff_name: string;
  };
  return mapOrder(
    { ...result.order, store_name: result.store_name, staff_name: result.staff_name },
    result.items ?? [],
  );
}

export async function requestVoid(orderId: string, reason: string): Promise<OrderRecord> {
  const { error } = await getSupabaseClient().rpc('request_order_void', {
    p_order_id: orderId,
    p_reason: reason.trim(),
  });
  if (error) reportWorkflowError(error, 'Could not request the order void');
  const order = await getOrder(orderId);
  if (!order) throw new Error('The order was updated but could not be reloaded.');
  return order;
}

export async function voidWithPin(orderId: string, reason: string, pin: string): Promise<OrderRecord> {
  const { error } = await getSupabaseClient().rpc('void_order_with_pin', {
    p_order_id: orderId,
    p_reason: reason.trim(),
    p_pin: pin,
  });
  if (error) reportWorkflowError(error, 'Could not void the order');
  const order = await getOrder(orderId);
  if (!order) throw new Error('The order was voided but could not be reloaded.');
  return order;
}

export async function resolveVoid(
  orderId: string,
  decision: 'approve' | 'reject',
  reason: string | undefined,
  pin: string,
): Promise<OrderRecord> {
  const { error } = await getSupabaseClient().rpc('resolve_order_void', {
    p_order_id: orderId,
    p_decision: decision,
    p_reason: reason?.trim() ?? '',
    p_pin: pin,
  });
  if (error) reportWorkflowError(error, 'Could not resolve the order void');
  const order = await getOrder(orderId);
  if (!order) throw new Error('The void request was resolved but could not be reloaded.');
  return order;
}

export async function getNextOrderNumber(): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc('get_next_order_number');
  if (error) reportWorkflowError(error, 'Could not load the next order number');
  return Number(data);
}

export async function getCurrentBusinessDate(storeId: string): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('get_current_business_date', {
    p_store_id: storeId,
  });
  if (error) reportWorkflowError(error, 'Could not load the current business date');
  if (typeof data !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    throw new Error('Current business date response is invalid.');
  }
  return data;
}

export async function getShiftBreakdown(shiftId: string): Promise<{
  orderCount: number;
  cashSalesMillimes: number;
  cardSalesMillimes: number;
  otherSalesMillimes: number;
  tabSalesMillimes: number;
  tabPaymentsMillimes: number;
  cardTabPaymentsMillimes: number;
  otherTabPaymentsMillimes: number;
  voidsMillimes: number;
}> {
  const client = getSupabaseClient();
  const [
    { data: orders, error: orderError },
    { data: tabs, error: tabError },
    { data: shiftRow, error: shiftError },
  ] = await Promise.all([
    client.from('orders').select('status, payment_method, total_millimes').eq('shift_id', shiftId),
    client.from('tabs').select('id, kind, payment_method, amount_millimes, created_at').eq('shift_id', shiftId),
    client.from('shifts').select('status').eq('id', shiftId).maybeSingle(),
  ]);
  if (orderError) reportWorkflowError(orderError, 'Could not calculate shift sales');
  if (tabError) reportWorkflowError(tabError, 'Could not calculate shift tab payments');
  if (shiftError) reportWorkflowError(shiftError, 'Could not calculate shift status');
  let tabPaymentsMillimes = 0;
  for (const tab of tabs ?? []) {
    if (tab.kind === 'issued') continue;
    if (tab.payment_method !== 'cash') continue;
    if (tab.kind === 'settled') {
      tabPaymentsMillimes += Number(tab.amount_millimes);
      continue;
    }
    if (tab.kind === 'reversal') {
      if (shiftRow?.status === 'open') {
        tabPaymentsMillimes -= Number(tab.amount_millimes);
        continue;
      }
      const { data: included, error: inclusionError } = await client.rpc(
        'is_tab_reversal_included_in_shift_close',
        { p_reversal_id: tab.id, p_reversal_shift_id: shiftId },
      );
      if (inclusionError) reportWorkflowError(inclusionError, 'Could not calculate reversal close inclusion');
      if (included === true) tabPaymentsMillimes -= Number(tab.amount_millimes);
    }
  }
  let cardTabPaymentsMillimes = 0;
  let otherTabPaymentsMillimes = 0;
  for (const tab of tabs ?? []) {
    if (tab.kind === 'issued') continue;
    if (tab.kind === 'settled') {
      if (tab.payment_method === 'card') cardTabPaymentsMillimes += Number(tab.amount_millimes);
      if (tab.payment_method === 'other') otherTabPaymentsMillimes += Number(tab.amount_millimes);
      continue;
    }
    if (tab.kind === 'reversal') {
      if (shiftRow?.status === 'open') {
        if (tab.payment_method === 'card') cardTabPaymentsMillimes -= Number(tab.amount_millimes);
        if (tab.payment_method === 'other') otherTabPaymentsMillimes -= Number(tab.amount_millimes);
        continue;
      }
      const { data: included, error: inclusionError } = await client.rpc(
        'is_tab_reversal_included_in_shift_close',
        { p_reversal_id: tab.id, p_reversal_shift_id: shiftId },
      );
      if (inclusionError) reportWorkflowError(inclusionError, 'Could not calculate reversal close inclusion');
      if (included === true) {
        if (tab.payment_method === 'card') cardTabPaymentsMillimes -= Number(tab.amount_millimes);
        if (tab.payment_method === 'other') otherTabPaymentsMillimes -= Number(tab.amount_millimes);
      }
    }
  }
  return (orders ?? []).reduce((result, order) => {
    if (order.status === 'voided') {
      result.voidsMillimes += Number(order.total_millimes);
      return result;
    }
    if (order.status === 'pending_void') return result;
    if (order.status !== 'done') return result;
    result.orderCount += 1;
    if (order.payment_method === 'cash') result.cashSalesMillimes += Number(order.total_millimes);
    if (order.payment_method === 'card') result.cardSalesMillimes += Number(order.total_millimes);
    if (order.payment_method === 'other') result.otherSalesMillimes += Number(order.total_millimes);
    if (order.payment_method === 'tab') result.tabSalesMillimes += Number(order.total_millimes);
    return result;
  }, {
    orderCount: 0,
    cashSalesMillimes: 0,
    cardSalesMillimes: 0,
    otherSalesMillimes: 0,
    tabSalesMillimes: 0,
    tabPaymentsMillimes,
    cardTabPaymentsMillimes,
    otherTabPaymentsMillimes,
    voidsMillimes: 0,
  });
}

export async function getCashSales(shiftId: string): Promise<number> {
  const breakdown = await getShiftBreakdown(shiftId);
  return breakdown.cashSalesMillimes + breakdown.tabPaymentsMillimes;
}

export async function countPendingVoids(shiftId: string): Promise<number> {
  const { count, error } = await getSupabaseClient()
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('shift_id', shiftId)
    .eq('status', 'pending_void');
  if (error) reportWorkflowError(error, 'Could not count pending void requests');
  return count ?? 0;
}
