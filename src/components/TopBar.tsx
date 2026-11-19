import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MaterialIcon } from './MaterialIcon';
import { t } from '../i18n/translations';
import { notificationService, OWNER_NOTIFICATIONS_CHANGED_EVENT } from '../services/notificationService';
import { useAuthStore } from '../stores/authStore';

interface TopBarProps {
  title: string;
  storeName?: string;
  onProfileClick?: () => void;
  onLockClick?: () => void;
}

export function TopBar({ title, storeName, onProfileClick, onLockClick }: TopBarProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [unreadCount, setUnreadCount] = useState(0);

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
