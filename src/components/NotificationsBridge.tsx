import { useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { getSupabaseClient } from '../data/supabaseClient';
import { isSupabaseDriver } from '../data/driver';
import {
  mapNotificationRow,
  notificationService,
  OWNER_NOTIFICATIONS_CHANGED_EVENT,
  shouldRegisterPushNotifications,
} from '../services/notificationService';
import { permissionService } from '../services/permissionService';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { notificationPath } from '../lib/notificationPath';
import type { NotificationRecord } from '../types/domain';

const SHOWN_IDS_KEY = '7anouti.notification.shown.v1';

function recipientMatches(notification: NotificationRecord, userId: string, role: string): boolean {
  return notification.userId === userId ||
    (!notification.userId && notification.targetRole === role);
}

function readShownIds(): Set<string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SHOWN_IDS_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.slice(-200).map(String) : []);
  } catch {
    return new Set();
  }
}

function rememberShownId(id: string): void {
  const ids = [...readShownIds(), id].slice(-200);
  localStorage.setItem(SHOWN_IDS_KEY, JSON.stringify(ids));
}

export function NotificationsBridge() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const locked = useAuthStore((state) => state.locked);
  const acceptInsert = useNotificationStore((state) => state.acceptInsert);
  const acceptRealtimeUpdate = useNotificationStore((state) => state.acceptRealtimeUpdate);
  const markRead = useNotificationStore((state) => state.markRead);
  const load = useNotificationStore((state) => state.load);
  const reset = useNotificationStore((state) => state.reset);
  const [banner, setBanner] = useState<NotificationRecord | null>(null);
  const appActive = useRef(true);
  const listenerRegistered = useRef(false);

  useEffect(() => {
    if (!user || locked) {
      reset();
      return;
    }
    void load(user).catch((error: unknown) => {
      console.error('[notifications] Could not load shared notification state.', error);
    });
  }, [locked, load, reset, user]);

  useEffect(() => {
    if (!listenerRegistered.current) {
      listenerRegistered.current = true;
      void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const notificationId = action.notification.extra?.notificationId;
        const route = action.notification.extra?.route;
        if (typeof notificationId === 'string') {
          const current = useAuthStore.getState().user;
          if (current) void markRead(current, notificationId).catch(() => undefined);
        }
        if (typeof route === 'string') navigate(route);
      });
    }
  }, [markRead, navigate]);

  useEffect(() => {
    if (!user?.storeId || !shouldRegisterPushNotifications(
      import.meta.env.VITE_ANDROID_PUSH_ENABLED === 'true',
      Capacitor.isNativePlatform(),
      isSupabaseDriver(),
      user?.storeId,
    )) return;
    let disposed = false;
    const saveToken = async (token: string) => {
      if (disposed) return;
      const { error } = await getSupabaseClient().from('device_tokens').upsert({
        user_id: user.id,
        store_id: user.storeId,
        token,
        platform: 'android',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'token' });
      if (error) console.error('[push] Could not register device token.', error);
    };
    let registrationListener: { remove: () => Promise<void> } | undefined;
    let refreshListener: { remove: () => Promise<void> } | undefined;
    let pushActionListener: { remove: () => Promise<void> } | undefined;
    void PushNotifications.checkPermissions().then(async (status) => {
      if (status.receive !== 'granted') {
        const requested = await PushNotifications.requestPermissions();
        if (requested.receive !== 'granted') return;
      }
      await PushNotifications.register();
    }).catch((error: unknown) => console.error('[push] Could not request push permission.', error));
    void PushNotifications.addListener('registration', (event) => {
      void saveToken(event.value);
    }).then((listener) => { registrationListener = listener; });
    void PushNotifications.addListener('registrationError', (error) => {
      console.error('[push] Device registration failed.', error);
    }).then((listener) => { refreshListener = listener; });
    void PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const notificationId = action.notification.data?.notificationId;
      const route = action.notification.data?.route;
      if (typeof notificationId === 'string') {
        void markRead(user, notificationId).catch(() => undefined);
      }
      if (typeof route === 'string') navigate(route);
    }).then((listener) => { pushActionListener = listener; });
    return () => {
      disposed = true;
      void registrationListener?.remove();
      void refreshListener?.remove();
      void pushActionListener?.remove();
    };
  }, [markRead, navigate, user]);

  useEffect(() => {
    if (!isSupabaseDriver() || !user?.storeId || locked) return;
    let disposed = false;
    let retry = 0;
    let retryTimer = 0;
    let channel = getSupabaseClient().channel(`notifications-app-shell:${user.storeId}:${user.id}`);

    const handleAcceptedInsert = async (row: NotificationRecord) => {
      if (disposed || !recipientMatches(row, user.id, user.role)) return;
      acceptInsert(row);
      if (readShownIds().has(row.id)) return;
      rememberShownId(row.id);
      if (row.type === 'app_update') return;

      const backgrounded = !document.visibilityState || document.visibilityState !== 'visible';
      if (backgrounded || !appActive.current) {
        await permissionService.showLocalNotification(row.title, row.body, row);
        return;
      }
      setBanner(row);
      window.setTimeout(() => setBanner((current) => current?.id === row.id ? null : current), 5000);
    };

    const subscribe = () => {
      void getSupabaseClient().removeChannel(channel).catch(() => undefined);
      channel = getSupabaseClient().channel(`notifications-app-shell:${user.storeId}:${user.id}`);
      channel.on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `store_id=eq.${user.storeId}`,
      }, (payload) => {
        const row = mapNotificationRow(payload.new as Record<string, unknown>);
        void handleAcceptedInsert(row);
      });
      channel.on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `store_id=eq.${user.storeId}`,
      }, (payload) => {
        const row = mapNotificationRow(payload.new as Record<string, unknown>);
        if (recipientMatches(row, user.id, user.role)) acceptRealtimeUpdate(row);
      });
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          retry = 0;
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          retryTimer = window.setTimeout(subscribe, Math.min(30_000, 1000 * (2 ** retry++)));
        }
      });
    };

    const catchUp = async () => {
      if (disposed) return;
      const before = useNotificationStore.getState().lastSeenCreatedAt;
      const query = getSupabaseClient()
        .from('notifications')
        .select('*')
        .eq('store_id', user.storeId!)
        .or(`user_id.eq.${user.id},and(user_id.is.null,target_role.eq.${user.role})`)
        .order('created_at', { ascending: false })
        .limit(50);
      const { data, error } = before
        ? await query.gt('created_at', before)
        : await query;
      if (error) {
        console.error('[notifications] Realtime catch-up failed.', error);
        return;
      }
      for (const row of (data ?? []).map((item) => mapNotificationRow(item as unknown as Record<string, unknown>)).reverse()) {
        await handleAcceptedInsert(row);
      }
    };

    subscribe();
    void catchUp();
    const handleVisibility = () => {
      appActive.current = document.visibilityState === 'visible';
      if (appActive.current) void catchUp();
    };
    const handleOnline = () => {
      void catchUp();
      subscribe();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    let appStateListener: { remove: () => Promise<void> } | undefined;
    void CapacitorApp.addListener('appStateChange', (state) => {
      appActive.current = state.isActive;
      if (state.isActive) void catchUp();
    }).then((listener) => { appStateListener = listener; });

    const localEvent = () => {
      if (disposed) return;
      void notificationService.listFor(user).then((items) => {
        acceptInsert(items[0] as NotificationRecord);
      }).catch(() => undefined);
    };
    window.addEventListener(OWNER_NOTIFICATIONS_CHANGED_EVENT, localEvent);

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(OWNER_NOTIFICATIONS_CHANGED_EVENT, localEvent);
      void appStateListener?.remove();
      void getSupabaseClient().removeChannel(channel).catch(() => undefined);
    };
  }, [acceptInsert, acceptRealtimeUpdate, locked, markRead, navigate, user]);

  if (!banner) return null;
  return (
    <button
      type="button"
      onClick={() => {
        const current = banner;
        setBanner(null);
        if (user) {
          void markRead(user, current.id).catch(() => undefined);
          navigate(notificationPath(current, user.role));
        }
      }}
      className="fixed left-3 right-3 top-20 z-[140] mx-auto max-w-xl rounded-xl border border-primary/20 bg-surface-container-highest p-4 text-left shadow-overlay"
    >
      <p className="font-body text-label-lg text-on-surface">{banner.title}</p>
      <p className="mt-1 font-body text-body-sm text-on-surface-variant">{banner.body}</p>
    </button>
  );
}
