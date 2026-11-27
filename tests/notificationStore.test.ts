import { afterEach, describe, expect, it } from 'vitest';
import { useNotificationStore } from '../src/stores/notificationStore';

describe('notification store bounds', () => {
  afterEach(() => useNotificationStore.getState().reset());

  it('keeps only the newest 200 notifications in memory', () => {
    const acceptInsert = useNotificationStore.getState().acceptInsert;
    for (let index = 0; index < 205; index += 1) {
      acceptInsert({
        id: `notification-${index}`,
        type: 'app_update',
        title: 'Update',
        body: 'A new version is available.',
        createdAt: new Date(index * 1000).toISOString(),
      });
    }

    const { items } = useNotificationStore.getState();
    expect(items).toHaveLength(200);
    expect(items[0].id).toBe('notification-204');
    expect(items.at(-1)?.id).toBe('notification-5');
  });

  it('orders by actual time across timezone offsets and uses IDs for equal timestamps', () => {
    const acceptInsert = useNotificationStore.getState().acceptInsert;
    acceptInsert({
      id: 'later-id',
      type: 'app_update',
      title: 'Later',
      body: 'Later notification.',
      createdAt: '2026-03-29T23:00:00+01:00',
    });
    acceptInsert({
      id: 'same-time-a',
      type: 'app_update',
      title: 'Same time A',
      body: 'Same timestamp.',
      createdAt: '2026-03-29T22:30:00Z',
    });
    acceptInsert({
      id: 'same-time-z',
      type: 'app_update',
      title: 'Same time Z',
      body: 'Same timestamp.',
      createdAt: '2026-03-29T22:30:00Z',
    });

    expect(useNotificationStore.getState().items.map(({ id }) => id)).toEqual([
      'same-time-z',
      'same-time-a',
      'later-id',
    ]);
  });

  it('does not count the same realtime notification twice', () => {
    const notification = {
      id: 'one-notification',
      type: 'cash_difference' as const,
      title: 'Cash difference',
      body: 'A cash difference was recorded.',
      createdAt: '2026-11-26T22:00:00Z',
    };
    const acceptInsert = useNotificationStore.getState().acceptInsert;

    acceptInsert(notification);
    acceptInsert(notification);

    expect(useNotificationStore.getState().items).toHaveLength(1);
    expect(useNotificationStore.getState().unreadCount).toBe(1);
  });
});
