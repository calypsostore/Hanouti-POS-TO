import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MaterialIcon } from './MaterialIcon';
import { t } from '../i18n/translations';
import { notificationService, OWNER_NOTIFICATIONS_CHANGED_EVENT } from '../services/notificationService';
import { offlineOrderQueue, OFFLINE_QUEUE_CHANGED_EVENT } from '../services/offlineOrderQueue';
import { useAuthStore } from '../stores/authStore';

interface TopBarProps {
  title: string;
  storeName?: string;
  onProfileClick?: () => void;
  onLockClick?: () => void;
  showConnectionStatus?: boolean;
}

export function TopBar({ title, storeName, onProfileClick, onLockClick, showConnectionStatus = false }: TopBarProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [unreadCount, setUnreadCount] = useState(0);
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [waitingToSync, setWaitingToSync] = useState(0);

  useEffect(() => {
    if (!user) {
      setUnreadCount(0);
      return;
    }
    let active = true;
    const refresh = () => {
      void notificationService.unreadCount(user).then((count) => {
        if (active) setUnreadCount(count);
      }).catch((error: unknown) => {
        console.error('Could not load the notification badge.', error);
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener(OWNER_NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener(OWNER_NOTIFICATIONS_CHANGED_EVENT, refresh);
    };
  }, [user]);

  useEffect(() => {
    if (!showConnectionStatus) return;
    let active = true;
    const refresh = () => {
      setOnline(typeof navigator === 'undefined' || navigator.onLine);
      void offlineOrderQueue.pendingCount(user?.storeId).then((count) => {
        if (active) setWaitingToSync(count);
      }).catch((error: unknown) => {
        console.error('Could not load the offline order count.', error);
      });
    };
    const onOnline = () => {
      refresh();
      void offlineOrderQueue.flush().catch((error: unknown) => {
        console.error('Could not sync offline orders.', error);
      });
    };
    refresh();
    if (typeof navigator === 'undefined' || navigator.onLine) {
      void offlineOrderQueue.flush().catch((error: unknown) => {
        console.error('Could not sync offline orders.', error);
      });
    }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', refresh);
    window.addEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refresh);
    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', refresh);
      window.removeEventListener(OFFLINE_QUEUE_CHANGED_EVENT, refresh);
    };
  }, [showConnectionStatus, user?.storeId]);

  return (
    <header className="safe-top sticky top-0 z-30 border-b border-outline-variant bg-surface/90 backdrop-blur-xl">
      <div className="flex h-16 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
            <MaterialIcon name="local_cafe" className="text-2xl" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-body text-label-sm uppercase text-outline">{t('common.appName')}</p>
            <h1 className="truncate font-display text-headline-sm text-primary">{title}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {showConnectionStatus && (
            <span role="status" aria-live="polite" className={`flex max-w-[108px] items-center gap-1 rounded-full px-2 py-1 font-body text-[10px] leading-tight tablet:max-w-none tablet:gap-1.5 tablet:px-2.5 tablet:text-label-sm ${online ? 'bg-success-container text-on-success-container' : 'bg-warning-container text-on-warning-container'}`}>
              <span className={`h-2 w-2 rounded-full ${online ? 'bg-success' : 'bg-warning'}`} />
              <span className="shrink-0">{online ? 'Online' : 'Offline'}</span>
              {waitingToSync > 0 && <span className="min-w-0">{waitingToSync} waiting to sync</span>}
            </span>
          )}
          {storeName && <span className="hidden max-w-36 truncate rounded-full bg-surface-container px-3 py-1 font-body text-label-sm text-on-surface-variant tablet:inline-flex">{storeName}</span>}
          {onLockClick && (
            <button type="button" aria-label="Lock terminal" onClick={onLockClick} className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container text-primary">
              <MaterialIcon name="lock" />
            </button>
          )}
          {user && (
            <button
              type="button"
              aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              onClick={() => navigate('/notifications')}
              className="relative flex h-10 w-10 items-center justify-center rounded-full bg-surface-container text-primary"
            >
              <MaterialIcon name="notifications" />
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 font-body text-label-sm text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </button>
          )}
          <button type="button" aria-label={t('common.profileSettings')} onClick={onProfileClick} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-on-primary">
            <MaterialIcon name="person" />
          </button>
        </div>
      </div>
    </header>
  );
}
