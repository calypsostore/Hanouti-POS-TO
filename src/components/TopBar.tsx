import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { MaterialIcon } from './MaterialIcon';
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
  const [activeNotificationId, setActiveNotificationId] = useState('');
  const [notificationPosition, setNotificationPosition] = useState({ top: 64, originX: 320 });
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const storeLogo = getLogoDefinition(storeLogoId ?? '');
  const updateNotificationPosition = useCallback(() => {
    const buttonBounds = notificationButtonRef.current?.getBoundingClientRect();
    if (!buttonBounds) return;
    const panelWidth = Math.min(352, Math.max(0, window.innerWidth - 16));
    const panelLeft = window.innerWidth - 8 - panelWidth;
    const bellCenterX = buttonBounds.left + buttonBounds.width / 2;
    setNotificationPosition({
      top: buttonBounds.bottom + 6,
      originX: Math.min(panelWidth - 16, Math.max(16, bellCenterX - panelLeft)),
    });
  }, []);

  async function openNotification(notification: NotificationRecord) {
    if (!user) return;
    setActiveNotificationId(notification.id);
    try {
      await markRead(user, notification.id);
      setNotificationsOpen(false);
      navigate(notificationPath(notification, user.role));
    } catch (error) {
      console.error('Unable to open this notification.', error);
      setNotificationsError('Unable to open this notification. Please try again.');
    } finally {
      setActiveNotificationId('');
    }
  }

  async function markNotificationRead(notificationId: string) {
    if (!user) return;
    setActiveNotificationId(notificationId);
    try {
      await markRead(user, notificationId);
    } catch (error) {
      console.error('Unable to mark this notification as read.', error);
      setNotificationsError('Unable to mark this notification as read. Please try again.');
    } finally {
      setActiveNotificationId('');
    }
  }

  function openNotifications() {
    setNotificationsError('');
    updateNotificationPosition();
    setNotificationsOpen(true);
  }

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNotificationsOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updateNotificationPosition);
    window.addEventListener('scroll', updateNotificationPosition, true);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updateNotificationPosition);
      window.removeEventListener('scroll', updateNotificationPosition, true);
    };
  }, [notificationsOpen, updateNotificationPosition]);

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
              ref={notificationButtonRef}
              type="button"
              aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              aria-haspopup="dialog"
              aria-controls="notifications-popover"
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
    {notificationsOpen && createPortal(
      <div className="notification-popover-backdrop fixed inset-0 z-50 bg-primary-dark/30 backdrop-blur-[1px]" onMouseDown={() => setNotificationsOpen(false)}>
        <section
          id="notifications-popover"
          role="dialog"
          aria-modal="true"
          aria-label={t('nav.notifications')}
          style={{
            top: `${notificationPosition.top}px`,
            right: '8px',
            transformOrigin: `${notificationPosition.originX}px 0px`,
            maxHeight: `min(68dvh, calc(100dvh - ${notificationPosition.top}px - 1rem))`,
          }}
          className="notification-popover-panel fixed flex w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest p-3 shadow-overlay safe-bottom"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <h2 className="font-display text-title-md text-on-surface">{t('nav.notifications')}</h2>
            <div className="flex shrink-0 items-center gap-1">
              <Link
                to="/notifications"
                onClick={() => setNotificationsOpen(false)}
                className="!min-h-0 !min-w-0 rounded-md px-2 py-1 font-body text-label-md text-primary hover:bg-primary-fixed"
              >
                See all
              </Link>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setNotificationsOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-outline hover:bg-surface-container"
              >
                <MaterialIcon name="close" />
              </button>
            </div>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <div className="flex flex-col gap-2">
              {notificationsError && <p role="alert" className="rounded-lg bg-error-container p-2 font-body text-body-sm text-on-error-container">{notificationsError}</p>}
              {notificationsLoading ? (
                <p role="status" className="py-3 text-center font-body text-body-sm text-on-surface-variant">Loading notifications…</p>
              ) : recentNotifications.length > 0 ? recentNotifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`flex min-w-0 items-center gap-1 rounded-lg border border-outline-variant/60 p-2 ${
                    notification.readAt ? 'bg-surface-container-low' : 'bg-primary-fixed/30'
                  }`}
                >
                  <button
                    type="button"
                    disabled={activeNotificationId === notification.id}
                    onClick={() => { void openNotification(notification); }}
                    aria-label={`Open notification: ${notification.title}`}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      notification.readAt ? 'bg-surface-container text-outline' : 'bg-primary-fixed text-primary'
                    }`}>
                      <MaterialIcon name="notifications" className="text-lg" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="block truncate font-body text-label-lg text-on-surface">{notification.title}</span>
                        {!notification.readAt && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                      </span>
                      <span className="block truncate font-body text-body-sm text-on-surface-variant">{notification.body}</span>
                      <span className="block truncate font-body text-body-sm text-outline">{new Date(notification.createdAt).toLocaleString()}</span>
                    </span>
                  </button>
                  {!notification.readAt && (
                    <button
                      type="button"
                      disabled={activeNotificationId === notification.id}
                      onClick={() => { void markNotificationRead(notification.id); }}
                      aria-label={`Mark notification as read: ${notification.title}`}
                      className="flex shrink-0 items-center gap-1 rounded-lg px-2 font-body text-label-md text-primary hover:bg-white/70 disabled:opacity-60"
                    >
                      <MaterialIcon name="done" className="text-base" />
                      <span>Mark as read</span>
                    </button>
                  )}
                </div>
              )) : (
                <p className="py-3 text-center font-body text-body-sm text-on-surface-variant">You’re all caught up.</p>
              )}
            </div>
          </div>
        </section>
      </div>,
      document.body,
    )}
    </>
  );
}
