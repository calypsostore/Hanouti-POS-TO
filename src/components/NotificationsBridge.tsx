import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { PushNotifications } from '@capacitor/push-notifications';
import { getSupabaseClient } from '../data/supabaseClient';
import { isSupabaseDriver } from '../data/driver';
import {
  mapNotificationRow,
  notificationRecipientFilter,
  notificationService,
  OWNER_NOTIFICATIONS_CHANGED_EVENT,
  shouldRegisterPushNotifications,
} from '../services/notificationService';
import { permissionService } from '../services/permissionService';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useFocusRefreshKey } from '../lib/useFocusRefreshKey';
import { notificationPath } from '../lib/notificationPath';
import { getNotificationAppearance } from '../lib/notificationAppearance';
import { playNotificationSoundForEvent } from '../services/notificationSounds';
import { useOverlayLifecycle, useOverlayTarget } from './overlay/overlayArchitecture';
import { NotificationTypeIcon } from './NotificationTypeIcon';
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
  const notificationStatus = useNotificationStore((state) => state.status);
  const [banner, setBanner] = useState<NotificationRecord | null>(null);
  const portalTarget = useOverlayTarget();
  const bannerZIndex = useOverlayLifecycle({
    open: Boolean(banner),
    kind: 'toast',
    lockScroll: false,
    trapFocus: false,
    restoreFocus: false,
  });
  const appActive = useRef(true);
  const listenerRegistered = useRef(false);
  const refreshKey = useFocusRefreshKey();

  useEffect(() => {
    if (!user || locked) {
      reset();
      return;
    }
    void load(user).catch((error: unknown) => {
      console.error('[notifications] Could not load shared notification state.', error);
    });
  }, [locked, load, refreshKey, reset, user]);

  useEffect(() => {
    if (!listenerRegistered.current) {
      listenerRegistered.current = true;
      void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
        const notificationId = action.notification.extra?.notificationId;
        const route = action.notification.extra?.route;
        if (typeof notificationId === 'string') {
          rememberShownId(notificationId);
          const current = useAuthStore.getState().user;
          if (current) void markRead(current, notificationId).catch(() => undefined);
        }
        if (typeof route === 'string') navigate(route);
      });
    }
  }, [markRead, navigate]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void permissionService.createDefaultChannel().catch((error: unknown) => {
      console.error('[notifications] Could not initialize notification channels.', error);
    });
  }, []);

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
    let pushReceivedListener: { remove: () => Promise<void> } | undefined;
    void (async () => {
      await permissionService.createDefaultChannel();
      const status = await PushNotifications.checkPermissions();
      if (status.receive !== 'granted') {
        const requested = await PushNotifications.requestPermissions();
        if (requested.receive !== 'granted') return;
      }
      await PushNotifications.register();
    })().catch((error: unknown) => console.error('[push] Could not initialize notifications or request push permission.', error));
    void PushNotifications.addListener('registration', (event) => {
      void saveToken(event.value);
    }).then((listener) => { registrationListener = listener; });
    void PushNotifications.addListener('registrationError', (error) => {
      console.error('[push] Device registration failed.', error);
    }).then((listener) => { refreshListener = listener; });
    void PushNotifications.addListener('pushNotificationReceived', (action) => {
      const notificationId = action.data?.notificationId;
      if (typeof notificationId === 'string' &&
        (!appActive.current || document.visibilityState !== 'visible')) {
        rememberShownId(notificationId);
      }
    }).then((listener) => { pushReceivedListener = listener; });
    void PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const notificationId = action.notification.data?.notificationId;
      const route = action.notification.data?.route;
      if (typeof notificationId === 'string') {
        rememberShownId(notificationId);
        void markRead(user, notificationId).catch(() => undefined);
      }
      if (typeof route === 'string') navigate(route);
    }).then((listener) => { pushActionListener = listener; });
    return () => {
      disposed = true;
      void registrationListener?.remove();
      void refreshListener?.remove();
      void pushActionListener?.remove();
      void pushReceivedListener?.remove();
    };
  }, [markRead, navigate, user]);

  useEffect(() => {
    if (!isSupabaseDriver() || !user?.storeId || locked ||
      notificationStatus === 'idle' || notificationStatus === 'loading') return;
    let disposed = false;
    let retry = 0;
    let retryTimer = 0;
    let catchUpTimer = 0;
    let catchUpInProgress = false;
    let subscribeInProgress = false;
    let removingChannel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | undefined;
    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | undefined;
    const channelTopic = `notifications-app-shell:${user.storeId}:${user.id}:${crypto.randomUUID()}`;
    const pushNotificationsEnabled = shouldRegisterPushNotifications(
      import.meta.env.VITE_ANDROID_PUSH_ENABLED === 'true',
      Capacitor.isNativePlatform(),
      isSupabaseDriver(),
      user.storeId,
    );

    const handleAcceptedInsert = async (row: NotificationRecord) => {
      if (disposed || !recipientMatches(row, user.id, user.role)) return;
      acceptInsert(row);
      if (readShownIds().has(row.id)) return;
      rememberShownId(row.id);
      if (!Capacitor.isNativePlatform() || (appActive.current && document.visibilityState === 'visible')) {
        void playNotificationSoundForEvent(user.id, row.type).catch((error: unknown) => {
          console.error('[notifications] Could not play the selected notification sound.', error);
        });
      }
      if (row.type === 'app_update') return;

      const backgrounded = !document.visibilityState || document.visibilityState !== 'visible';
      if (backgrounded || !appActive.current) {
        if (!pushNotificationsEnabled) {
          await permissionService.showLocalNotification(row.title, row.body, row);
        }
        return;
      }
      setBanner(row);
      window.setTimeout(() => setBanner((current) => current?.id === row.id ? null : current), 7000);
    };

    const scheduleSubscribeRetry = () => {
      if (disposed || retryTimer) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        void subscribe();
      }, Math.min(30_000, 1000 * (2 ** retry++)));
    };

    const subscribe = async () => {
      if (disposed || subscribeInProgress) return;
      subscribeInProgress = true;
      window.clearTimeout(retryTimer);
      retryTimer = 0;
      try {
        if (channel) {
          const previousChannel = channel;
          removingChannel = previousChannel;
          const removalStatus = await getSupabaseClient().removeChannel(previousChannel);
          if (removalStatus !== 'ok') {
            throw new Error(`Could not remove notification realtime channel: ${removalStatus}`);
          }
          removingChannel = undefined;
          if (channel === previousChannel) channel = undefined;
        }
        if (disposed) return;

        const nextChannel = getSupabaseClient().channel(channelTopic);
        channel = nextChannel;
        nextChannel.on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `store_id=eq.${user.storeId}`,
        }, (payload) => {
          const row = mapNotificationRow(payload.new as Record<string, unknown>);
          void handleAcceptedInsert(row).catch((error: unknown) => {
            console.error('[notifications] Could not process a realtime notification.', error);
          });
        });
        nextChannel.on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `store_id=eq.${user.storeId}`,
        }, (payload) => {
          const row = mapNotificationRow(payload.new as Record<string, unknown>);
          if (recipientMatches(row, user.id, user.role)) acceptRealtimeUpdate(row);
        });
        subscribeInProgress = false;
        nextChannel.subscribe((status) => {
          if (disposed || channel !== nextChannel || subscribeInProgress) return;
          if (status === 'SUBSCRIBED') {
            retry = 0;
            window.clearTimeout(retryTimer);
            retryTimer = 0;
            void catchUp();
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            scheduleSubscribeRetry();
          }
        });
      } catch (error) {
        removingChannel = undefined;
        subscribeInProgress = false;
        if (disposed) return;
        console.error('[notifications] Realtime subscription failed.', error);
        scheduleSubscribeRetry();
      }
    };

    const catchUp = async () => {
      if (disposed || catchUpInProgress || useNotificationStore.getState().status !== 'ready') return;
      catchUpInProgress = true;
      let hasMore = false;
      try {
        let pages = 0;
        do {
          const cursor = useNotificationStore.getState().lastSeenCursor;
          const query = getSupabaseClient()
            .from('notifications')
            .select('*')
            .eq('store_id', user.storeId!)
            .or(notificationRecipientFilter(user, cursor, 'after'))
            .order('created_at', { ascending: Boolean(cursor) })
            .order('id', { ascending: Boolean(cursor) })
            .limit(50);
          const { data, error } = await query;
          if (error) {
            console.error('[notifications] Realtime catch-up failed.', error);
            return;
          }
          const rows = (data ?? []).map((item) => mapNotificationRow(item as unknown as Record<string, unknown>));
          if (!cursor) rows.reverse();
          for (const row of rows) {
            if (!disposed && recipientMatches(row, user.id, user.role)) acceptInsert(row);
          }
          hasMore = Boolean(cursor) && rows.length === 50;
          pages += 1;
        } while (!disposed && hasMore && pages < 3);
      } catch (error) {
        console.error('[notifications] Realtime catch-up failed.', error);
      } finally {
        catchUpInProgress = false;
      }
      if (!disposed && hasMore) catchUpTimer = window.setTimeout(() => { void catchUp(); }, 1000);
    };

    subscribe();
    void catchUp();
    const handleVisibility = () => {
      appActive.current = document.visibilityState === 'visible';
      if (appActive.current) void catchUp();
    };
    const handleOnline = () => {
      void catchUp();
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
        const latest = items[0];
        if (!latest) return;
        const alreadyPresent = useNotificationStore.getState().items.some((item) => item.id === latest.id);
        if (alreadyPresent) acceptRealtimeUpdate(latest);
        else void handleAcceptedInsert(latest).catch((error: unknown) => {
          console.error('[notifications] Could not process a locally created notification.', error);
        });
      }).catch((error: unknown) => console.error('[notifications] Could not refresh after a local change.', error));
    };
    window.addEventListener(OWNER_NOTIFICATIONS_CHANGED_EVENT, localEvent);

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(catchUpTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(OWNER_NOTIFICATIONS_CHANGED_EVENT, localEvent);
      void appStateListener?.remove();
      const activeChannel = channel;
      channel = undefined;
      if (activeChannel && activeChannel !== removingChannel) {
        void getSupabaseClient().removeChannel(activeChannel).then((status) => {
          if (status !== 'ok') console.error(`[notifications] Could not remove realtime channel: ${status}.`);
        }).catch((error: unknown) => console.error('[notifications] Could not remove realtime channel.', error));
      }
    };
  }, [acceptInsert, acceptRealtimeUpdate, locked, markRead, navigate, notificationStatus, user]);

  if (!banner) return null;
  const appearance = getNotificationAppearance(banner.type);
  return createPortal(
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
      className={`notification-type-card notification-type-card--${appearance.tone} fixed left-3 right-3 top-20 mx-auto flex max-w-xl items-center gap-3 rounded-xl p-4 text-left shadow-overlay`}
      style={{ zIndex: bannerZIndex }}
    >
      <NotificationTypeIcon type={banner.type} />
      <span className="min-w-0">
        <span className="block font-body text-label-lg text-on-surface">{banner.title}</span>
        <span className="mt-1 block font-body text-body-sm text-on-surface-variant">{banner.body}</span>
      </span>
    </button>,
    portalTarget,
  );
}
