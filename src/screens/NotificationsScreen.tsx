import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BottomNav } from '../components/BottomNav';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { TopBar } from '../components/TopBar';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { CardGrid, PageContainer, PageHeader } from '../components/layout';
import { adminWorkspaceLinks, ownerWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import { useNotificationStore } from '../stores/notificationStore';
import { notificationPath } from '../lib/notificationPath';
import { getNotificationAppearance } from '../lib/notificationAppearance';
import type { NotificationRecord } from '../types/domain';
import { NotificationTypeIcon } from '../components/NotificationTypeIcon';

export function NotificationsScreen() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const notifications = useNotificationStore((state) => state.items);
  const unreadCount = useNotificationStore((state) => state.unreadCount);
  const loading = useNotificationStore((state) => state.status === 'loading');
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllReadStore = useNotificationStore((state) => state.markAllRead);
  const [storeName, setStoreName] = useState('');
  const [error, setError] = useState('');
  const [activeNotificationId, setActiveNotificationId] = useState('');

  useEffect(() => {
    if (!user?.storeId) return;
    void userService.getStore(user.storeId).then((store) => setStoreName(store?.name ?? '')).catch(() => undefined);
  }, [user?.storeId]);
  const groups = useMemo(() => {
    const today = new Date().toDateString();
    return [
      { title: 'Today', entries: notifications.filter((notification) => new Date(notification.createdAt).toDateString() === today) },
      { title: 'Earlier', entries: notifications.filter((notification) => new Date(notification.createdAt).toDateString() !== today) },
    ].filter((group) => group.entries.length > 0);
  }, [notifications]);

  async function markAllRead() {
    if (!user) return;
    try {
      await markAllReadStore(user);
    } catch (markError) {
      console.error('Unable to mark notifications as read.', markError);
      setError('Unable to mark notifications as read. Please try again.');
    }
  }

  async function openNotification(notification: NotificationRecord) {
    if (!user) return;
    setActiveNotificationId(notification.id);
    try {
      if (!notification.readAt) await markRead(user, notification.id);
      navigate(notificationPath(notification, user.role));
    } catch (markError) {
      console.error('Unable to open this notification.', markError);
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

  const content = (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.notifications')} subtitle={unreadCount > 0 ? `${unreadCount} unread` : undefined} actions={unreadCount > 0 ? (
          <Button variant="secondary" className="min-h-11 shrink-0 px-3" onClick={() => { void markAllRead(); }}>
            <MaterialIcon name="done_all" className="text-lg" />
            Mark all read
          </Button>
        ) : undefined} />
      {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      {loading ? <ListSkeleton label="Loading notifications" /> : groups.map((group) => (
        <section key={group.title} aria-label={group.title} className="flex flex-col gap-2">
          <h2 className="px-1 font-body text-label-lg text-on-surface-variant">{group.title}</h2>
          <CardGrid className="mobile-card-list mobile-gap-2">
          {group.entries.map((notification) => {
            const appearance = getNotificationAppearance(notification.type);
            return (
            <article
              key={notification.id}
              className={`notification-type-card notification-type-card--${appearance.tone} rounded-xl p-3 shadow-card`}
            >
              <button
                type="button"
                disabled={activeNotificationId === notification.id}
                onClick={() => { void openNotification(notification); }}
                aria-label={`Open notification: ${notification.title}`}
                className="flex w-full min-w-0 items-start gap-3 text-left disabled:opacity-60"
              >
                <NotificationTypeIcon type={notification.type} className="mt-1" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className="break-words font-body text-label-lg text-on-surface">{notification.title}</span>
                    {!notification.readAt && <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                  </span>
                  <span className="mt-1 block break-words font-body text-body-sm text-on-surface-variant">{notification.body}</span>
                  <span className="mt-2 block font-body text-body-xs text-outline">{new Date(notification.createdAt).toLocaleString()}</span>
                </span>
                <MaterialIcon name="chevron_right" className="mt-1 shrink-0 text-outline" />
              </button>
              {!notification.readAt && (
                <button
                  type="button"
                  disabled={activeNotificationId === notification.id}
                  onClick={() => { void markNotificationRead(notification.id); }}
                  aria-label={`Mark notification as read: ${notification.title}`}
                  className="ml-12 mt-1 flex items-center gap-1 text-left font-body text-label-sm text-primary underline disabled:opacity-60"
                >
                  <MaterialIcon name="done" className="text-base" />
                  Mark as read
                </button>
              )}
            </article>
            );
          })}
          </CardGrid>
        </section>
      ))}
      {!loading && !error && notifications.length === 0 && (
        <p className="rounded-xl bg-surface-container-lowest p-8 text-center font-body text-body-md text-outline">{t('common.noData')}</p>
      )}
    </div>
  );

  if (user?.role === 'owner') {
    return <WorkspaceLayout title={t('nav.notifications')} storeName={storeName} links={ownerWorkspaceLinks}>{content}</WorkspaceLayout>;
  }
  if (user?.role === 'super_admin') {
    return <WorkspaceLayout title={t('nav.notifications')} links={adminWorkspaceLinks}>{content}</WorkspaceLayout>;
  }
  return (
    <div className="min-h-screen bg-surface pb-24">
      <TopBar title={t('nav.notifications')} storeName={storeName} onProfileClick={() => navigate('/settings')} />
      <main className="mx-auto w-full p-0"><PageContainer>{content}</PageContainer></main>
      <BottomNav />
    </div>
  );
}
