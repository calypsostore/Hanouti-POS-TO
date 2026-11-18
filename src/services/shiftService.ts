import type { ShiftRecord } from '../types/domain';
import { readData, writeData } from './storage';
import { seedShiftsForStore } from './seedData';
import { userService } from './userService';
import { orderService } from './orderService';

const getShifts = () => readData('shifts', seedShiftsForStore);
const saveShifts = (shifts: ShiftRecord[]) => writeData('shifts', shifts);

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

  async openShift(storeId: string, staffId: string, startingCashMillimes: number): Promise<ShiftRecord> {
    if (!Number.isInteger(startingCashMillimes) || startingCashMillimes < 0) throw new Error('Starting cash must be a non-negative amount in millimes.');
    if (!(await userService.getStore(storeId))?.isActive) throw new Error('This store is inactive.');
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
    return shift;
  },

  async closeShift(shiftId: string, countedCashMillimes: number): Promise<ShiftRecord> {
    if (!Number.isInteger(countedCashMillimes) || countedCashMillimes < 0) throw new Error('Counted cash must be a non-negative amount in millimes.');
    const shifts = getShifts();
    const shift = shifts.find((candidate) => candidate.id === shiftId && candidate.status === 'open');
    if (!shift) throw new Error('Open shift could not be found.');
    const cashSalesMillimes = await orderService.getCashSalesForShift(shiftId);
    const expectedCashMillimes = shift.startingCashMillimes + cashSalesMillimes;
    const updated: ShiftRecord = {
      ...shift,
      status: 'closed',
      countedCashMillimes,
      expectedCashMillimes,
      differenceMillimes: countedCashMillimes - expectedCashMillimes,
      closedAt: new Date().toISOString(),
    };
    saveShifts(shifts.map((candidate) => candidate.id === shiftId ? updated : candidate));
    return updated;
  },

  async forceCloseShift(shiftId: string, ownerId: string, countedCashMillimes: number): Promise<ShiftRecord> {
    if (!Number.isInteger(countedCashMillimes) || countedCashMillimes < 0) throw new Error('Counted cash must be a non-negative amount in millimes.');
    const shifts = getShifts();
    const shift = shifts.find((candidate) => candidate.id === shiftId && candidate.status === 'open');
    if (!shift) throw new Error('Open shift could not be found.');
    const store = await userService.getStore(shift.storeId);
    if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can force-close the shift.');
    const cashSalesMillimes = await orderService.getCashSalesForShift(shiftId);
    const expectedCashMillimes = shift.startingCashMillimes + cashSalesMillimes;
    const updated: ShiftRecord = {
      ...shift,
      status: 'closed',
      countedCashMillimes,
      expectedCashMillimes,
      differenceMillimes: countedCashMillimes - expectedCashMillimes,
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
