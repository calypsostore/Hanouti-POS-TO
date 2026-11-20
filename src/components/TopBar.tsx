import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MaterialIcon } from './MaterialIcon';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { t } from '../i18n/translations';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { notificationPath } from '../lib/notificationPath';
import type { NotificationRecord } from '../types/domain';
import { getLogoDefinition } from '../data/logoCatalog';

interface TopBarProps {
  title: string;
  storeName?: string;
  storeLogoId?: string;
  onProfileClick?: () => void;
  onDashboardClick?: () => void;
  onLockClick?: () => void;
}

export function TopBar({ title, storeName, storeLogoId, onProfileClick, onDashboardClick, onLockClick }: TopBarProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const displayedStoreName = storeName?.trim() || t('common.appName');
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const notificationItems = useNotificationStore((state) => state.items);
  const recentNotifications = useMemo(() => notificationItems.slice(0, 5), [notificationItems]);
  const notificationsLoading = useNotificationStore((state) => state.status === 'loading');
  const markRead = useNotificationStore((state) => state.markRead);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const [openingNotificationId, setOpeningNotificationId] = useState('');
  const storeLogo = getLogoDefinition(storeLogoId ?? '');

  async function openNotification(notification: NotificationRecord) {
    if (!user) return;
    setOpeningNotificationId(notification.id);
    try {
      await markRead(user, notification.id);
      setNotificationsOpen(false);
      navigate(notificationPath(notification, user.role));
    } catch (error) {
      console.error('Unable to open this notification.', error);
      setNotificationsError('Unable to open this notification. Please try again.');
    } finally {
      setOpeningNotificationId('');
    }
  }

  function openNotifications() {
    setNotificationsError('');
    setNotificationsOpen(true);
  }

  return (
    <>
    <header className="safe-top sticky top-0 z-30 border-b border-outline-variant bg-surface/90 backdrop-blur-xl">
      <div className="top-bar-content flex h-16 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-fixed text-primary">
            {storeLogo ? (
              <img src={storeLogo.src} alt="" className="h-8 w-8 object-contain" />
            ) : (
              <MaterialIcon name="local_cafe" className="text-2xl" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate font-body text-label-sm text-outline">{displayedStoreName}</p>
            <h1 className="truncate font-display text-headline-sm text-primary">{title}</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onDashboardClick && (
            <button
              type="button"
              aria-label={t('nav.dashboard')}
              title={t('nav.dashboard')}
              onClick={onDashboardClick}
              className="flex h-10 items-center justify-center gap-1.5 rounded-full bg-surface-container px-2 text-primary tablet:px-3"
            >
              <MaterialIcon name="dashboard" />
              <span className="hidden tablet:inline">{t('nav.dashboard')}</span>
            </button>
          )}
          {onLockClick && (
            <button type="button" aria-label="Lock terminal" onClick={onLockClick} className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-container text-primary">
              <MaterialIcon name="lock" />
            </button>
          )}
          {user && (
            <button
              type="button"
              aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              aria-expanded={notificationsOpen}
              onClick={openNotifications}
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
    <BottomSheet open={notificationsOpen} onClose={() => setNotificationsOpen(false)} title={t('nav.notifications')} panelClassName="h-[70dvh] lg:h-auto lg:max-h-[80dvh] lg:max-w-lg">
      <div className="flex flex-col gap-3">
        {notificationsError && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{notificationsError}</p>}
        {notificationsLoading ? (
          <p role="status" className="py-6 text-center font-body text-body-sm text-on-surface-variant">Loading notifications…</p>
        ) : recentNotifications.length > 0 ? recentNotifications.map((notification) => (
          <button
            key={notification.id}
            type="button"
            disabled={openingNotificationId === notification.id}
            onClick={() => { void openNotification(notification); }}
            aria-label={`Open notification: ${notification.title}`}
            className={`flex min-w-0 items-start gap-3 rounded-xl p-3 text-left disabled:opacity-60 ${
              notification.readAt ? 'bg-surface-container-lowest' : 'bg-primary-fixed/40'
            }`}
          >
            <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
              notification.readAt ? 'bg-surface-container text-outline' : 'bg-primary-fixed text-primary'
            }`}>
              <MaterialIcon name="notifications" className="text-xl" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words font-body text-label-lg text-on-surface">{notification.title}</span>
              <span className="mt-1 block break-words font-body text-body-sm text-on-surface-variant">{notification.body}</span>
              <span className="mt-2 block font-body text-body-xs text-outline">{new Date(notification.createdAt).toLocaleString()}</span>
            </span>
          </button>
        )) : (
          <p className="py-6 text-center font-body text-body-sm text-on-surface-variant">You’re all caught up.</p>
        )}
        <Button type="button" variant="secondary" className="mt-1 w-full" onClick={() => { setNotificationsOpen(false); navigate('/notifications'); }}>
          See all
        </Button>
      </div>
    </BottomSheet>
    </>
  );
}
