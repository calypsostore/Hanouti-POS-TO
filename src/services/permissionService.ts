import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

export type NotificationPermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';

export const PERMISSIONS_ASKED_KEY = 'permissionsAsked';
const PERMISSION_STATUS_KEY = 'notificationPermissionStatus';
const PERMISSION_CHANNEL_ID = '7anouti-general';
const statusListeners = new Set<(status: NotificationPermissionStatus) => void>();
let channelCreation: Promise<void> | undefined;
let nextNotificationId = Math.floor(Date.now() % 2_000_000_000);

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

async function ensureDefaultChannel(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  if (!channelCreation) {
    channelCreation = LocalNotifications.createChannel({
      id: PERMISSION_CHANNEL_ID,
      name: '7anouti-POS alerts',
      description: 'Business alerts and app updates',
      importance: 4,
      visibility: 1,
    });
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
    await ensureDefaultChannel();
  },

  async showLocalNotification(title: string, body: string): Promise<boolean> {
    const status = await this.getStatus();
    if (status !== 'granted') return false;

    if (this.isNative()) {
      await ensureDefaultChannel();
      nextNotificationId = (nextNotificationId % 2_000_000_000) + 1;
      await LocalNotifications.schedule({
        notifications: [{
          id: nextNotificationId,
          title,
          body,
          channelId: PERMISSION_CHANNEL_ID,
        }],
      });
      return true;
    }

    if (typeof Notification === 'undefined') return false;
    new Notification(title, { body });
    return true;
  },
};
