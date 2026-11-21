import { create } from 'zustand';
import type { NotificationRecord, UserSummary } from '../types/domain';
import { notificationService } from '../services/notificationService';

const MAX_NOTIFICATION_ITEMS = 200;

interface NotificationState {
  items: NotificationRecord[];
  unreadCount: number;
  lastSeenCreatedAt: string | undefined;
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
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_NOTIFICATION_ITEMS);
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  items: [],
  unreadCount: 0,
  lastSeenCreatedAt: undefined,
  status: 'idle',
  load: async (user) => {
    set({ status: 'loading' });
    try {
      const [items, unreadCount] = await Promise.all([
        notificationService.listFor(user),
        notificationService.unreadCount(user),
      ]);
      set({
        items: mergeItems([], items),
        unreadCount,
        lastSeenCreatedAt: items[0]?.createdAt,
        status: 'ready',
      });
    } catch (error) {
      set({ status: 'error' });
      throw error;
    }
  },
  loadMore: async (user) => {
    const before = get().items.at(-1)?.createdAt;
    if (!before) return;
    const more = await notificationService.listFor(user, before);
    set({ items: mergeItems(get().items, more), status: 'ready' });
  },
  acceptInsert: (notification) => {
    set((state) => {
      const alreadyPresent = state.items.some((item) => item.id === notification.id);
      const items = mergeItems(state.items, [notification]);
      return {
        items,
        unreadCount: alreadyPresent
          ? state.unreadCount
          : state.unreadCount + (!notification.readAt ? 1 : 0),
        lastSeenCreatedAt: !state.lastSeenCreatedAt ||
          notification.createdAt > state.lastSeenCreatedAt
          ? notification.createdAt
          : state.lastSeenCreatedAt,
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
  reset: () => set({ items: [], unreadCount: 0, lastSeenCreatedAt: undefined, status: 'idle' }),
}));
