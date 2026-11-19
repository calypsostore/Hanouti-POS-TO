import type { CompReason, CompRecord, PositionRecord } from '../types/domain';
import { catalogService } from './catalogService';
import { readData, writeData } from './storage';
import { shiftService } from './shiftService';
import { userService } from './userService';
import { activityService } from './activityService';

const REASONS: CompReason[] = ['dropped', 'staff_drink', 'free_customer', 'remake', 'other'];
const getComps = () => readData<CompRecord[]>('comps', []);

export interface StaffDrinkAllowance {
  allowed: boolean;
  usedQuantity: number;
  maxQuantity: number;
  remainingQuantity: number;
}

function isAllowedSelfServiceItem(position: PositionRecord, itemId: string, categoryId: string): boolean {
  return (position.selfServiceItemIds ?? []).includes(itemId) ||
    (position.selfServiceCategoryIds ?? []).includes(categoryId);
}

export const compService = {
  async listComps(storeId: string): Promise<CompRecord[]> {
    return getComps()
      .filter((comp) => comp.storeId === storeId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  async getStaffDrinkAllowance(
    storeId: string,
    staffId: string,
    shiftId: string,
    itemId: string,
  ): Promise<StaffDrinkAllowance> {
    const [staff, shift, items, positions] = await Promise.all([
      userService.getUser(staffId),
      shiftService.getShift(shiftId),
      catalogService.listItems(storeId),
      userService.listPositions(storeId),
    ]);
    const item = items.find((candidate) => candidate.id === itemId);
    const position = positions.find((candidate) => candidate.id === staff?.positionId);
    const maxQuantity = position?.maxStaffDrinkQuantityPerShift ?? 0;
    const allowed = staff?.role === 'staff' && staff.storeId === storeId &&
      shift?.storeId === storeId && shift.staffId === staffId &&
      Boolean(item && position && isAllowedSelfServiceItem(position, item.id, item.categoryId)) &&
      Number.isInteger(maxQuantity) && maxQuantity > 0;
    const usedQuantity = getComps()
      .filter((comp) => comp.storeId === storeId && comp.staffId === staffId &&
        comp.shiftId === shiftId && comp.reason === 'staff_drink')
      .reduce((sum, comp) => sum + comp.quantity, 0);
    return {
      allowed,
      usedQuantity,
      maxQuantity,
      remainingQuantity: Math.max(0, maxQuantity - usedQuantity),
    };
  },

  async createComp(input: {
    storeId: string;
    staffId: string;
    shiftId: string;
    itemId: string;
    quantity: number;
    reason: CompReason;
    note?: string;
  }): Promise<CompRecord> {
    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      throw new Error('Comp quantity must be a positive whole number.');
    }
    if (!REASONS.includes(input.reason)) throw new Error('Choose a valid comp reason.');
    const note = input.note?.trim();
    if (note && note.length > 500) throw new Error('Comp note must be 500 characters or fewer.');

    const [store, staff, item, shift] = await Promise.all([
      userService.getStore(input.storeId),
      userService.getUser(input.staffId),
      catalogService.listItems(input.storeId).then((items) => items.find((candidate) => candidate.id === input.itemId)),
      shiftService.getShift(input.shiftId),
    ]);
    if (!store?.isActive) throw new Error('This store is inactive.');
    if (!staff || staff.storeId !== store.id ||
      !(staff.role === 'staff' || (staff.role === 'owner' && store.ownerId === staff.id))) {
      throw new Error('The comp must be recorded by a member of this store.');
    }
    if (staff.role === 'staff' && !await userService.hasPermission(staff.id, 'comp_items')) {
      throw new Error('Your position does not allow comping items.');
    }
    if (!item) throw new Error('Select an active item from this store.');
    if (!shift || shift.storeId !== store.id || shift.staffId !== staff.id ||
      shift.id !== input.shiftId || shift.status !== 'open') {
      throw new Error('Open your shift before recording a comp.');
    }
    if (input.reason === 'staff_drink') {
      const position = (await userService.listPositions(store.id)).find((candidate) => candidate.id === staff.positionId);
      if (staff.role !== 'staff' || !position || !isAllowedSelfServiceItem(position, item.id, item.categoryId)) {
        throw new Error('This item is not allowed for staff drinks in your position.');
      }
      const allowance = await this.getStaffDrinkAllowance(store.id, staff.id, shift.id, item.id);
      if (!allowance.allowed) throw new Error('Staff drinks are not enabled for your position.');
      if (input.quantity > allowance.remainingQuantity) {
        throw new Error(`Staff drink limit reached. Allowed today: ${allowance.usedQuantity} of ${allowance.maxQuantity} used.`);
      }
    }
    const valueMillimes = item.priceMillimes * input.quantity;
    if (!Number.isSafeInteger(valueMillimes)) throw new Error('Comp value is too large.');

    const record: CompRecord = {
      id: `comp-${crypto.randomUUID()}`,
      storeId: store.id,
      staffId: staff.id,
      shiftId: shift.id,
      itemId: item.id,
      name: item.name,
      quantity: input.quantity,
      valueMillimes,
      reason: input.reason,
      note: note || undefined,
      createdAt: new Date().toISOString(),
    };

    await catalogService.decrementStock(item.id, input.quantity, { id: staff.id, name: staff.name });
    try {
      writeData('comps', [...getComps(), record]);
    } catch (saveError) {
      try {
        await catalogService.updateItem(item.id, {
          stockCount: item.stockCount,
          outOfStock: item.outOfStock,
        }, { id: staff.id, name: staff.name });
      } catch (restoreError) {
        throw new Error(
          `Could not save comp record (${saveError instanceof Error ? saveError.message : 'Unknown storage error.'}) and stock could not be restored: ${restoreError instanceof Error ? restoreError.message : 'Unknown inventory error.'}`,
          { cause: restoreError },
        );
      }
      throw new Error(
        `Could not save comp record; inventory was restored: ${saveError instanceof Error ? saveError.message : 'Unknown storage error.'}`,
        { cause: saveError },
      );
    }
    await activityService.log({
      storeId: store.id,
      actorId: staff.id,
      action: 'comp.created',
      summary: `Comped ${input.quantity} × ${item.name} (${input.reason}).`,
      entityType: 'comp',
      entityId: record.id,
      meta: { after: record },
    });
    return record;
  },
};
