import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRecord, UserRecord } from '../src/types/domain';
import { notificationService } from '../src/services/notificationService';

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
});
