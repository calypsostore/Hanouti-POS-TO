import { useEffect, useState } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { activityService, type ActivityFilters } from '../services/activityService';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/userService';
import type { ActivityRecord, UserSummary } from '../types/domain';

export function OwnerActivityLogScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [entries, setEntries] = useState<ActivityRecord[]>([]);
  const [staff, setStaff] = useState<UserSummary[]>([]);
  const [storeName, setStoreName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ActivityFilters>({});
  const [selectedEntry, setSelectedEntry] = useState<ActivityRecord | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      setLoading(true);
      try {
        const [nextEntries, users, store] = await Promise.all([
          activityService.list(storeId, filters),
          userService.listUsers(storeId),
          userService.getStore(storeId),
        ]);
        if (!active) return;
        setEntries(nextEntries);
        setStaff(users.filter((member) => member.role === 'staff'));
        setStoreName(store?.name ?? '');
        setError('');
      } catch (loadError) {
        console.error('Unable to load the activity log.', loadError);
        if (active) setError(t('common.loadFailed'));
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
    };
  }, [storeId, filters]);

  return (
    <WorkspaceLayout title={t('nav.activityLog')} storeName={storeName} links={ownerWorkspaceLinks}>
      <header className="mb-4">
        <h1 className="font-display text-headline-lg text-on-surface">{t('nav.activityLog')}</h1>
      </header>
      {error && <p role="alert" className="mb-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      <section aria-label={t('activity.filters')} className="mb-4 grid gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card sm:grid-cols-2">
        <label className="flex flex-col gap-1 font-body text-label-sm text-on-surface">
          {t('activity.search')}
          <input
            type="search"
            value={filters.search ?? ''}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value || undefined }))}
            placeholder={t('activity.searchPlaceholder')}
            className="min-h-11 rounded-lg border border-outline-variant bg-surface px-3 font-body text-body-md text-on-surface"
          />
        </label>
        <label className="flex flex-col gap-1 font-body text-label-sm text-on-surface">
          {t('activity.staff')}
          <select
            value={filters.staffId ?? ''}
            onChange={(event) => setFilters((current) => ({ ...current, staffId: event.target.value || undefined }))}
            className="min-h-11 rounded-lg border border-outline-variant bg-surface px-3 font-body text-body-md text-on-surface"
          >
            <option value="">{t('activity.allStaff')}</option>
            {staff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-body text-label-sm text-on-surface">
          {t('activity.actionGroup')}
          <select
            value={filters.actionGroup ?? ''}
            onChange={(event) => setFilters((current) => ({ ...current, actionGroup: event.target.value || undefined }))}
            className="min-h-11 rounded-lg border border-outline-variant bg-surface px-3 font-body text-body-md text-on-surface"
          >
            <option value="">{t('activity.allActions')}</option>
            {['orders', 'catalog', 'staff', 'customers', 'tabs', 'shifts', 'cash', 'reports', 'expenses', 'suppliers', 'security', 'schedule', 'comps', 'settings', 'other']
              .map((group) => <option key={group} value={group}>{group[0].toLocaleUpperCase() + group.slice(1)}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 font-body text-label-sm text-on-surface">
            {t('activity.from')}
            <input
              type="date"
              value={filters.from ?? ''}
              onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value || undefined }))}
              className="min-h-11 min-w-0 rounded-lg border border-outline-variant bg-surface px-3 font-body text-body-md text-on-surface"
            />
          </label>
          <label className="flex flex-col gap-1 font-body text-label-sm text-on-surface">
            {t('activity.to')}
            <input
              type="date"
              value={filters.to ?? ''}
              onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value || undefined }))}
              className="min-h-11 min-w-0 rounded-lg border border-outline-variant bg-surface px-3 font-body text-body-md text-on-surface"
            />
          </label>
        </div>
      </section>
      <section aria-label={t('nav.activityLog')} className="flex min-w-0 flex-col gap-2">
        {loading ? <ListSkeleton label="Loading activity" /> : entries.map((entry) => (
          <ActivityEntry key={entry.id} entry={entry} onSelect={() => setSelectedEntry(entry)} />
        ))}
        {!loading && !error && entries.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">{t('common.noData')}</p>}
      </section>
      <BottomSheet open={selectedEntry !== null} onClose={() => setSelectedEntry(null)} title={t('activity.details')}>
        {selectedEntry && (
          <div className="flex flex-col gap-4">
            <p className="font-body text-body-md text-on-surface">{selectedEntry.summary}</p>
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-container-low p-3 font-body text-body-sm">
              <div><dt className="text-outline">Actor</dt><dd className="text-on-surface">{selectedEntry.actorName} ({selectedEntry.actorRole})</dd></div>
              <div><dt className="text-outline">Action</dt><dd className="break-all text-on-surface">{selectedEntry.action}</dd></div>
              <div><dt className="text-outline">Entity</dt><dd className="break-all text-on-surface">{selectedEntry.entityType}: {selectedEntry.entityId}</dd></div>
              <div><dt className="text-outline">When</dt><dd className="text-on-surface">{new Date(selectedEntry.createdAt).toLocaleString()}</dd></div>
            </dl>
            <ActivityValues title={t('activity.before')} value={selectedEntry.meta?.before} />
            <ActivityValues title={t('activity.after')} value={selectedEntry.meta?.after} />
            {selectedEntry.meta && Object.keys(selectedEntry.meta).some((key) => key !== 'before' && key !== 'after') && (
              <ActivityValues title={t('activity.additionalDetails')} value={Object.fromEntries(
                Object.entries(selectedEntry.meta).filter(([key]) => key !== 'before' && key !== 'after'),
              )} />
            )}
          </div>
        )}
      </BottomSheet>
    </WorkspaceLayout>
  );
}

function ActivityEntry({ entry, onSelect }: { entry: ActivityRecord; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className="flex min-w-0 items-start gap-3 rounded-xl bg-surface-container-lowest p-4 text-left shadow-card hover:bg-surface-container-low">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
        <MaterialIcon name="history" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-body text-label-md text-on-surface">{entry.summary}</span>
        <span className="mt-1 block break-words font-body text-body-sm text-on-surface-variant">
          {entry.actorName} ({entry.actorRole}) · {new Date(entry.createdAt).toLocaleString()} · {entry.action}
        </span>
      </span>
      <MaterialIcon name="chevron_right" className="mt-1 text-outline" />
    </button>
  );
}

function ActivityValues({ title, value }: { title: string; value: unknown }) {
  return (
    <section>
      <h3 className="mb-1 font-body text-label-md text-on-surface">{title}</h3>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-container-low p-3 font-mono text-body-xs text-on-surface">
        {value === undefined ? t('activity.noValue') : JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}
