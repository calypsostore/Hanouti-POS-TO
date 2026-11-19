import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { notificationService, OWNER_NOTIFICATIONS_CHANGED_EVENT } from '../services/notificationService';
import { userService } from '../services/userService';
import { useAuthStore } from '../stores/authStore';
import { notificationPath } from '../lib/notificationPath';
import type { NotificationRecord } from '../types/domain';
import { subscribeToStoreChanges } from '../data/repositories/realtimeRepository';

export function NotificationsScreen() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [storeName, setStoreName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [nextNotifications, store] = await Promise.all([
        notificationService.listFor(user),
        user.storeId ? userService.getStore(user.storeId) : Promise.resolve(undefined),
      ]);
      setNotifications(nextNotifications);
      setStoreName(store?.name ?? '');
      setError('');
    } catch (loadError) {
      console.error('Unable to load notifications.', loadError);
      setError(t('common.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
    if (user) {
      void notificationService.markAllRead(user).catch((markError: unknown) => {
        console.error('Unable to mark notifications as read.', markError);
        setError('Unable to mark notifications as read. Please try again.');
      });
    }
    window.addEventListener('focus', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener(OWNER_NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener(OWNER_NOTIFICATIONS_CHANGED_EVENT, refresh);
    };
  }, [refresh, user]);

  useEffect(() => {
    if (!user?.storeId) return;
    return subscribeToStoreChanges(user.storeId, ['notifications'], () => {
      void refresh();
    });
  }, [refresh, user?.storeId]);

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
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
      await notificationService.markAllRead(user);
      await refresh();
    } catch (markError) {
      console.error('Unable to mark notifications as read.', markError);
      setError('Unable to mark notifications as read. Please try again.');
    }
  }

  async function openNotification(notification: NotificationRecord) {
    if (!user) return;
    try {
      if (!notification.readAt) await notificationService.markRead(user, notification.id);
      await refresh();
      navigate(notificationPath(notification, user.role));
    } catch (markError) {
      console.error('Unable to open this notification.', markError);
      setError('Unable to open this notification. Please try again.');
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
          {group.entries.map((notification) => (
            <button
              key={notification.id}
              type="button"
              onClick={() => { void openNotification(notification); }}
              className={`flex min-w-0 items-start gap-3 rounded-xl p-4 text-left shadow-card ${
                notification.readAt ? 'bg-surface-container-lowest' : 'bg-primary-fixed/40'
              }`}
            >
              <span className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                notification.readAt ? 'bg-surface-container text-outline' : 'bg-primary-fixed text-primary'
              }`}>
                <MaterialIcon name="notifications" className="text-xl" />
              </span>
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
          ))}
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
