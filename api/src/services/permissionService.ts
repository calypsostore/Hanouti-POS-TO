import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import type { NotificationRecord, NotificationType } from '../types/domain';
import { notificationPath } from '../lib/notificationPath';
import { useAuthStore } from '../stores/authStore';

export type NotificationPermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

export const PERMISSIONS_ASKED_KEY = 'permissionsAsked';
const PERMISSION_STATUS_KEY = 'notificationPermissionStatus';
export const NOTIFICATION_CHANNELS = {
  orders: 'orders_v2',
  alerts: 'alerts_v2',
  system: 'system_v2',
} as const;
export const NOTIFICATION_CHANNEL_BY_TYPE: Record<NotificationType, keyof typeof NOTIFICATION_CHANNELS> = {
  void_requested: 'alerts',
  void_approved: 'orders',
  void_rejected: 'orders',
  schedule_published: 'orders',
  customer_credit_warning: 'alerts',
  customer_credit_limit: 'alerts',
  customer_overdue: 'alerts',
  stock_depleted: 'alerts',
  item_86: 'alerts',
  low_stock: 'alerts',
  shift_opened: 'orders',
  shift_closed: 'orders',
  cash_difference: 'alerts',
  cash_out_alert: 'alerts',
  z_report_closed: 'system',
  app_update: 'system',
  subscription_expiring: 'system',
};
const statusListeners = new Set<(status: NotificationPermissionStatus) => void>();
let channelCreation: Promise<void> | undefined;

function normalizeStatus(status: string): NotificationPermissionStatus {
  if (status === 'granted' || status === 'denied') return status;
  return status === 'prompt' || status === 'prompt-with-rationale' || status === 'default'
    ? 'prompt'
    : 'unsupported';
}

function saveStatus(status: NotificationPermissionStatus, asked = false): void {
  localStorage.setItem(PERMISSION_STATUS_KEY, status);
  if (asked) localStorage.setItem(PERMISSIONS_ASKED_KEY, 'true');
  for (const listener of statusListeners) listener(status);
}

export function stableNotificationId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = ((hash << 5) - hash + id.charCodeAt(index)) >>> 0;
  }
  return hash % 2_000_000_000;
}

async function ensureChannels(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  if (!channelCreation) {
    channelCreation = (async () => {
      await Promise.all([
        LocalNotifications.createChannel({
          id: NOTIFICATION_CHANNELS.orders,
          name: 'Orders and shifts',
          description: 'Orders, schedules, and shift activity',
          importance: 4,
          visibility: 1,
          vibration: true,
        }),
        LocalNotifications.createChannel({
          id: NOTIFICATION_CHANNELS.alerts,
          name: 'Business alerts',
          description: 'Void requests, cash differences, and stock alerts',
          importance: 5,
          visibility: 1,
          vibration: true,
        }),
        LocalNotifications.createChannel({
          id: NOTIFICATION_CHANNELS.system,
          name: 'System updates',
          description: 'App updates, reports, and summaries',
          importance: 3,
          visibility: 1,
          vibration: false,
        }),
      ]);
      await LocalNotifications.deleteChannel({ id: '7anouti-general' }).catch(() => undefined);
    })();
  }
  try {
    await channelCreation;
  } catch (error) {
    channelCreation = undefined;
    throw error;
  }
}

export const permissionService = {
  isNative(): boolean {
    return Capacitor.isNativePlatform();
  },

  hasAsked(): boolean {
    return localStorage.getItem(PERMISSIONS_ASKED_KEY) === 'true';
  },

  subscribe(listener: (status: NotificationPermissionStatus) => void): () => void {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
  },

  async getStatus(): Promise<NotificationPermissionStatus> {
    if (this.isNative()) {
      const { display } = await LocalNotifications.checkPermissions();
      const status = normalizeStatus(display);
      saveStatus(status);
      return status;
    }

    if (typeof Notification === 'undefined') {
      saveStatus('unsupported');
      return 'unsupported';
    }
    const status = normalizeStatus(Notification.permission);
    saveStatus(status);
    return status;
  },

  async request(): Promise<NotificationPermissionStatus> {
    let status: NotificationPermissionStatus;
    if (this.isNative()) {
      const result = await LocalNotifications.requestPermissions();
      status = normalizeStatus(result.display);
    } else if (typeof Notification === 'undefined') {
      status = 'unsupported';
    } else {
      status = normalizeStatus(await Notification.requestPermission());
    }
    saveStatus(status, true);
    return status;
  },

  async markAsked(): Promise<NotificationPermissionStatus> {
    const status = await this.getStatus();
    saveStatus(status, true);
    return status;
  },

  async createDefaultChannel(): Promise<void> {
    await ensureChannels();
  },

  async showLocalNotification(title: string, body: string, notification?: NotificationRecord): Promise<boolean> {
    const status = await this.getStatus();
    if (status !== 'granted') return false;

    if (this.isNative()) {
      await ensureChannels();
      const type = notification?.type ?? 'app_update';
      const channelId = NOTIFICATION_CHANNELS[NOTIFICATION_CHANNEL_BY_TYPE[type]];
      const numericId = notification
        ? stableNotificationId(notification.id)
        : ((Date.now() % 2_000_000_000) >>> 0);
      const activeUser = useAuthStore.getState().user;
      await LocalNotifications.schedule({
        notifications: [{
          id: numericId,
          title,
          body,
          channelId,
          smallIcon: 'ic_stat_notification',
          largeIcon: 'ic_notification_large',
          extra: notification ? {
            notificationId: notification.id,
            route: activeUser ? notificationPath(notification, activeUser.role) : '/notifications',
          } : undefined,
        }],
      });
      return true;
    }

    if (typeof Notification === 'undefined') return false;
    new Notification(title, { body });
    return true;
  },
};
