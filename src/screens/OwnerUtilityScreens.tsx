import { useEffect, useState } from 'react';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { formatTnd } from '../lib/format';
import { t } from '../i18n/translations';
import { activityLogService } from '../services/activityLogService';
import { notificationService } from '../services/notificationService';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/userService';
import type { ActivityLogRecord, NotificationRecord, UserSummary } from '../types/domain';

export function OwnerActivityLogScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [entries, setEntries] = useState<ActivityLogRecord[]>([]);
  const [staffNames, setStaffNames] = useState<Record<string, string>>({});
  const [storeName, setStoreName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [nextEntries, users, store] = await Promise.all([
          activityLogService.listForStore(storeId),
          userService.listUsers(storeId),
          userService.getStore(storeId),
        ]);
        if (!active) return;
        setEntries(nextEntries);
        setStaffNames(Object.fromEntries(users.map((member: UserSummary) => [member.id, member.name])));
        setStoreName(store?.name ?? '');
        setError('');
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [storeId]);

  return (
    <WorkspaceLayout title={t('nav.activityLog')} storeName={storeName} links={ownerWorkspaceLinks}>
      <header className="mb-4">
        <h1 className="font-display text-headline-lg text-on-surface">{t('nav.activityLog')}</h1>
      </header>
      {error && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      <section aria-label={t('nav.activityLog')} className="flex min-w-0 flex-col gap-2">
        {entries.map((entry) => (
          <ActivityEntry key={entry.id} entry={entry} actorName={staffNames[entry.actorId] ?? 'Unknown user'} />
        ))}
        {entries.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">{t('common.noData')}</p>}
      </section>
    </WorkspaceLayout>
  );
}

function ActivityEntry({ entry, actorName }: { entry: ActivityLogRecord; actorName: string }) {
  const description = entry.action === 'customer_payment_reversed'
    ? `Reversed a ${formatTnd(entry.amountMillimes / 1000)} DT payment. ${entry.reason}`
    : entry.action === 'catalog_item_availability_changed'
      ? `${entry.itemName} marked ${entry.outOfStock ? 'out of stock' : 'available'}.`
      : `Staff session ${entry.action === 'staff_session_locked' ? 'locked' : 'unlocked'}.`;

  return (
    <article className="flex min-w-0 items-start gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
        <MaterialIcon name="history" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words font-body text-label-md text-on-surface">{description}</p>
        <p className="mt-1 break-words font-body text-body-sm text-on-surface-variant">
          {actorName} · {new Date(entry.createdAt).toLocaleString()}
        </p>
      </div>
    </article>
  );
}

export function OwnerNotificationsScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [storeName, setStoreName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [nextNotifications, store] = await Promise.all([
          user ? notificationService.listForStaff(storeId, user.id) : Promise.resolve([]),
          userService.getStore(storeId),
        ]);
        if (!active) return;
        setNotifications(nextNotifications);
        setStoreName(store?.name ?? '');
        setError('');
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [storeId, user]);

  async function markAsRead(notification: NotificationRecord) {
    if (!user) return;
    try {
      await notificationService.markAsRead(storeId, user.id, notification.id);
      setNotifications(await notificationService.listForStaff(storeId, user.id));
      setError('');
    } catch (markError) {
      setError(markError instanceof Error ? markError.message : 'Unable to update this notification.');
    }
  }

  return (
    <WorkspaceLayout title={t('nav.notifications')} storeName={storeName} links={ownerWorkspaceLinks}>
      <header className="mb-4">
        <h1 className="font-display text-headline-lg text-on-surface">{t('nav.notifications')}</h1>
      </header>
      {error && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      <section aria-label={t('nav.notifications')} className="flex min-w-0 flex-col gap-2">
        {notifications.map((notification) => (
          <article key={notification.id} className="flex min-w-0 items-start gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
            <span className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${notification.readAt ? 'bg-surface-container text-outline' : 'bg-error-container text-on-error-container'}`}>
              <MaterialIcon name="notifications" className="text-xl" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="break-words font-body text-label-lg text-on-surface">{notification.title}</h2>
              <p className="mt-1 break-words font-body text-body-sm text-on-surface-variant">{notification.message}</p>
              <p className="mt-1 font-body text-body-xs text-outline">{new Date(notification.createdAt).toLocaleString()}</p>
            </div>
            {!notification.readAt && (
              <Button variant="secondary" className="min-h-10 shrink-0 px-3" onClick={() => { void markAsRead(notification); }}>
                <MaterialIcon name="done" className="text-lg" />
                <span className="sr-only">Mark as read</span>
              </Button>
            )}
          </article>
        ))}
        {notifications.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">{t('common.noData')}</p>}
      </section>
    </WorkspaceLayout>
  );
}
