import type { CashMovementReason, CashMovementRecord, ShiftRecord, TabRecord } from '../types/domain';
import { readData, writeData } from './storage';
import { seedShiftsForStore } from './seedData';
import { userService } from './userService';
import { orderService } from './orderService';
import { notificationService } from './notificationService';
import { activityService } from './activityService';
import { authService } from './authService';
import { offlineOrderQueue } from './offlineOrderQueue';
import { isSupabaseDriver } from '../data/driver';
import { requireOnlineForAction } from './offlineAvailability';
import {
  closeShift as closeRemoteShift,
  forceCloseDay as forceCloseRemoteDay,
  forceCloseShift as forceCloseRemoteShift,
  getExpectedCash as getRemoteExpectedCash,
  getOpenShiftForUser as getRemoteOpenShiftForUser,
  getShift as getRemoteShift,
  listCashMovements as listRemoteCashMovements,
  listShifts as listRemoteShifts,
  openShift as openRemoteShift,
  recordCashMovement as recordRemoteCashMovement,
} from '../data/repositories/shiftRepository';

const getShifts = () => readData('shifts', seedShiftsForStore);
const getCashMovements = () => readData<CashMovementRecord[]>('cash-movements', []);
const saveShifts = (shifts: ShiftRecord[]) => writeData('shifts', shifts);
const getIncludedTabReversalIds = (shiftId: string, closedAt: string): string[] =>
  readData<TabRecord[]>('tabs', [])
    .filter((tab) => tab.storeId && tab.shiftId === shiftId &&
      tab.kind === 'reversal' &&
      new Date(tab.createdAt).getTime() <= new Date(closedAt).getTime())
    .map((tab) => tab.id);
const CASH_MOVEMENT_REASONS: CashMovementReason[] = ['supplier', 'change', 'expense', 'other'];
const todayKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export class CashMovementNotificationError extends Error {
  readonly movement: CashMovementRecord;

  constructor(movement: CashMovementRecord, cause: unknown) {
    super(`Cash movement was recorded, but the owner could not be notified: ${cause instanceof Error ? cause.message : 'Unknown notification error.'}`, { cause });
    this.name = 'CashMovementNotificationError';
    this.movement = movement;
  }
}

