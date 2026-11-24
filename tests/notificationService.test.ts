import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerRecord, NotificationRecord, UserRecord } from '../src/types/domain';
import {
  notificationService,
  shouldRegisterPushNotifications,
} from '../src/services/notificationService';
import { customerService } from '../src/services/customerService';

const owner: Pick<UserRecord, 'id' | 'role' | 'storeId'> = {
  id: 'owner-1',
  role: 'owner',
  storeId: 'store-1',
};

function notification(id: string): NotificationRecord {
  return {
    id,
    storeId: owner.storeId,
    userId: owner.id,
    type: 'void_requested',
    title: `Notification ${id}`,
    body: 'A new notification.',
    createdAt: new Date().toISOString(),
  };
}

describe('notification service', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('marks the current unread notifications as read without marking later arrivals', async () => {
    const initial = notification('initial');
    const later = notification('later');
    localStorage.setItem('7anouti-pos:notifications', JSON.stringify([initial]));

    const listFor = notificationService.listFor.bind(notificationService);
    vi.spyOn(notificationService, 'listFor').mockImplementation(async (user) => {
      const snapshot = await listFor(user);
      localStorage.setItem('7anouti-pos:notifications', JSON.stringify([...snapshot, later]));
      return snapshot;
    });

    await notificationService.markAllRead(owner);

    const saved = JSON.parse(localStorage.getItem('7anouti-pos:notifications') ?? '[]') as NotificationRecord[];
    expect(saved.find(({ id }) => id === initial.id)?.readAt).toBeTruthy();
    expect(saved.find(({ id }) => id === later.id)?.readAt).toBeUndefined();
  });

  it('only registers native push when explicitly enabled for a Supabase store', () => {
    expect(shouldRegisterPushNotifications(false, true, true, owner.storeId)).toBe(false);
    expect(shouldRegisterPushNotifications(true, true, true, owner.storeId)).toBe(true);
    expect(shouldRegisterPushNotifications(true, false, true, owner.storeId)).toBe(false);
    expect(shouldRegisterPushNotifications(true, true, false, owner.storeId)).toBe(false);
  });

  it('builds customer alerts from supplied batched credit data', async () => {
    const customers: CustomerRecord[] = [{
      id: 'customer-1',
      storeId: owner.storeId,
      name: 'Customer One',
      settlementTerms: 'monthly',
      isActive: true,
      createdAt: '',
    }];
    const getCreditStatuses = vi.spyOn(customerService, 'getCreditStatuses');
    const getDueInfos = vi.spyOn(customerService, 'getDueInfos');

    await expect(notificationService.listCustomerCreditAlerts(owner.storeId, customers, {
      creditStatuses: {
        'customer-1': { balance: 8_000, limit: 10_000, percentUsed: 80, state: 'near' },
      },
      dueInfos: { 'customer-1': { overdue: false } },
    })).resolves.toEqual([{
      customerId: 'customer-1',
      customerName: 'Customer One',
      severity: 'warning',
      message: 'Customer is near their credit limit.',
    }]);
    expect(getCreditStatuses).not.toHaveBeenCalled();
    expect(getDueInfos).not.toHaveBeenCalled();
  });
});
