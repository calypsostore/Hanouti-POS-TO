import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { notificationPath } from '../lib/notificationPath';
import { getNotificationAppearance } from '../lib/notificationAppearance';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import type { NotificationRecord } from '../types/domain';
import { MaterialIcon } from './MaterialIcon';
import { NotificationTypeIcon } from './NotificationTypeIcon';
import { t } from '../i18n/translations';
import { getLanguage } from '../i18n';
import { useOverlayLifecycle, useOverlayTarget } from './overlay/overlayArchitecture';
import { getNotificationContent } from '../lib/notificationContent';

interface NotificationsPopoverButtonProps {
  id?: string;
  buttonClassName?: string;
  badgeClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function NotificationsPopoverButton({
  id = 'notifications-popover',
  buttonClassName = 'relative flex h-10 w-10 items-center justify-center rounded-full bg-surface-container text-primary',
  badgeClassName = 'absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-error px-1 font-body text-label-sm text-white',
  open,
  onOpenChange,
}: NotificationsPopoverButtonProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const items = useNotificationStore((state) => state.items);
  const recentNotifications = useMemo(() => items.slice(0, 6), [items]);
  const loading = useNotificationStore((state) => state.status === 'loading');
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [error, setError] = useState('');
  const [activeNotificationId, setActiveNotificationId] = useState('');
  const [pendingBulkAction, setPendingBulkAction] = useState<'read' | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const panelRef = useRef<HTMLElement>(null);
  const portalTarget = useOverlayTarget();
  const isOpen = open ?? uncontrolledOpen;
  const visibleNotifications = recentNotifications.filter((notification) => !dismissedIds.has(notification.id));

  const setPanelOpen = useCallback((nextOpen: boolean) => {
    if (open === undefined) setUncontrolledOpen(nextOpen);
    onOpenChange?.(nextOpen);
  }, [open, onOpenChange]);

  useEffect(() => {
    setDismissedIds(new Set());
  }, [user?.id]);

  const closeOnEscape = useCallback(() => setPanelOpen(false), [setPanelOpen]);
  const zIndex = useOverlayLifecycle({
    open: isOpen,
    kind: 'popover',
    onEscape: closeOnEscape,
    lockScroll: true,
    trapFocus: true,
    restoreFocus: true,
    containerRef: panelRef,
  });

  function openNotifications() {
    setError('');
    setPanelOpen(true);
  }

  async function openNotification(notification: NotificationRecord) {
    if (!user) return;
    setActiveNotificationId(notification.id);
    try {
      if (!notification.readAt) await markRead(user, notification.id);
      setPanelOpen(false);
      navigate(notificationPath(notification, user.role));
    } catch (openError) {
      console.error('Unable to open this notification.', openError);
      setError(t('notifications.openFailed'));
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
      setError(t('notifications.markReadFailed'));
    } finally {
      setActiveNotificationId('');
    }
  }

  async function markAllNotificationsRead() {
    if (!user) return;
    setPendingBulkAction('read');
    try {
      await markAllRead(user);
    } catch (markError) {
      console.error('Unable to mark notifications as read.', markError);
      setError(t('notifications.markAllReadFailed'));
    } finally {
      setPendingBulkAction(null);
    }
  }

  function clearVisibleNotifications() {
    if (visibleNotifications.length === 0) return;
    const clearedIds = visibleNotifications.map((notification) => notification.id);
    setDismissedIds((current) => new Set([...current, ...clearedIds]));
  }

  if (!user) return null;

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        aria-label={unreadCount ? t('notifications.unreadCount', { count: unreadCount }) : t('notifications.label')}
        aria-haspopup="dialog"
        aria-controls={id}
        aria-expanded={isOpen}
        onClick={openNotifications}
      >
        <MaterialIcon name="notifications" />
        {unreadCount > 0 && <span className={badgeClassName}>{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {isOpen && createPortal(
        <div
          className="glass-modal-backdrop notification-popover-backdrop fixed inset-0 flex items-center justify-center"
          style={{ zIndex }}
          onMouseDown={() => setPanelOpen(false)}
        >
          <section
            ref={panelRef}
            id={id}
            role="dialog"
            aria-modal="true"
            aria-label={t('nav.notifications')}
            className="glass-modal-panel notification-center-panel"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="notification-center-header">
              <div className="notification-center-brand">
                <span className="notification-center-brand-icon">
                  <MaterialIcon name="notifications_active" />
                </span>
                <h2 className="notification-center-title">{t('nav.notifications')}</h2>
              </div>
              <div className="notification-center-actions">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    disabled={pendingBulkAction !== null}
                    onClick={() => { void markAllNotificationsRead(); }}
                    className="notification-center-header-link"
                  >
                    {t('notifications.readAll')}
                  </button>
                )}
                <Link
                  to="/notifications"
                  onClick={() => setPanelOpen(false)}
                  className="notification-center-header-link"
                >
                  {t('notifications.seeAll')}
                </Link>
                <button
                  type="button"
                  aria-label={t('common.close')}
                  onClick={() => setPanelOpen(false)}
                  className="notification-center-close"
                >
                  <MaterialIcon name="close" />
                </button>
              </div>
            </header>

            {error && <p role="alert" className="notification-center-error">{error}</p>}

            <div className="notification-center-list">
              {loading ? (
                <p role="status" className="notification-center-empty">{t('notifications.loading')}</p>
              ) : visibleNotifications.length > 0 ? visibleNotifications.map((notification) => {
                const appearance = getNotificationAppearance(notification.type);
                const content = getNotificationContent(notification);
                const busy = activeNotificationId === notification.id || pendingBulkAction !== null;
                return (
                  <article key={notification.id} className={`notification-center-card notification-type-card notification-type-card--${appearance.tone}`}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { void openNotification(notification); }}
                      aria-label={t('notifications.openItem', { title: content.title })}
                      className="notification-center-open"
                    >
                      <NotificationTypeIcon type={notification.type} />
                      <span className="notification-center-copy">
                        <span className="notification-center-title-row">
                          <span className="notification-center-item-title">{content.title}</span>
                          {!notification.readAt && <span className="notification-center-unread" aria-label={t('notifications.unread')} />}
                        </span>
                        <span className="notification-center-body">{content.body}</span>
                        <span className="notification-center-time">
                          <MaterialIcon name="schedule" />
                          {new Date(notification.createdAt).toLocaleString(getLanguage())}
                        </span>
                      </span>
                      <MaterialIcon name="chevron_right" className="notification-center-chevron" />
                    </button>
                    {!notification.readAt && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => { void markNotificationRead(notification.id); }}
                        aria-label={t('notifications.markRead', { title: content.title })}
                        className="notification-center-read"
                      >
                        <MaterialIcon name="done" />
                        <span>{t('notifications.markAsRead')}</span>
                      </button>
                    )}
                  </article>
                );
              }) : (
                <p role="status" className="notification-center-empty">{t('notifications.caughtUp')}</p>
              )}
            </div>

            <footer className="notification-center-footer">
              <button
                type="button"
                disabled={visibleNotifications.length === 0 || pendingBulkAction !== null}
                onClick={() => { void clearVisibleNotifications(); }}
                aria-label={t('notifications.clearAllFromPanel')}
                className="notification-center-footer-action"
              >
                <MaterialIcon name="delete_outline" />
                <span>{t('notifications.clearAll')}</span>
              </button>
              <Link
                to="/notifications"
                onClick={() => setPanelOpen(false)}
                className="notification-center-footer-action notification-center-view-all"
              >
                <span>{t('notifications.viewAll')}</span>
                <MaterialIcon name="chevron_right" />
              </Link>
            </footer>
          </section>
        </div>,
        portalTarget,
      )}
    </>
  );
}
