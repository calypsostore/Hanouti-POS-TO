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
});
