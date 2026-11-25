import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerRecord, NotificationRecord, UserRecord } from '../src/types/domain';
import {
  keepUnresolvedItem86Notifications,
  mapNotificationRow,
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

  it('formats legacy millime amounts in notification bodies as DT', async () => {
    const legacy = {
      ...notification('cash-difference'),
      type: 'cash_difference' as const,
      body: "Staff's shift closed with a cash difference of -1223 millimes.",
    };
    localStorage.setItem('7anouti-pos:notifications', JSON.stringify([legacy]));

    await expect(notificationService.listFor(owner)).resolves.toMatchObject([
      { body: "Staff's shift closed with a cash difference of -1.223 DT." },
    ]);

    expect(mapNotificationRow({
      id: legacy.id,
      type: legacy.type,
      title: legacy.title,
      body: legacy.body,
      created_at: legacy.createdAt,
    }).body).toBe("Staff's shift closed with a cash difference of -1.223 DT.");
  });

  it('hides an 86 alert from the dashboard after its catalog item is available again', () => {
    const marked86: NotificationRecord = {
      ...notification('item-86'),
      type: 'item_86',
      catalogItemId: 'item-1',
    };
    const stockAlert: NotificationRecord = {
      ...notification('stock-alert'),
      type: 'stock_depleted',
      catalogItemId: 'item-2',
    };

    expect(keepUnresolvedItem86Notifications([marked86, stockAlert], [
      { id: 'item-1', outOfStock: false },
      { id: 'item-2', outOfStock: true },
    ])).toEqual([stockAlert]);
    expect(keepUnresolvedItem86Notifications([marked86], [
      { id: 'item-1', outOfStock: true },
    ])).toEqual([marked86]);
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
