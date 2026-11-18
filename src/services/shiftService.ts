import type { ShiftRecord } from '../types/domain';
import { readData, writeData } from './storage';
import { seedShiftsForStore } from './seedData';
import { userService } from './userService';

const getShifts = () => readData('shifts', seedShiftsForStore);
const saveShifts = (shifts: ShiftRecord[]) => writeData('shifts', shifts);
const todayKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

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

    const store = await userService.getStore(storeId);
    if (store?.dayClosedOn === todayKey()) {
      const stores = (await userService.listStores()).map((candidate) => candidate.id === storeId ? { ...candidate, dayClosedOn: undefined } : candidate);
      writeData('stores', stores);
    }
    return shift;
  },

  async closeShift(shiftId: string, countedCashMillimes: number, cashSalesMillimes: number): Promise<ShiftRecord> {
    if (!Number.isInteger(countedCashMillimes) || countedCashMillimes < 0) throw new Error('Counted cash must be a non-negative amount in millimes.');
    const shifts = getShifts();
    const shift = shifts.find((candidate) => candidate.id === shiftId && candidate.status === 'open');
    if (!shift) throw new Error('Open shift could not be found.');
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

  async getShift(shiftId: string): Promise<ShiftRecord | undefined> {
    return getShifts().find((shift) => shift.id === shiftId);
  },
};
