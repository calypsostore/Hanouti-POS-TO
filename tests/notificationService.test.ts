import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CustomerRecord, NotificationRecord, UserRecord } from '../src/types/domain';
import {
  keepUnresolvedItem86Notifications,
  mapNotificationRow,
  notificationRecipientFilter,
  notificationService,
  selectOwnerDashboardNotifications,
  shouldRegisterPushNotifications,
} from '../src/services/notificationService';
import { customerService } from '../src/services/customerService';
import { userService } from '../src/services/userService';

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

  it('paginates notifications with the same creation timestamp without skipping entries', async () => {
    const timestamp = '2026-11-26T22:00:00Z';
    const notifications = ['a', 'b', 'c'].map((id) => ({
      ...notification(id),
      createdAt: timestamp,
    }));
    localStorage.setItem('7anouti-pos:notifications', JSON.stringify(notifications));

    const firstPage = await notificationService.listFor(owner);
    const secondPage = await notificationService.listFor(owner, firstPage[1]);

    expect(firstPage.map(({ id }) => id)).toEqual(['c', 'b', 'a']);
    expect(secondPage.map(({ id }) => id)).toEqual(['a']);
  });

  it('keeps the owner dashboard to its five newest important alerts and persists dismissal', async () => {
    const notifications = Array.from({ length: 6 }, (_, index) => ({
      ...notification(`important-${index}`),
      type: index === 0 ? 'app_update' as const : 'customer_overdue' as const,
      createdAt: `2026-11-27T00:0${index}:00Z`,
    }));
    localStorage.setItem('7anouti-pos:notifications', JSON.stringify(notifications));

    const latest = await notificationService.listImportantForDashboard(owner);
    expect(latest.map(({ id }) => id)).toEqual([
      'important-5',
      'important-4',
      'important-3',
      'important-2',
      'important-1',
    ]);

    await notificationService.markRead(owner, 'important-5');
    const refreshed = await notificationService.listImportantForDashboard(owner);
    expect(selectOwnerDashboardNotifications(refreshed, []).map(({ id }) => id)).toEqual([
      'important-4',
      'important-3',
      'important-2',
      'important-1',
    ]);

    const withNewAlert = [...refreshed, {
      ...notification('important-new'),
      type: 'customer_overdue' as const,
      createdAt: '2026-11-27T00:10:00Z',
    }];
    expect(selectOwnerDashboardNotifications(withNewAlert, []).map(({ id }) => id)).toEqual([
      'important-new',
      'important-4',
      'important-3',
      'important-2',
    ]);
  });

  it('builds a stable keyset filter for notifications sharing a timestamp', () => {
    const filter = notificationRecipientFilter(owner, {
      createdAt: '2026-11-26T22:00:00Z',
      id: 'notification-b',
    });

    expect(filter).toContain('created_at.lt.2026-11-26T22:00:00Z');
    expect(filter).toContain('created_at.eq.2026-11-26T22:00:00Z,id.lt.notification-b');
    expect(filter).toContain('target_role.eq.owner,created_at.lt.2026-11-26T22:00:00Z');
  });

  it('coalesces overlapping subscription reminder checks', async () => {
    const getStore = vi.spyOn(userService, 'getStore').mockResolvedValue(null);

    await Promise.all([
      notificationService.checkSubscriptionExpiring(owner.storeId!),
      notificationService.checkSubscriptionExpiring(owner.storeId!),
    ]);

    expect(getStore).toHaveBeenCalledOnce();
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
      kind: 'nearLimit',
      severity: 'warning',
    }]);
    expect(getCreditStatuses).not.toHaveBeenCalled();
    expect(getDueInfos).not.toHaveBeenCalled();
  });
});
