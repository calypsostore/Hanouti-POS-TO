import type { ActivityLogRecord } from '../types/domain';
import { readData, writeData } from './storage';

const getEntries = () => readData<ActivityLogRecord[]>('activity-logs', []);

export const activityLogService = {
  async listForStore(storeId: string): Promise<ActivityLogRecord[]> {
    return getEntries()
      .filter((entry) => entry.storeId === storeId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  async recordCustomerPaymentReversal(
    input: Omit<Extract<ActivityLogRecord, { action: 'customer_payment_reversed' }>, 'id' | 'createdAt'>,
  ): Promise<ActivityLogRecord> {
    const entry: ActivityLogRecord = {
      ...input,
      id: `activity-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    writeData('activity-logs', [...getEntries(), entry]);
    return entry;
  },

  async recordCatalogItemAvailabilityChange(
    input: Omit<Extract<ActivityLogRecord, { action: 'catalog_item_availability_changed' }>, 'id' | 'createdAt'>,
  ): Promise<ActivityLogRecord> {
    const entry: ActivityLogRecord = {
      ...input,
      id: `activity-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    writeData('activity-logs', [...getEntries(), entry]);
    return entry;
  },

  async recordStaffSessionChange(
    input: Omit<Extract<ActivityLogRecord, { action: 'staff_session_locked' | 'staff_session_unlocked' }>, 'id' | 'createdAt'>,
  ): Promise<ActivityLogRecord> {
    const entry: ActivityLogRecord = {
      ...input,
      id: `activity-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
    };
    writeData('activity-logs', [...getEntries(), entry]);
    return entry;
  },
};
