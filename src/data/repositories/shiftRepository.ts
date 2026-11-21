import type { CashMovementReason, CashMovementRecord, ShiftRecord, ShiftVoidAdjustment } from '../../types/domain';
import { getSupabaseClient } from '../supabaseClient';

interface ShiftRow {
  id: string;
  store_id: string;
  staff_id: string;
  status: ShiftRecord['status'];
  starting_cash_millimes: number;
  counted_cash_millimes: number | null;
  expected_cash_millimes: number | null;
  difference_millimes: number | null;
  opened_at: string;
  closed_at: string | null;
  force_closed_by_owner: boolean;
  voids_auto_approved_count: number;
  closed_by_user_id: string | null;
  difference_note: string | null;
}

interface CashMovementRow {
  id: string;
  store_id: string;
  shift_id: string;
  staff_id: string;
  kind: 'in' | 'out';
  amount_millimes: number;
  reason: CashMovementReason;
  note: string | null;
  created_at: string;
}

interface AdjustmentRow {
  shift_id?: string;
  order_id: string;
  order_number: number;
  amount_millimes: number;
  kind: ShiftVoidAdjustment['kind'];
  created_at: string;
}

function mapShift(row: ShiftRow, adjustments: AdjustmentRow[] = []): ShiftRecord {
  const voidAdjustments: ShiftVoidAdjustment[] = adjustments.map((adjustment) => ({
    orderId: adjustment.order_id,
    orderNumber: adjustment.order_number,
    amountMillimes: Number(adjustment.amount_millimes),
    kind: adjustment.kind,
    createdAt: adjustment.created_at,
  }));
  return {
    id: row.id,
    storeId: row.store_id,
    staffId: row.staff_id,
    status: row.status,
    startingCashMillimes: Number(row.starting_cash_millimes),
    countedCashMillimes: row.counted_cash_millimes === null ? undefined : Number(row.counted_cash_millimes),
    expectedCashMillimes: row.expected_cash_millimes === null ? undefined : Number(row.expected_cash_millimes),
    differenceMillimes: row.difference_millimes === null ? undefined : Number(row.difference_millimes),
    openedAt: row.opened_at,
    closedAt: row.closed_at ?? undefined,
    forceClosedByOwner: row.force_closed_by_owner,
    voidsAutoApprovedCount: Number(row.voids_auto_approved_count ?? 0),
    closedByUserId: row.closed_by_user_id ?? undefined,
    differenceNote: row.difference_note ?? undefined,
    voidAdjustments,
  };
}

function mapCashMovement(row: CashMovementRow): CashMovementRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    shiftId: row.shift_id,
    staffId: row.staff_id,
    kind: row.kind,
    amountMillimes: Number(row.amount_millimes),
    reason: row.reason,
    note: row.note ?? undefined,
    createdAt: row.created_at,
  };
}

function workflowError(error: { message: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

async function adjustmentsForShift(shiftId: string): Promise<AdjustmentRow[]> {
  const { data, error } = await getSupabaseClient()
    .from('shift_void_adjustments')
    .select('order_id, order_number, amount_millimes, kind, created_at')
    .eq('shift_id', shiftId)
    .order('created_at');
  if (error) workflowError(error, 'Could not load shift void adjustments');
  return (data ?? []) as AdjustmentRow[];
}

export async function listShifts(storeId: string): Promise<ShiftRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from('shifts')
    .select('*')
    .eq('store_id', storeId)
    .order('opened_at', { ascending: false });
  if (error) workflowError(error, 'Could not load shifts');
  const rows = (data ?? []) as ShiftRow[];
  if (rows.length === 0) return [];
  const { data: adjustments, error: adjustmentError } = await getSupabaseClient()
    .from('shift_void_adjustments')
    .select('shift_id, order_id, order_number, amount_millimes, kind, created_at')
    .in('shift_id', rows.map((row) => row.id))
    .order('created_at');
  if (adjustmentError) workflowError(adjustmentError, 'Could not load shift void adjustments');
  const adjustmentsByShift = new Map<string, AdjustmentRow[]>();
  for (const adjustment of (adjustments ?? []) as AdjustmentRow[]) {
    if (!adjustment.shift_id) continue;
    const records = adjustmentsByShift.get(adjustment.shift_id) ?? [];
    records.push(adjustment);
    adjustmentsByShift.set(adjustment.shift_id, records);
  }
  return rows.map((row) => mapShift(row, adjustmentsByShift.get(row.id)));
}

export async function getShift(shiftId: string): Promise<ShiftRecord | undefined> {
  const { data, error } = await getSupabaseClient()
    .from('shifts')
    .select('*')
    .eq('id', shiftId)
    .maybeSingle();
  if (error) workflowError(error, 'Could not load shift');
  if (!data) return undefined;
  const adjustments = await adjustmentsForShift(shiftId);
  return mapShift(data as ShiftRow, adjustments);
}

export async function getOpenShiftForUser(storeId: string, userId: string): Promise<ShiftRecord | undefined> {
  const { data, error } = await getSupabaseClient()
    .from('shifts')
    .select('*')
    .eq('store_id', storeId)
    .eq('staff_id', userId)
    .eq('status', 'open')
    .maybeSingle();
  if (error) workflowError(error, 'Could not load open shift');
  return data ? mapShift(data as ShiftRow) : undefined;
}

export async function listCashMovements(storeId: string, shiftId?: string): Promise<CashMovementRecord[]> {
  let query = getSupabaseClient()
    .from('cash_movements')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false });
  if (shiftId) query = query.eq('shift_id', shiftId);
  const { data, error } = await query;
  if (error) workflowError(error, 'Could not load cash movements');
  return (data ?? []).map((row) => mapCashMovement(row as CashMovementRow));
}