export const shiftService = {
  async listShifts(storeId: string): Promise<ShiftRecord[]> {
    if (isSupabaseDriver()) return listRemoteShifts(storeId);
    return getShifts().filter((shift) => shift.storeId === storeId).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  },

  async listOpenShifts(storeId: string): Promise<ShiftRecord[]> {
    return (await this.listShifts(storeId)).filter((shift) => shift.status === 'open');
  },

  async getOpenShiftForUser(storeId: string, userId: string): Promise<ShiftRecord | undefined> {
    if (isSupabaseDriver()) return getRemoteOpenShiftForUser(storeId, userId);
    return getShifts().find((shift) => shift.storeId === storeId && shift.staffId === userId && shift.status === 'open');
  },

  async listCashMovements(storeId: string, shiftId?: string): Promise<CashMovementRecord[]> {
    if (isSupabaseDriver()) return listRemoteCashMovements(storeId, shiftId);
    return getCashMovements()
      .filter((movement) => movement.storeId === storeId && (!shiftId || movement.shiftId === shiftId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  async getExpectedCash(shiftId: string): Promise<number | null> {
    if (isSupabaseDriver()) return getRemoteExpectedCash(shiftId);
    const shift = await this.getShift(shiftId);
    if (!shift) throw new Error('Shift could not be found.');
    if (shift.status === 'closed' && shift.expectedCashMillimes !== undefined) {
      return shift.expectedCashMillimes + (shift.voidAdjustments ?? [])
        .reduce((sum, adjustment) => sum + adjustment.amountMillimes, 0);
    }
    const [cashReceivedMillimes, movements] = await Promise.all([
      orderService.getCashSalesForShift(shiftId),
      this.listCashMovements(shift.storeId, shiftId),
    ]);
    const movementTotal = movements.reduce((total, movement) =>
      total + (movement.kind === 'in' ? movement.amountMillimes : -movement.amountMillimes), 0);
    return shift.startingCashMillimes + cashReceivedMillimes + movementTotal;
  },

  async recordCashMovement(input: {
    shiftId: string;
    actorId: string;
    kind: 'in' | 'out';
    amountMillimes: number;
    reason: CashMovementReason;
    note?: string;
  }): Promise<CashMovementRecord> {
    requireOnlineForAction('Cash movements');
    if (!Number.isSafeInteger(input.amountMillimes) || input.amountMillimes <= 0) {
      throw new Error('Cash movement amount must be a positive whole number of millimes.');
    }
    if (input.kind !== 'in' && input.kind !== 'out') throw new Error('Choose cash in or cash out.');
    if (!CASH_MOVEMENT_REASONS.includes(input.reason)) throw new Error('Choose a valid cash movement reason.');
    const note = input.note?.trim();
    if (note && note.length > 500) throw new Error('Cash movement note must be 500 characters or fewer.');
    if (isSupabaseDriver()) {
      return recordRemoteCashMovement({
        shiftId: input.shiftId,
        kind: input.kind,
        amountMillimes: input.amountMillimes,
        reason: input.reason,
        note,
      });
    }
    const shift = await this.getShift(input.shiftId);
    if (!shift || shift.status !== 'open') throw new Error('The business day is closed. Open a new shift to continue.');
    const [store, actor] = await Promise.all([
      userService.getStore(shift.storeId),
      userService.getUser(input.actorId),
    ]);
    if (!store?.isActive || !actor || actor.storeId !== store.id) {
      throw new Error('This account cannot record cash movements for the selected store.');
    }
    const isOwner = actor.role === 'owner' && store.ownerId === actor.id;
    const isAuthorizedStaff = actor.role === 'staff' && shift.staffId === actor.id &&
      await userService.hasPermission(actor.id, 'cash_in_out');
    if (!isOwner && !isAuthorizedStaff) {
      throw new Error('Your position does not allow cash in / cash out for this shift.');
    }
    const movement: CashMovementRecord = {
      id: `cash-movement-${crypto.randomUUID()}`,
      storeId: store.id,
      shiftId: shift.id,
      staffId: actor.id,
      kind: input.kind,
      amountMillimes: input.amountMillimes,
      reason: input.reason,
      note: note || undefined,
      createdAt: new Date().toISOString(),
    };
    writeData('cash-movements', [...getCashMovements(), movement]);
    await activityService.log({
      storeId: store.id,
      actorId: actor.id,
      action: movement.kind === 'in' ? 'cash.in' : 'cash.out',
      summary: `Recorded cash ${movement.kind} of ${movement.amountMillimes} millimes (${movement.reason}).`,
      entityType: 'cash_movement',
      entityId: movement.id,
      meta: { after: movement },
    });
    if (movement.kind === 'out') {
      try {
        await notificationService.notifyCashOutAboveThreshold(movement, actor.name);
      } catch (notificationError) {
        throw new CashMovementNotificationError(movement, notificationError);
      }
    }
    return movement;
  },

  async openShift(storeId: string, staffId: string, startingCashMillimes: number): Promise<ShiftRecord> {
    requireOnlineForAction('Opening a shift');
    if (!Number.isInteger(startingCashMillimes) || startingCashMillimes < 0) throw new Error('Starting cash must be a non-negative amount in millimes.');
    if (isSupabaseDriver()) return openRemoteShift(startingCashMillimes);
    const store = await userService.getStore(storeId);
    if (!store?.isActive) throw new Error('This store is inactive.');
    if (await this.getOpenShiftForUser(storeId, staffId)) throw new Error('This user already has an open shift.');
    const shift: ShiftRecord = {
      id: `shift-${crypto.randomUUID()}`,
      storeId,
      staffId,
      status: 'open',
      startingCashMillimes,
      openedAt: new Date().toISOString(),
    };
    saveShifts([...getShifts(), shift]);
    const actor = await userService.getUser(staffId);
    await activityService.log({
      storeId,
      actorId: staffId,
      actorName: actor?.name,
      action: 'shift.opened',
      summary: `${actor?.name ?? 'Staff member'} opened a shift with ${startingCashMillimes} millimes starting cash.`,
      entityType: 'shift',
      entityId: shift.id,
      meta: { after: shift },
    });
    await notificationService.notifyShiftOpened(shift.id, storeId, actor?.name ?? 'A staff member');
    if (store.dayClosedOn === todayKey()) await userService.clearDayClosed(storeId);
    return shift;
  },

  async closeShift(shiftId: string, countedCashMillimes: number, differenceNote?: string): Promise<ShiftRecord> {
    requireOnlineForAction('Closing a shift');
    if (!Number.isInteger(countedCashMillimes) || countedCashMillimes < 0) throw new Error('Counted cash must be a non-negative amount in millimes.');
    if (isSupabaseDriver()) {
      if (typeof navigator !== 'undefined' && navigator.onLine) await offlineOrderQueue.flush();
      const unresolvedOrderCount = await offlineOrderQueue.unresolvedCountForShift(shiftId);
      if (unresolvedOrderCount > 0) {
        const orderLabel = unresolvedOrderCount === 1 ? 'order has' : 'orders have';
        throw new Error(
          `${unresolvedOrderCount} ${orderLabel} not synced yet. Connect to the internet and wait for queued orders to sync. ` +
          'For "Needs attention" orders, ask the owner to review the notice on the POS screen; the app has no retry action for them yet.',
        );
      }
      return closeRemoteShift(shiftId, countedCashMillimes, validateDifferenceNote(0, differenceNote));
    }
    const pendingVoidCount = await orderService.getPendingVoidCountForShift(shiftId);
    const shifts = getShifts();
    const shift = shifts.find((candidate) => candidate.id === shiftId && candidate.status === 'open');
    if (!shift) throw new Error('Open shift could not be found.');
    const expectedCashMillimes = await this.getExpectedCash(shiftId);
    if (expectedCashMillimes === null) throw new Error('Expected cash is not available for blind shift closing.');
    const differenceMillimes = countedCashMillimes - expectedCashMillimes;
    const cleanedDifferenceNote = validateDifferenceNote(differenceMillimes, differenceNote);
    const closedAt = new Date().toISOString();
    const updated: ShiftRecord = {
      ...shift,
      status: 'closed',
      countedCashMillimes,
      expectedCashMillimes,
      differenceMillimes,
      differenceNote: cleanedDifferenceNote,
      closedAt,
      includedTabReversalIds: getIncludedTabReversalIds(shiftId, closedAt),
      pendingVoidCount,
    };
    saveShifts(shifts.map((candidate) => candidate.id === shiftId ? updated : candidate));
    const actor = await userService.getUser(shift.staffId);
    await activityService.log({
      storeId: shift.storeId,
      actorId: shift.staffId,
      actorName: actor?.name,
      action: 'shift.closed',
      summary: `Closed shift with a cash difference of ${differenceMillimes} millimes.`,
      entityType: 'shift',
      entityId: shift.id,
      meta: { before: shift, after: updated },
    });
    await notificationService.notifyShiftClosed(shift.id, shift.storeId, actor?.name ?? 'A staff member', differenceMillimes);
    return updated;
  },

  async forceCloseShift(shiftId: string, ownerPin: string): Promise<ShiftRecord> {
    requireOnlineForAction('Closing a shift');
    if (isSupabaseDriver()) return forceCloseRemoteShift(shiftId, ownerPin);
    const shifts = getShifts();
    const shift = shifts.find((candidate) => candidate.id === shiftId && candidate.status === 'open');
    if (!shift) throw new Error('Open shift could not be found.');
    const store = await userService.getStore(shift.storeId);
    const actor = await authService.getCurrentUser();
    if (!store || !actor || actor.role !== 'owner' || actor.id !== store.ownerId || actor.storeId !== store.id) {
      throw new Error('Only this store owner can force-close the shift.');
    }
    if (!await userService.verifyStorePin(store.id, ownerPin, 'z_report')) throw new Error('Incorrect owner PIN.');
    const autoApproved = await orderService.autoApprovePendingVoids(store.id, actor.id, shift.id);
    const expectedCashMillimes = await this.getExpectedCash(shiftId);
    if (expectedCashMillimes === null) throw new Error('Expected cash is not available for blind shift closing.');
    const closedAt = new Date().toISOString();
    const updated: ShiftRecord = {
      ...shift,
      status: 'closed',
      countedCashMillimes: expectedCashMillimes,
      expectedCashMillimes,
      differenceMillimes: 0,
      differenceNote: undefined,
      closedAt,
      includedTabReversalIds: getIncludedTabReversalIds(shiftId, closedAt),
      forceClosedByOwner: true,
      closedByUserId: actor.id,
      voidsAutoApprovedCount: (shift.voidsAutoApprovedCount ?? 0) + autoApproved.length,
      pendingVoidCount: 0,
    };
    saveShifts(shifts.map((candidate) => candidate.id === shiftId ? updated : candidate));
    await activityService.log({
      storeId: shift.storeId,
      actorId: actor.id,
      action: 'shift.force_closed',
      summary: `Force-closed ${shift.staffId}'s shift at zero difference.`,
      entityType: 'shift',
      entityId: shift.id,
      meta: { before: shift, after: updated },
    });
    const staff = await userService.getUser(shift.staffId);
    await notificationService.notifyShiftClosed(shift.id, shift.storeId, staff?.name ?? 'A staff member', 0);
    return updated;
  },

  async forceCloseDay(ownerPin: string): Promise<{
    shifts: ShiftRecord[];
    orders: { id: string; ticketNumber: number; totalMillimes: number; shiftId: string }[];
  }> {
    requireOnlineForAction('Closing the business day');
    if (isSupabaseDriver()) return forceCloseRemoteDay(ownerPin);
    const actor = await authService.getCurrentUser();
    const store = actor?.storeId ? await userService.getStore(actor.storeId) : undefined;
    if (!actor || actor.role !== 'owner' || !store || store.ownerId !== actor.id) {
      throw new Error('Only this store owner can force-close the business day.');
    }
    if (!await userService.verifyStorePin(store.id, ownerPin, 'z_report')) throw new Error('Incorrect owner PIN.');
    const approvedOrders = await orderService.autoApprovePendingVoids(store.id, actor.id);
    let storeShifts = getShifts();
    const approvedCounts = new Map<string, number>();
    for (const order of approvedOrders) approvedCounts.set(order.shiftId, (approvedCounts.get(order.shiftId) ?? 0) + 1);
    storeShifts = storeShifts.map((shift) => shift.storeId === store.id && shift.status === 'closed' && approvedCounts.has(shift.id)
      ? { ...shift, voidsAutoApprovedCount: (shift.voidsAutoApprovedCount ?? 0) + (approvedCounts.get(shift.id) ?? 0) }
      : shift);
    saveShifts(storeShifts);
    const openShifts = storeShifts.filter((shift) => shift.storeId === store.id && shift.status === 'open');
    const now = new Date().toISOString();
    const closed: ShiftRecord[] = storeShifts.filter((shift) =>
      shift.storeId === store.id && shift.status === 'closed' && approvedCounts.has(shift.id));
    for (const shift of openShifts) {
      const expectedCashMillimes = await this.getExpectedCash(shift.id);
      if (expectedCashMillimes === null) throw new Error('Expected cash is not available for blind shift closing.');
      const count = approvedCounts.get(shift.id) ?? 0;
      const updated: ShiftRecord = {
        ...shift,
        status: 'closed',
        countedCashMillimes: expectedCashMillimes,
        expectedCashMillimes,
        differenceMillimes: 0,
        differenceNote: undefined,
        closedAt: now,
        includedTabReversalIds: getIncludedTabReversalIds(shift.id, now),
        forceClosedByOwner: true,
        closedByUserId: actor.id,
        voidsAutoApprovedCount: (shift.voidsAutoApprovedCount ?? 0) + count,
        pendingVoidCount: 0,
      };
      saveShifts(getShifts().map((candidate) => candidate.id === shift.id ? updated : candidate));
      closed.push(updated);
      await activityService.log({
        storeId: store.id,
        actorId: actor.id,
        action: 'shift.force_closed',
        summary: `Force-closed ${shift.staffId}'s shift at zero difference.`,
        entityType: 'shift',
        entityId: shift.id,
        meta: { before: shift, after: updated },
      });
      const staff = await userService.getUser(shift.staffId);
      await notificationService.notifyShiftClosed(shift.id, store.id, staff?.name ?? 'A staff member', 0);
    }
    return {
      shifts: closed,
      orders: approvedOrders.map((order) => ({
        id: order.id,
        ticketNumber: order.number,
        totalMillimes: order.totalMillimes,
        shiftId: order.shiftId,
      })),
    };
  },

  async recordClosedShiftVoidAdjustment(input: {
    shiftId: string;
    orderId: string;
    orderNumber: number;
    kind: 'requested' | 'rejected' | 'approved';
    amountMillimes: number;
    actorId?: string;
  }): Promise<void> {
    if (!Number.isSafeInteger(input.amountMillimes) || input.amountMillimes === 0) {
      throw new Error('Void adjustment must be a non-zero whole number of millimes.');
    }
    if (isSupabaseDriver()) return;
    const shifts = getShifts();
    const shift = shifts.find((candidate) => candidate.id === input.shiftId && candidate.status === 'closed');
    if (!shift || shift.voidAdjustments?.some((adjustment) =>
      adjustment.orderId === input.orderId && (adjustment.kind ?? 'approved') === input.kind)) return;
    const adjustment = {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      kind: input.kind,
      amountMillimes: input.amountMillimes,
      createdAt: new Date().toISOString(),
    };
    const voidAdjustments = [...(shift.voidAdjustments ?? []), adjustment];
    const adjustedExpected = shift.expectedCashMillimes === undefined
      ? undefined
      : shift.expectedCashMillimes + voidAdjustments.reduce((sum, row) => sum + row.amountMillimes, 0);
    const updatedShift = {
      ...shift,
      voidAdjustments,
      differenceMillimes: shift.countedCashMillimes !== undefined && adjustedExpected !== undefined
        ? shift.countedCashMillimes - adjustedExpected
        : shift.differenceMillimes,
    };
    saveShifts(shifts.map((candidate) => candidate.id === input.shiftId
      ? updatedShift
      : candidate));
    await activityService.log({
      storeId: shift.storeId,
      actorId: input.actorId,
      action: 'shift.void_adjustment',
      summary: `Recorded a ${input.kind} void adjustment for order #${input.orderNumber}.`,
      entityType: 'shift',
      entityId: shift.id,
      meta: { before: shift.voidAdjustments ?? [], after: updatedShift.voidAdjustments },
    });
  },

  async getShift(shiftId: string): Promise<ShiftRecord | undefined> {
    if (isSupabaseDriver()) return getRemoteShift(shiftId);
    return getShifts().find((shift) => shift.id === shiftId);
  },
};

function validateDifferenceNote(differenceMillimes: number, note?: string): string | undefined {
  const cleanedNote = note?.trim();
  if (differenceMillimes !== 0 && !cleanedNote) throw new Error('Add a short note explaining the cash difference.');
  if (cleanedNote && cleanedNote.length > 200) throw new Error('Cash difference note must be 200 characters or fewer.');
  return cleanedNote || undefined;
}
