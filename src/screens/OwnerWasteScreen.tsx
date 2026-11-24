import { useEffect, useMemo, useState } from 'react';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { CardGrid, PageHeader } from '../components/layout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { formatTnd } from '../lib/format';
import { compService } from '../services/compService';
import { useAuthStore } from '../stores/authStore';
import { userService } from '../services/userService';
import type { CompReason, CompRecord, UserSummary } from '../types/domain';

const reasonLabels: Record<CompReason, string> = {
  dropped: 'Dropped',
  staff_drink: 'Staff drink',
  free_customer: 'Free customer',
  remake: 'Remake',
  other: 'Other',
};

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
        if (active) setError('Unable to load the waste log. Please try again.');
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
    <WorkspaceLayout title="Waste log" storeName={storeName} links={ownerWorkspaceLinks} legacyAppearance>
      <PageHeader title="Waste log" subtitle="Review comps and waste recorded during staff shifts." />

      <section aria-label="Waste log filters" className="mb-4 grid gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
        <label className="font-body text-label-md text-on-surface">Staff
          <select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">
            <option value="">All staff</option>
            {staff.filter((member) => member.role === 'staff').map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
          </select>
        </label>
        <label className="font-body text-label-md text-on-surface">Reason
          <select value={reasonFilter} onChange={(event) => setReasonFilter(event.target.value as CompReason | '')} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3">
            <option value="">All reasons</option>
            {Object.entries(reasonLabels).map(([reason, label]) => <option key={reason} value={reason}>{label}</option>)}
          </select>
        </label>
        <label className="font-body text-label-md text-on-surface">From
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
        </label>
        <label className="font-body text-label-md text-on-surface">To
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3" />
        </label>
      </section>

      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Comp records" value={filteredComps.length.toLocaleString()} />
        <SummaryCard label="Units" value={filteredComps.reduce((sum, comp) => sum + comp.quantity, 0).toLocaleString()} />
        <SummaryCard label="Total value" value={`${formatTnd(totalValue / 1000)} DT`} />
      </section>

      {error && <p role="alert" className="mb-4 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      <CardGrid className="mobile-card-list mobile-gap-2">
        {loading ? <ListSkeleton label="Loading waste records" /> : filteredComps.map((comp) => (
          <article key={comp.id} className="flex flex-col gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-container text-on-warning-container"><MaterialIcon name="delete_sweep" /></span>
              <div className="min-w-0">
                <h2 className="font-body text-label-lg text-on-surface">{comp.quantity} × {comp.name}</h2>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                  {staffById.get(comp.staffId)?.name ?? 'Unknown staff'} · {reasonLabels[comp.reason]} · {new Date(comp.createdAt).toLocaleString()}
                </p>
                {comp.note && <p className="mt-1 break-words font-body text-body-sm text-outline">{comp.note}</p>}
              </div>
            </div>
            <strong className="shrink-0 font-display text-headline-sm tabular-nums text-primary">{formatTnd(comp.valueMillimes / 1000)} DT</strong>
          </article>
        ))}
        {!loading && !error && filteredComps.length === 0 && (
          <p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">No comps match these filters.</p>
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