export async function openShift(startingCashMillimes: number): Promise<ShiftRecord> {
  const { data, error } = await getSupabaseClient().rpc('open_shift', { p_starting_cash_millimes: startingCashMillimes });
  if (error) workflowError(error, 'Could not open shift');
  return mapShift(data as ShiftRow);
}

export async function closeShift(shiftId: string, countedCashMillimes: number, differenceNote?: string): Promise<ShiftRecord> {
  const { data, error } = await getSupabaseClient().rpc('close_shift', {
    p_shift_id: shiftId,
    p_counted_cash_millimes: countedCashMillimes,
    p_difference_note: differenceNote?.trim() || null,
  });
  if (error) workflowError(error, 'Could not close shift');
  const result = data as { shift: ShiftRow; pendingVoidCount: number };
  return { ...mapShift(result.shift), pendingVoidCount: result.pendingVoidCount };
}

export async function forceCloseShift(shiftId: string, ownerPin: string): Promise<ShiftRecord> {
  const { data, error } = await getSupabaseClient().rpc('force_close_shift', {
    p_shift_id: shiftId,
    p_pin: ownerPin,
  });
  if (error) workflowError(error, 'Could not force-close shift');
  const result = data as { shift: ShiftRow; voidsAutoApprovedCount: number };
  return {
    ...mapShift(result.shift),
    voidsAutoApprovedCount: result.voidsAutoApprovedCount,
  };
}

export async function forceCloseDay(ownerPin: string): Promise<{
  shifts: ShiftRecord[];
  orders: { id: string; ticketNumber: number; totalMillimes: number; shiftId: string }[];
}> {
  const { data, error } = await getSupabaseClient().rpc('force_close_day', { p_pin: ownerPin });
  if (error) workflowError(error, 'Could not force-close the business day');
  const result = data as {
    shifts: ShiftRow[];
    orders: { id: string; ticketNumber: number; totalMillimes: number; shiftId: string }[];
  };
  return {
    shifts: result.shifts.map((shift) => mapShift(shift)),
    orders: result.orders.map((order) => ({
      ...order,
      ticketNumber: Number(order.ticketNumber),
      totalMillimes: Number(order.totalMillimes),
    })),
  };
}

export async function recordCashMovement(input: {
  shiftId: string;
  kind: 'in' | 'out';
  amountMillimes: number;
  reason: CashMovementReason;
  note?: string;
}): Promise<CashMovementRecord> {
  const { data, error } = await getSupabaseClient().rpc('record_cash_movement', {
    p_shift_id: input.shiftId,
    p_kind: input.kind,
    p_amount_millimes: input.amountMillimes,
    p_reason: input.reason,
    p_note: input.note?.trim() || null,
  });
  if (error) workflowError(error, 'Could not record cash movement');
  return mapCashMovement(data as CashMovementRow);
}

export async function getExpectedCash(shiftId: string): Promise<number> {
  const { data, error } = await getSupabaseClient().rpc('get_shift_expected_cash', { p_shift_id: shiftId });
  if (error) workflowError(error, 'Could not calculate expected cash');
  return Number(data);
}
