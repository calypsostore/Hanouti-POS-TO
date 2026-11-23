import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { notificationPath } from '../lib/notificationPath';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import type { NotificationRecord } from '../types/domain';
import { MaterialIcon } from './MaterialIcon';
import { t } from '../i18n/translations';

export function ShiftNotificationsButton() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const items = useNotificationStore((state) => state.items);
  const recentNotifications = useMemo(() => items.slice(0, 6), [items]);
  const loading = useNotificationStore((state) => state.status === 'loading');
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [activeNotificationId, setActiveNotificationId] = useState('');
  const [position, setPosition] = useState({ top: 64, originX: 320 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const updatePosition = useCallback(() => {
    const bounds = buttonRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const panelWidth = Math.min(352, Math.max(0, window.innerWidth - 16));
    const panelLeft = window.innerWidth - 8 - panelWidth;
    const centerX = bounds.left + bounds.width / 2;
    setPosition({ top: bounds.bottom + 6, originX: Math.min(panelWidth - 16, Math.max(16, centerX - panelLeft)) });
  }, []);

  const openNotifications = () => {
    setError('');
    updatePosition();
    setOpen(true);
  };

  async function openNotification(notification: NotificationRecord) {
    if (!user) return;
    setActiveNotificationId(notification.id);
    try {
      if (!notification.readAt) await markRead(user, notification.id);
      setOpen(false);
      navigate(notificationPath(notification, user.role));
    } catch (openError) {
      console.error('Unable to open this notification.', openError);
      setError('Unable to open this notification. Please try again.');
    } finally {
      setActiveNotificationId('');
    }
  }

  async function markNotificationRead(notificationId: string) {
    if (!user) return;
    setActiveNotificationId(notificationId);
    try {
      await markRead(user, notificationId);
    } catch (markError) {
      console.error('Unable to mark this notification as read.', markError);
      setError('Unable to mark this notification as read. Please try again.');
    } finally {
      setActiveNotificationId('');
    }
  }

  async function markAllNotificationsRead() {
    if (!user) return;
    try {
      await markAllRead(user);
    } catch (markError) {
      console.error('Unable to mark notifications as read.', markError);
      setError('Unable to mark notifications as read. Please try again.');
    }
  }

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const updateOnViewportChange = () => updatePosition();
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updateOnViewportChange);
    window.addEventListener('scroll', updateOnViewportChange, true);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updateOnViewportChange);
      window.removeEventListener('scroll', updateOnViewportChange, true);
    };
  }, [open, updatePosition]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="shift-topbar-icon-button"
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-haspopup="dialog"
        aria-controls="shift-notifications-popover"
        aria-expanded={open}
        onClick={openNotifications}
      >
        <MaterialIcon name="notifications" />
        {unreadCount > 0 && <span className="shift-topbar-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && createPortal(
        <div className="glass-modal-backdrop notification-popover-backdrop fixed inset-0 z-50 bg-primary-dark/30 backdrop-blur-[1px]" onMouseDown={() => setOpen(false)}>
          <section
            id="shift-notifications-popover"
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.notifications')}
            style={{
              top: `${position.top}px`,
              right: '8px',
              transformOrigin: `${position.originX}px 0px`,
              maxHeight: `min(68dvh, calc(100dvh - ${position.top}px - 1rem))`,
            }}
            className="glass-modal-panel notification-popover-panel fixed flex w-[min(22rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest p-3 shadow-overlay safe-bottom"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <h2 className="font-display text-title-md text-on-surface">{t('nav.notifications')}</h2>
              <div className="flex shrink-0 items-center gap-1">
                {unreadCount > 0 && (
                  <button type="button" onClick={() => { void markAllNotificationsRead(); }} className="!min-h-0 !min-w-0 rounded-md px-2 py-1 font-body text-label-md text-primary hover:bg-primary-fixed">
                    Read all
                  </button>
                )}
                <Link to="/notifications" onClick={() => setOpen(false)} className="!min-h-0 !min-w-0 rounded-md px-2 py-1 font-body text-label-md text-primary hover:bg-primary-fixed">
                  See all
                </Link>
                <button type="button" aria-label={t('common.close')} onClick={() => setOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-full text-outline">
                  <MaterialIcon name="close" />
                </button>
              </div>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain">
              <div className="flex flex-col gap-2">
                {error && <p role="alert" className="rounded-lg bg-error-container p-2 font-body text-body-sm text-on-error-container">{error}</p>}
                {loading ? (
                  <p role="status" className="py-3 text-center font-body text-body-sm text-on-surface-variant">Loading notifications…</p>
                ) : recentNotifications.length ? recentNotifications.map((notification) => (
                  <div key={notification.id} className={`flex min-w-0 items-center gap-1 rounded-lg border border-outline-variant/60 p-2 ${notification.readAt ? 'bg-surface-container-low' : 'bg-primary-fixed/30'}`}>
                    <button
                      type="button"
                      disabled={activeNotificationId === notification.id}
                      onClick={() => { void openNotification(notification); }}
                      aria-label={`Open notification: ${notification.title}`}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
                    >
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${notification.readAt ? 'bg-surface-container text-outline' : 'bg-primary-fixed text-primary'}`}>
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
                )) : <p className="py-3 text-center font-body text-body-sm text-on-surface-variant">You’re all caught up.</p>}
              </div>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </>
  );
}
