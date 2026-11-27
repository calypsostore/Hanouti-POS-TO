import { useEffect, useMemo, useState } from 'react';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { CardGrid, PageHeader } from '../components/layout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { getLanguage } from '../i18n';
import { t } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { compService } from '../services/compService';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/userService';
import type { CompReason, CompRecord, UserSummary } from '../types/domain';

const compReasons: CompReason[] = ['dropped', 'staff_drink', 'free_customer', 'remake', 'other'];

function reasonLabel(reason: CompReason): string {
  const keys: Record<CompReason, Parameters<typeof t>[0]> = {
    dropped: 'wastePage.reasonDropped',
    staff_drink: 'wastePage.reasonStaffDrink',
    free_customer: 'wastePage.reasonFreeCustomer',
    remake: 'wastePage.reasonRemake',
    other: 'wastePage.reasonOther',
  };
  return t(keys[reason]);
}

function localDateKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function OwnerWasteScreen() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [comps, setComps] = useState<CompRecord[]>([]);
  const [staff, setStaff] = useState<UserSummary[]>([]);
  const [storeName, setStoreName] = useState<string>();
  const [staffFilter, setStaffFilter] = useState('');
  const [reasonFilter, setReasonFilter] = useState<CompReason | ''>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      setLoading(true);
      try {
        const [nextComps, users, store] = await Promise.all([
          compService.listComps(storeId),
          userService.listUsers(storeId),
          userService.getStore(storeId),
        ]);
        if (!active) return;
        setComps(nextComps);
        setStaff(users);
        setStoreName(store?.name);
        setError('');
      } catch (loadError) {
        console.error('Unable to load the waste log.', loadError);
        if (active) setError(t('wastePage.loadFailed'));
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
  }, [storeId]);

  const staffById = useMemo(() => new Map(staff.map((member) => [member.id, member])), [staff]);
  const filteredComps = useMemo(() => comps.filter((comp) => {
    const date = localDateKey(comp.createdAt);
    return (!staffFilter || comp.staffId === staffFilter) &&
      (!reasonFilter || comp.reason === reasonFilter) &&
      (!fromDate || date >= fromDate) &&
      (!toDate || date <= toDate);
  }), [comps, fromDate, reasonFilter, staffFilter, toDate]);
  const totalValue = filteredComps.reduce((sum, comp) => sum + comp.valueMillimes, 0);

  return (
    <WorkspaceLayout title={t('wastePage.title')} storeName={storeName} links={ownerWorkspaceLinks}>
      <PageHeader title={t('wastePage.title')} subtitle={t('wastePage.subtitle')} />

      <section aria-label={t('wastePage.filtersLabel')} className="mb-4 grid gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
        <label className="font-body text-label-md text-on-surface">{t('wastePage.staff')}
          <select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">
            <option value="">{t('wastePage.allStaff')}</option>
            {staff.filter((member) => member.role === 'staff').map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <label className="font-body text-label-md text-on-surface">{t('wastePage.reason')}
          <select value={reasonFilter} onChange={(event) => setReasonFilter(event.target.value as CompReason | '')} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">
            <option value="">{t('wastePage.allReasons')}</option>
            {compReasons.map((reason) => <option key={reason} value={reason}>{reasonLabel(reason)}</option>)}
          </select>
        </label>
        <label className="font-body text-label-md text-on-surface">{t('wastePage.from')}
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
        </label>
        <label className="font-body text-label-md text-on-surface">{t('wastePage.to')}
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
        </label>
      </section>

      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        <SummaryCard label={t('wastePage.compRecords')} value={filteredComps.length.toLocaleString(getLanguage())} />
        <SummaryCard label={t('wastePage.units')} value={filteredComps.reduce((sum, comp) => sum + comp.quantity, 0).toLocaleString(getLanguage())} />
        <SummaryCard label={t('wastePage.totalValue')} value={t('wastePage.valueCurrency', { value: formatTnd(totalValue / 1000) })} />
      </section>

      {error && <p role="alert" className="mb-4 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      <CardGrid className="mobile-card-list mobile-gap-2">
        {loading ? <ListSkeleton label={t('wastePage.loading')} /> : filteredComps.map((comp) => (
          <article key={comp.id} className="flex flex-col gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-container text-on-warning-container"><MaterialIcon name="delete_sweep" /></span>
              <div className="min-w-0">
                <h2 className="font-body text-label-lg text-on-surface">{comp.quantity} × {comp.name}</h2>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                  {staffById.get(comp.staffId)?.name ?? t('wastePage.unknownStaff')} · {reasonLabel(comp.reason)} · {new Date(comp.createdAt).toLocaleString(getLanguage())}
                </p>
                {comp.note && <p className="mt-1 break-words font-body text-body-sm text-outline">{comp.note}</p>}
              </div>
            </div>
            <strong className="shrink-0 font-display text-headline-sm tabular-nums text-primary">{t('wastePage.valueCurrency', { value: formatTnd(comp.valueMillimes / 1000) })}</strong>
          </article>
        ))}
        {!loading && !error && filteredComps.length === 0 && (
          <p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">{t('wastePage.noCompsMatch')}</p>
        )}
      </CardGrid>
    </WorkspaceLayout>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-container-lowest p-4 shadow-card">
      <p className="font-body text-label-sm text-outline">{label}</p>
      <p className="mt-1 font-display text-headline-md tabular-nums text-on-surface">{value}</p>
    </div>
  );
}
