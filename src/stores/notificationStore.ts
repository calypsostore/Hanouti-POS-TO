import { create } from 'zustand';
import type { NotificationRecord, UserSummary } from '../types/domain';
import { notificationService } from '../services/notificationService';
import { compareNotificationsNewestFirst, type NotificationCursor } from '../lib/notificationOrder';

const MAX_NOTIFICATION_ITEMS = 200;

interface NotificationState {
  items: NotificationRecord[];
  unreadCount: number;
  lastSeenCursor: NotificationCursor | undefined;
  status: 'idle' | 'loading' | 'ready' | 'error';
  load: (user: UserSummary) => Promise<void>;
  loadMore: (user: UserSummary) => Promise<void>;
  acceptInsert: (notification: NotificationRecord) => void;
  acceptRealtimeUpdate: (notification: NotificationRecord) => void;
  markRead: (user: UserSummary, notificationId: string) => Promise<void>;
  markAllRead: (user: UserSummary) => Promise<void>;
  reset: () => void;
}

function mergeItems(current: NotificationRecord[], incoming: NotificationRecord[]): NotificationRecord[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) {
    const existing = byId.get(item.id);
    if (!existing || !existing.readAt || item.readAt) byId.set(item.id, item);
  }
  return [...byId.values()]
    .sort(compareNotificationsNewestFirst)
    .slice(0, MAX_NOTIFICATION_ITEMS);
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unreadCount: 0,
  lastSeenCursor: undefined,
  status: 'idle',
  load: async (user) => {
    set({ status: 'loading' });
    try {
      const [items, unreadCount] = await Promise.all([
        notificationService.listFor(user),
        notificationService.unreadCount(user),
      ]);
      const mergedItems = mergeItems([], items);
      set({
        items: mergedItems,
        unreadCount,
        lastSeenCursor: mergedItems[0]
          ? { createdAt: mergedItems[0].createdAt, id: mergedItems[0].id }
          : undefined,
        status: 'ready',
      });
    } catch (error) {
      set({ status: 'error' });
      throw error;
    }
  },
  loadMore: async (user) => {
    const before = get().items.at(-1);
    if (!before) return;
    const more = await notificationService.listFor(user, before);
    set({ items: mergeItems(get().items, more), status: 'ready' });
  },
  acceptInsert: (notification) => {
    set((state) => {
      const alreadyPresent = state.items.some((item) => item.id === notification.id);
      const items = mergeItems(state.items, [notification]);
      const lastSeenCursor = !state.lastSeenCursor ||
        compareNotificationsNewestFirst(notification, state.lastSeenCursor) < 0
        ? { createdAt: notification.createdAt, id: notification.id }
        : state.lastSeenCursor;
      return {
        items,
        unreadCount: alreadyPresent
          ? state.unreadCount
          : state.unreadCount + (!notification.readAt ? 1 : 0),
        lastSeenCursor,
      };
    });
  },
  acceptRealtimeUpdate: (notification) => {
    set((state) => ({
      items: mergeItems(state.items, [notification]),
      unreadCount: state.items.some((item) => item.id === notification.id && !item.readAt && notification.readAt)
        ? Math.max(0, state.unreadCount - 1)
        : state.unreadCount,
    }));
  },
  markRead: async (user, notificationId) => {
    const previous = get().items.find((item) => item.id === notificationId);
    if (!previous || previous.readAt) return;
    const readAt = new Date().toISOString();
    set((state) => ({
      items: state.items.map((item) => item.id === notificationId ? { ...item, readAt } : item),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
    try {
      await notificationService.markRead(user, notificationId);
    } catch (error) {
      set((state) => ({
        items: state.items.map((item) => item.id === notificationId ? previous : item),
        unreadCount: state.unreadCount + 1,
      }));
      throw error;
    }
  },
  markAllRead: async (user) => {
    const previous = get().items;
    const readAt = new Date().toISOString();
    set((state) => ({
      items: state.items.map((item) => item.readAt ? item : { ...item, readAt }),
      unreadCount: 0,
    }));
    try {
      await notificationService.markAllRead(user);
    } catch (error) {
      set({ items: previous, unreadCount: previous.filter((item) => !item.readAt).length });
      throw error;
    }
  },
  reset: () => set({ items: [], unreadCount: 0, lastSeenCursor: undefined, status: 'idle' }),
}));
