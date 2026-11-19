import type { CashMovementReason, CashMovementRecord, ShiftRecord } from '../types/domain';
import { readData, writeData } from './storage';
import { seedShiftsForStore } from './seedData';
import { userService } from './userService';
import { orderService } from './orderService';
import { notificationService } from './notificationService';

const getShifts = () => readData('shifts', seedShiftsForStore);
const getCashMovements = () => readData<CashMovementRecord[]>('cash-movements', []);
const saveShifts = (shifts: ShiftRecord[]) => writeData('shifts', shifts);
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
    return getShifts().filter((shift) => shift.storeId === storeId).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  },

  async listOpenShifts(storeId: string): Promise<ShiftRecord[]> {
    return (await this.listShifts(storeId)).filter((shift) => shift.status === 'open');
  },

  async getOpenShiftForUser(storeId: string, userId: string): Promise<ShiftRecord | undefined> {
    return getShifts().find((shift) => shift.storeId === storeId && shift.staffId === userId && shift.status === 'open');
  },

  async listCashMovements(storeId: string, shiftId?: string): Promise<CashMovementRecord[]> {
    return getCashMovements()
      .filter((movement) => movement.storeId === storeId && (!shiftId || movement.shiftId === shiftId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  async getExpectedCash(shiftId: string): Promise<number> {
    const shift = await this.getShift(shiftId);
    if (!shift) throw new Error('Shift could not be found.');
    if (shift.status === 'closed' && shift.expectedCashMillimes !== undefined) {
      return shift.expectedCashMillimes;
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
    if (!Number.isSafeInteger(input.amountMillimes) || input.amountMillimes <= 0) {
      throw new Error('Cash movement amount must be a positive whole number of millimes.');
    }
    if (input.kind !== 'in' && input.kind !== 'out') throw new Error('Choose cash in or cash out.');
    if (!CASH_MOVEMENT_REASONS.includes(input.reason)) throw new Error('Choose a valid cash movement reason.');
    const note = input.note?.trim();
    if (note && note.length > 500) throw new Error('Cash movement note must be 500 characters or fewer.');
    const shift = await this.getShift(input.shiftId);
    if (!shift || shift.status !== 'open') throw new Error('Cash movements can only be recorded during an open shift.');
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
    if (!Number.isInteger(startingCashMillimes) || startingCashMillimes < 0) throw new Error('Starting cash must be a non-negative amount in millimes.');
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
    if (store.dayClosedOn === todayKey()) await userService.clearDayClosed(storeId);
    return shift;
  },

  async closeShift(shiftId: string, countedCashMillimes: number, differenceNote?: string): Promise<ShiftRecord> {
    if (!Number.isInteger(countedCashMillimes) || countedCashMillimes < 0) throw new Error('Counted cash must be a non-negative amount in millimes.');
    const shifts = getShifts();
    const shift = shifts.find((candidate) => candidate.id === shiftId && candidate.status === 'open');
    if (!shift) throw new Error('Open shift could not be found.');
    const expectedCashMillimes = await this.getExpectedCash(shiftId);
    const differenceMillimes = countedCashMillimes - expectedCashMillimes;
    const cleanedDifferenceNote = validateDifferenceNote(differenceMillimes, differenceNote);
    const updated: ShiftRecord = {
      ...shift,
      status: 'closed',
      countedCashMillimes,
      expectedCashMillimes,
      differenceMillimes,
      differenceNote: cleanedDifferenceNote,
      closedAt: new Date().toISOString(),
    };
    saveShifts(shifts.map((candidate) => candidate.id === shiftId ? updated : candidate));
    return updated;
  },

  async forceCloseShift(shiftId: string, ownerId: string, countedCashMillimes: number, differenceNote?: string): Promise<ShiftRecord> {
    if (!Number.isInteger(countedCashMillimes) || countedCashMillimes < 0) throw new Error('Counted cash must be a non-negative amount in millimes.');
    const shifts = getShifts();
    const shift = shifts.find((candidate) => candidate.id === shiftId && candidate.status === 'open');
    if (!shift) throw new Error('Open shift could not be found.');
    const store = await userService.getStore(shift.storeId);
    if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can force-close the shift.');
    const expectedCashMillimes = await this.getExpectedCash(shiftId);
    const differenceMillimes = countedCashMillimes - expectedCashMillimes;
    const cleanedDifferenceNote = validateDifferenceNote(differenceMillimes, differenceNote);
    const updated: ShiftRecord = {
      ...shift,
      status: 'closed',
      countedCashMillimes,
      expectedCashMillimes,
      differenceMillimes,
      differenceNote: cleanedDifferenceNote,
      closedAt: new Date().toISOString(),
      forceClosedByOwner: true,
      closedByUserId: ownerId,
    };
    saveShifts(shifts.map((candidate) => candidate.id === shiftId ? updated : candidate));
    return updated;
  },

  async recordClosedShiftVoidAdjustment(input: { shiftId: string; orderId: string; orderNumber: number; amountMillimes: number }): Promise<void> {
    if (!Number.isInteger(input.amountMillimes) || input.amountMillimes <= 0) throw new Error('Void adjustment must be a positive amount in millimes.');
    const shifts = getShifts();
    const shift = shifts.find((candidate) => candidate.id === input.shiftId && candidate.status === 'closed');
    if (!shift || shift.voidAdjustments?.some((adjustment) => adjustment.orderId === input.orderId)) return;
    const adjustment = {
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      amountMillimes: -input.amountMillimes,
      createdAt: new Date().toISOString(),
    };
    saveShifts(shifts.map((candidate) => candidate.id === input.shiftId
      ? { ...candidate, voidAdjustments: [...(candidate.voidAdjustments ?? []), adjustment] }
      : candidate));
  },

  async getShift(shiftId: string): Promise<ShiftRecord | undefined> {
    return getShifts().find((shift) => shift.id === shiftId);
  },
};

function validateDifferenceNote(differenceMillimes: number, note?: string): string | undefined {
  const cleanedNote = note?.trim();
  if (differenceMillimes !== 0 && !cleanedNote) throw new Error('Add a short note explaining the cash difference.');
  if (cleanedNote && cleanedNote.length > 200) throw new Error('Cash difference note must be 200 characters or fewer.');
  return cleanedNote || undefined;
}
