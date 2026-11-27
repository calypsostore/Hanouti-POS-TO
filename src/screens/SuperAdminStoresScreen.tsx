import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { useFocusRefreshKey } from '../lib/useFocusRefreshKey';
import { adminWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { getLanguage, localizeErrorMessage } from '../i18n';
import { useAuthStore } from '../stores/authStore';
import { isSubscriptionExpired, type StoreRecord, type StoreSubscription, type UserSummary } from '../types/domain';
import { userService } from '../services/userService';
import { formatTnd } from '../lib/format';
import { shareTextAsPdf } from '../services/receiptExport';

type StoreFilter = 'all' | 'active' | 'suspended' | 'archived';
type OwnerCredentials = { email: string; password: string; title: string; storeCode?: string };

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function storeIsSuspended(store: StoreRecord): boolean {
  return !store.isActive || Boolean(store.archivedAt) || isSubscriptionExpired(store);
}

function subscriptionDaysRemaining(paidUntil: string): number {
  const [year, month, day] = paidUntil.split('-').map(Number);
  const expiry = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

function subscriptionFor(store: StoreRecord): StoreSubscription {
  return store.subscription ?? { plan: 'trial', paidUntil: null, notes: '' };
}

function ExpiryTag({ store }: { store: StoreRecord }) {
  const paidUntil = store.subscription?.paidUntil;
  if (!paidUntil) return <StatusTag status="closed">{t('admin.noExpirySet')}</StatusTag>;
  const days = subscriptionDaysRemaining(paidUntil);
  if (days < 0) return <StatusTag status="suspended">{t('admin.expiredAgo', { days: Math.abs(days) })}</StatusTag>;
  return <StatusTag status={days <= 7 ? 'pending' : 'open'}>{t('admin.expiresIn', { days })}</StatusTag>;
}

export function SuperAdminOverviewScreen() {
  const refreshKey = useFocusRefreshKey();
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ totalOrders: 0, totalSales: 0, noOpenShifts: 0 });
  const [error, setError] = useState('');
  const today = localDateKey(new Date());

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [allStores, overview] = await Promise.all([
          userService.listStores(),
          userService.getSuperAdminStoreOverview('', 500, 0),
        ]);
        if (!active) return;
        setStores(allStores);
        setStats({
          totalOrders: overview.reduce((sum, store) => sum + store.todayOrderCount, 0),
          totalSales: overview.reduce((sum, store) => sum + store.todaySalesMillimes, 0),
          noOpenShifts: overview.filter((store) => store.openShiftCount === 0 && !store.archivedAt).length,
        });
        setError('');
      } catch (loadError) {
        console.error('Unable to load platform overview.', loadError);
        if (active) setError(t('admin.platformLoadError'));
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [refreshKey]);

  const nonArchivedStores = stores.filter((store) => !store.archivedAt);
  const activeStores = nonArchivedStores.filter((store) => !storeIsSuspended(store));
  const suspendedStores = nonArchivedStores.filter(storeIsSuspended);
  const newestStores = [...stores].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 5);
  const storesWithOpenShifts = Math.max(0, nonArchivedStores.length - stats.noOpenShifts);
  const openShiftStorePercent = nonArchivedStores.length
    ? Math.round((storesWithOpenShifts / nonArchivedStores.length) * 100)
    : 0;

  return (
    <WorkspaceLayout title={t('admin.platformOverview')} links={adminWorkspaceLinks}>
      <div className="role-dashboard super-admin-dashboard">
      <header className="dashboard-welcome mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">{t('admin.platformOverview')}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">{t('admin.allStoreActivity', { date: today })}</p>
        </div>
        <Link to="/admin/stores" className="dashboard-primary-action inline-flex min-h-11 items-center gap-2 rounded-xl px-4 font-body text-label-md">
          <MaterialIcon name="storefront" />{t('admin.manageStores')}
        </Link>
      </header>
      {error && <p role="alert" className="mb-4 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <OverviewMetric icon="storefront" tone="blue" label={t('admin.totalStores')} value={nonArchivedStores.length.toLocaleString(getLanguage())} />
        <OverviewMetric icon="check_circle" tone="green" label={t('common.active')} value={activeStores.length.toLocaleString(getLanguage())} />
        <OverviewMetric icon="pause_circle" tone="rose" label={t('common.suspended')} value={suspendedStores.length.toLocaleString(getLanguage())} />
        <OverviewMetric icon="receipt_long" tone="amber" label={t('admin.ordersToday')} value={stats.totalOrders.toLocaleString(getLanguage())} />
        <OverviewMetric icon="payments" tone="purple" label={t('admin.salesToday')} value={`${formatTnd(stats.totalSales / 1000)} DT`} />
      </section>
      <section className="super-admin-shift-card mb-5 rounded-2xl p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-body text-label-sm uppercase tracking-wide">{t('admin.liveOperations')}</p>
            <h2 className="mt-1 font-display text-headline-md">{t('admin.storesOpenShift')}</h2>
            <p className="mt-2 font-display text-headline-lg tabular-nums">
              {storesWithOpenShifts}
              <span className="ml-2 font-body text-body-sm">{t('admin.ofStores', { count: nonArchivedStores.length })}</span>
            </p>
          </div>
          <div className="super-admin-shift-summary">
            <span className="font-display text-title-lg tabular-nums">{stats.noOpenShifts}</span>
            <span className="font-body text-body-sm">{t('admin.withoutOpenShift')}</span>
          </div>
        </div>
        <div
          className="super-admin-shift-track mt-4"
          role="progressbar"
          aria-label={t('admin.storesOpenShift')}
          aria-valuemin={0}
          aria-valuemax={nonArchivedStores.length}
          aria-valuenow={storesWithOpenShifts}
        >
          <span style={{ width: `${openShiftStorePercent}%` }} />
        </div>
      </section>
      <section className="dashboard-glass rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-headline-md text-on-surface">{t('admin.newestStores')}</h2>
          <Link to="/admin/stores" className="font-body text-label-md text-primary underline">{t('admin.viewAll')}</Link>
        </div>
        <div className="flex flex-col gap-2">
          {loading ? <ListSkeleton rows={2} label={t('admin.loadingNewestStores')} /> : newestStores.map((store) => (
            <Link key={store.id} to={`/admin/stores/${store.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-container-low p-3">
              <span className="min-w-0">
                <span className="block truncate font-body text-label-md text-on-surface">{store.name}</span>
                <span className="font-body text-body-sm text-outline">{store.code.toUpperCase()} · {new Date(store.createdAt).toLocaleDateString(getLanguage())}</span>
              </span>
              <span className="flex flex-wrap gap-2">
                <StatusTag status={storeIsSuspended(store) ? 'suspended' : 'open'}>{t(storeIsSuspended(store) ? 'common.suspended' : 'common.active')}</StatusTag>
                <ExpiryTag store={store} />
              </span>
            </Link>
          ))}
          {!loading && !error && newestStores.length === 0 && <p className="font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </div>
      </section>
      </div>
    </WorkspaceLayout>
  );
}

function OverviewMetric({
  icon,
  tone,
  label,
  value,
}: {
  icon: string;
  tone: 'blue' | 'green' | 'rose' | 'amber' | 'purple';
  label: string;
  value: string;
}) {
  return (
    <article className={`overview-metric overview-metric--${tone} dashboard-glass dashboard-glass-tint--${tone} min-w-0 rounded-2xl p-3 sm:p-4`}>
      <span className="overview-metric__icon"><MaterialIcon name={icon} /></span>
      <p className="font-body text-body-sm text-outline">{label}</p>
      <p className="mt-1 truncate font-display text-title-lg tabular-nums text-primary">{value}</p>
    </article>
  );
}

function SuperAdminStoresContent() {
  const admin = useAuthStore((state) => state.user);
  const refreshKey = useFocusRefreshKey();
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [owners, setOwners] = useState<Record<string, UserSummary | undefined>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [storeName, setStoreName] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StoreFilter>('all');
  const [credentials, setCredentials] = useState<OwnerCredentials | null>(null);
  const [resetTarget, setResetTarget] = useState<StoreRecord | null>(null);
  const [nameTarget, setNameTarget] = useState<StoreRecord | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [subscriptionTarget, setSubscriptionTarget] = useState<StoreRecord | null>(null);
  const [subscriptionDraft, setSubscriptionDraft] = useState<StoreSubscription>({ plan: 'trial', paidUntil: null, notes: '' });
  const [archiveTarget, setArchiveTarget] = useState<StoreRecord | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    const nextStores = await userService.listStores();
    const ownerRecords = await userService.listUsers();
    const ownersById = new Map(ownerRecords.map((owner) => [owner.id, owner]));
    setStores(nextStores);
    setOwners(Object.fromEntries(nextStores.map((store) => [store.ownerId, ownersById.get(store.ownerId)])));
  }

  useEffect(() => {
    let active = true;
    void refresh().catch((loadError: unknown) => {
      console.error('Unable to load stores.', loadError);
      if (active) setError(t('common.loadFailed'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [refreshKey]);

  async function createOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const result = await userService.createOwnerAccount({ name, email, storeName });
      setCredentials({
        email: result.owner.email ?? email,
        password: result.temporaryPassword,
        title: t('admin.newOwnerCredentials'),
        storeCode: result.store.code,
      });
      setName('');
      setEmail('');
      setStoreName('');
      setCreateOpen(false);
      await refresh();
    } catch (createError) {
      setError(localizeErrorMessage(createError, t('admin.createOwnerError')));
    }
  }

  async function toggleStore(store: StoreRecord) {
    setError('');
    setNotice('');
    try {
      await userService.suspendStore(store.id, !store.isActive);
      await refresh();
      setNotice(t(store.isActive ? 'admin.storeSuspendedNotice' : 'admin.storeActivatedNotice', { name: store.name }));
    } catch (toggleError) {
      setError(localizeErrorMessage(toggleError, t('admin.updateStoreError')));
    }
  }

  async function toggleOwner(ownerId: string, owner: UserSummary | undefined) {
    if (!owner) return;
    setError('');
    setNotice('');
    try {
      await userService.suspendOwner(ownerId, !owner.isActive);
      await refresh();
      setNotice(t(owner.isActive ? 'admin.ownerSuspendedNotice' : 'admin.ownerActivatedNotice', { name: owner.name }));
    } catch (toggleError) {
      setError(localizeErrorMessage(toggleError, t('admin.updateOwnerError')));
    }
  }

  async function resetOwnerPassword() {
    if (!resetTarget || !admin) return;
    const owner = owners[resetTarget.ownerId];
    if (!owner) {
      setError(t('admin.ownerNotFound'));
      return;
    }
    setError('');
    try {
      const password = await userService.resetOwnerPassword(owner.id, admin.id);
      setResetTarget(null);
      setCredentials({ email: owner.email ?? '', password, title: t('admin.temporaryPasswordFor', { name: owner.name }), storeCode: resetTarget.code });
      setNotice(t('admin.passwordResetNotice'));
      await refresh();
    } catch (resetError) {
      setError(localizeErrorMessage(resetError, t('admin.resetPasswordError')));
    }
  }

  async function saveStoreName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameTarget || !admin) return;
    setError('');
    try {
      await userService.updateStoreNameAsAdmin(nameTarget.id, admin.id, nameDraft);
      setNotice(t('admin.storeNameUpdated'));
      setNameTarget(null);
      await refresh();
    } catch (updateError) {
      setError(localizeErrorMessage(updateError, t('admin.updateStoreNameError')));
    }
  }

  async function saveSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subscriptionTarget || !admin) return;
    setError('');
    try {
      await userService.updateStoreSubscription(subscriptionTarget.id, admin.id, subscriptionDraft);
      setNotice(t('admin.subscriptionSaved', { name: subscriptionTarget.name }));
      setSubscriptionTarget(null);
      await refresh();
    } catch (updateError) {
      setError(localizeErrorMessage(updateError, t('admin.updateSubscriptionError')));
    }
  }

  async function archiveStore() {
    if (!archiveTarget || !admin) return;
    setError('');
    try {
      await userService.archiveStore(archiveTarget.id, admin.id);
      setNotice(t('admin.storeArchived', { name: archiveTarget.name }));
      setArchiveTarget(null);
      await refresh();
    } catch (archiveError) {
      setError(localizeErrorMessage(archiveError, t('admin.archiveStoreError')));
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t('admin.clipboardUnavailable'));
      await navigator.clipboard.writeText(`${credentials.storeCode ? `${t('admin.storeId')}: ${credentials.storeCode.toUpperCase()}\n` : ''}${t('admin.email')}: ${credentials.email}\n${t('admin.temporaryPassword')}: ${credentials.password}`);
      setNotice(t('admin.credentialsCopied'));
      setError('');
    } catch (copyError) {
      setError(localizeErrorMessage(copyError, t('admin.copyCredentialsError')));
    }
  }

  async function copyCredentialValue(label: string, value: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error(t('admin.clipboardUnavailable'));
      await navigator.clipboard.writeText(value);
      setNotice(t('admin.copied', { label }));
      setError('');
    } catch (copyError) {
      setError(localizeErrorMessage(copyError, t('admin.copyValueError', { label })));
    }
  }

  async function shareCredentials() {
    if (!credentials) return;
    const text = `${credentials.storeCode ? `${t('admin.storeId')}: ${credentials.storeCode.toUpperCase()}\n` : ''}${t('admin.email')}: ${credentials.email}\n${t('admin.temporaryPassword')}: ${credentials.password}`;
    try {
      await shareTextAsPdf(text, `owner-credentials-${credentials.email}`, credentials.title);
      setNotice(t('admin.credentialsPdfShared'));
      setError('');
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      setError(localizeErrorMessage(shareError, t('admin.shareCredentialsError')));
    }
  }

  const visibleStores = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return stores.filter((store) => {
      const status = store.archivedAt ? 'archived' : storeIsSuspended(store) ? 'suspended' : 'active';
      const matchesStatus = statusFilter === 'all' || status === statusFilter;
      const owner = owners[store.ownerId];
      const matchesSearch = !query || [store.name, store.code, owner?.name, owner?.email]
        .some((value) => value?.toLocaleLowerCase().includes(query));
      return matchesStatus && matchesSearch;
    }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [owners, search, statusFilter, stores]);
  const storeCodePreview = storeName.trim()
    ? userService.generateStoreCode(storeName, stores.map((store) => store.code))
    : '';

  return (
    <WorkspaceLayout title={t('admin.storeList')} links={adminWorkspaceLinks}>
      <header className="mb-4">
        <h1 className="font-display text-headline-lg text-on-surface">{t('admin.storeList')}</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">{t('admin.manageDescription')}</p>
      </header>

      <Button className="mb-5 w-full sm:w-auto" onClick={() => setCreateOpen(true)}><MaterialIcon name="add" />{t('admin.createOwner')}</Button>

      <section aria-label={t('admin.storeFilters')} className="mb-4 flex flex-col gap-3">
        <label className="relative block">
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-outline" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('admin.searchStoresPlaceholder')} aria-label={t('admin.searchStoresLabel')} className="h-12 w-full rounded-xl bg-surface-container-lowest pl-11 pr-4 font-body outline-none ring-1 ring-outline-variant focus:ring-2 focus:ring-primary" />
        </label>
        <div className="scrollbar-hidden flex gap-2 overflow-x-auto py-1">
          {(['all', 'active', 'suspended', 'archived'] as StoreFilter[]).map((filter) => (
            <button key={filter} type="button" aria-pressed={statusFilter === filter} onClick={() => setStatusFilter(filter)} className={`min-h-11 shrink-0 rounded-full px-4 font-body text-label-md ${statusFilter === filter ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
              {filter === 'all' ? t('admin.allStores') : filter === 'active' ? t('common.active') : filter === 'suspended' ? t('common.suspended') : t('admin.archived')}
            </button>
          ))}
          <span className="ml-auto self-center whitespace-nowrap font-body text-body-sm text-outline">{t('admin.storeCount', { count: visibleStores.length })}</span>
        </div>
      </section>

      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mb-3 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-success-dark'}`}>{error || notice}</p>}

      <section className="flex flex-col gap-3">
        {loading ? <ListSkeleton label={t('admin.loadingStores')} /> : visibleStores.map((store) => {
          const owner = owners[store.ownerId];
          const suspended = storeIsSuspended(store);
          return (
            <article key={store.id} className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-body text-label-lg text-on-surface">{store.name}</h2>
                  <p className="mt-1 break-all font-body text-body-sm text-outline">{store.code.toUpperCase()} · {owner?.email ?? t('admin.ownerUnavailable')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusTag status={store.archivedAt ? 'suspended' : suspended ? 'suspended' : 'open'}>{store.archivedAt ? t('admin.archived') : suspended ? t('common.suspended') : t('common.active')}</StatusTag>
                    {owner && <StatusTag status={owner.isActive ? 'open' : 'suspended'}>{t('admin.ownerStatus', { status: owner.isActive ? t('admin.ownerActive') : t('admin.ownerSuspended') })}</StatusTag>}
                    <StatusTag status="closed">{t('admin.plan', { plan: t(`admin.${subscriptionFor(store).plan}` as 'admin.trial' | 'admin.monthly' | 'admin.yearly') })}</StatusTag>
                    <ExpiryTag store={store} />
                  </div>
                  {isSubscriptionExpired(store) && <p className="mt-2 font-body text-body-sm text-error-dark">{t('admin.subscriptionExpiredWarning')}</p>}
                </div>
                <Link to={`/admin/stores/${store.id}`} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg bg-surface-container-high px-3 font-body text-label-md text-primary"><MaterialIcon name="visibility" className="text-lg" />{t('admin.readOnly')}</Link>
              </div>
              {store.subscription?.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-container-low p-3 font-body text-body-sm text-on-surface-variant">{store.subscription.notes}</p>}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Button type="button" variant="secondary" className="min-h-11 w-full" onClick={() => { setSubscriptionTarget(store); setSubscriptionDraft(subscriptionFor(store)); }}>
                  <MaterialIcon name="credit_card" />{t('admin.subscription')}
                </Button>
                <Button type="button" variant="secondary" className="min-h-11 w-full" onClick={() => { setNameTarget(store); setNameDraft(store.name); }}>
                  <MaterialIcon name="edit" />{t('admin.editStoreName')}
                </Button>
                {owner && <Button type="button" variant="secondary" className="min-h-11 w-full" onClick={() => { setResetTarget(store); }}>
                  <MaterialIcon name="lock_reset" />{t('admin.resetOwnerPassword')}
                </Button>}
                {owner && <Button type="button" variant="secondary" className="min-h-11 w-full" onClick={() => { void toggleOwner(owner.id, owner); }}>
                  <MaterialIcon name={owner.isActive ? 'person_off' : 'person'} />{owner.isActive ? t('admin.suspendOwner') : t('admin.activateOwner')}
                </Button>}
                {!store.archivedAt && <Button type="button" variant={store.isActive && !isSubscriptionExpired(store) ? 'danger' : 'secondary'} className="min-h-11 w-full" onClick={() => {
                  if (isSubscriptionExpired(store)) {
                    setSubscriptionTarget(store);
                    setSubscriptionDraft(subscriptionFor(store));
                  } else {
                    void toggleStore(store);
                  }
                }}>
                  <MaterialIcon name={isSubscriptionExpired(store) ? 'credit_card' : store.isActive ? 'block' : 'check_circle'} />
                  {isSubscriptionExpired(store) ? t('admin.renewSubscription') : store.isActive ? t('admin.suspendStore') : t('admin.activateStore')}
                </Button>}
                {!store.archivedAt && <Button type="button" variant="danger" className="min-h-11 w-full" onClick={() => setArchiveTarget(store)}>
                  <MaterialIcon name="archive" />{t('admin.archiveStore')}
                </Button>}
              </div>
            </article>
          );
        })}
        {!loading && !error && visibleStores.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{stores.length === 0 ? t('common.noData') : t('admin.noFilterMatches')}</p>}
      </section>

      <BottomSheet open={Boolean(credentials)} onClose={() => setCredentials(null)} title={credentials?.title}>
        {credentials && (
          <div className="flex flex-col gap-4">
            <p className="font-body text-body-md text-on-surface-variant">{t('admin.credentialsDescription')}</p>
            {credentials.storeCode && <CredentialField label={t('admin.storeId')} value={credentials.storeCode.toUpperCase()} onCopy={() => { void copyCredentialValue(t('admin.storeId'), credentials.storeCode?.toUpperCase() ?? ''); }} />}
            <CredentialField label={t('admin.email')} value={credentials.email} onCopy={() => { void copyCredentialValue(t('admin.email'), credentials.email); }} />
            <CredentialField label={t('admin.temporaryPassword')} value={credentials.password} onCopy={() => { void copyCredentialValue(t('admin.password'), credentials.password); }} />
            {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
            {notice && <p role="status" className="font-body text-body-sm text-success-dark">{notice}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" className="min-h-12" onClick={() => { void copyCredentials(); }}><MaterialIcon name="content_copy" />{t('admin.copyAll')}</Button>
              <Button type="button" className="min-h-12" onClick={() => { void shareCredentials(); }}><MaterialIcon name="share" />{t('admin.share')}</Button>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={Boolean(resetTarget)} onClose={() => setResetTarget(null)} title={t('admin.resetPasswordTitle')}>
        <div className="flex flex-col gap-4">
          <p className="font-body text-body-md text-on-surface-variant">{t('admin.resetPasswordDescription', { name: owners[resetTarget?.ownerId ?? '']?.name ?? t('common.owner') })}</p>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" className="min-h-12" onClick={() => setResetTarget(null)}>{t('common.cancel')}</Button>
            <Button type="button" className="min-h-12" onClick={() => { void resetOwnerPassword(); }}>{t('admin.resetPasswordButton')}</Button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={Boolean(nameTarget)} onClose={() => setNameTarget(null)} title={t('admin.editStoreName')}>
        <form onSubmit={(event) => { void saveStoreName(event); }} className="flex flex-col gap-4">
          <label className="font-body text-label-md text-on-surface">{t('admin.storeNameLabel')}
            <input required autoFocus value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit" className="min-h-12">{t('admin.saveName')}</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={Boolean(subscriptionTarget)} onClose={() => setSubscriptionTarget(null)} title={`${subscriptionTarget?.name ?? ''} ${t('admin.subscription').toLocaleLowerCase()}`}>
        <form onSubmit={(event) => { void saveSubscription(event); }} className="flex flex-col gap-4">
          <label className="font-body text-label-md text-on-surface">{t('admin.planLabel')}
            <select value={subscriptionDraft.plan} onChange={(event) => setSubscriptionDraft((current) => ({ ...current, plan: event.target.value as StoreSubscription['plan'] }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary">
              <option value="trial">{t('admin.trial')}</option><option value="monthly">{t('admin.monthly')}</option><option value="yearly">{t('admin.yearly')}</option>
            </select>
          </label>
          <label className="font-body text-label-md text-on-surface">{t('admin.paidUntil')}
            <input type="date" value={subscriptionDraft.paidUntil ?? ''} onChange={(event) => setSubscriptionDraft((current) => ({ ...current, paidUntil: event.target.value || null }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>
          <p className="-mt-2 font-body text-body-sm text-outline">{t('admin.paidUntilHelp')}</p>
          <label className="font-body text-label-md text-on-surface">{t('admin.notes')}
            <textarea maxLength={1000} rows={4} value={subscriptionDraft.notes} onChange={(event) => setSubscriptionDraft((current) => ({ ...current, notes: event.target.value }))} className="mt-1 w-full rounded-lg bg-surface-container-low px-3 py-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit" className="min-h-12">{t('admin.saveSubscription')}</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={Boolean(archiveTarget)} onClose={() => setArchiveTarget(null)} title={t('admin.archiveTitle')}>
        <div className="flex flex-col gap-4">
          <p className="font-body text-body-md text-on-surface-variant">{t('admin.archiveDescription', { name: archiveTarget?.name ?? '' })}</p>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" className="min-h-12" onClick={() => setArchiveTarget(null)}>{t('common.cancel')}</Button>
            <Button type="button" variant="danger" className="min-h-12" onClick={() => { void archiveStore(); }}>{t('admin.archiveStore')}</Button>
          </div>
        </div>
      </BottomSheet>
      <BottomSheet open={createOpen} onClose={() => setCreateOpen(false)} title={t('admin.createOwner')}>
        <form onSubmit={(event) => { void createOwner(event); }} className="flex flex-col gap-3">
          <label className="font-body text-label-md">{t('common.name')}<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          <label className="font-body text-label-md">{t('admin.ownerEmail')}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          <label className="font-body text-label-md">{t('admin.storeName')}<input required value={storeName} onChange={(event) => setStoreName(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          <label className="font-body text-label-md">{t('admin.storeCode')}<input readOnly value={storeCodePreview.toUpperCase()} placeholder={t('admin.storeCodePlaceholder')} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 font-mono outline-none" /></label>
          <p className="-mt-2 font-body text-body-sm text-on-surface-variant">{t('admin.storeCodeHelp')}</p>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="sheet-action-bar grid grid-cols-2 gap-2">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button type="submit">{t('admin.createAccount')}</Button>
          </div>
        </form>
      </BottomSheet>
    </WorkspaceLayout>
  );
}

function CredentialField({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <label className="font-body text-label-md text-on-surface">{label}
      <span className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <input readOnly value={value} className="h-12 min-w-0 rounded-lg bg-surface-container-low px-3 font-mono text-body-sm" />
        <Button type="button" variant="secondary" className="min-h-12 px-3" onClick={onCopy}>{t('admin.copy')}</Button>
      </span>
    </label>
  );
}

export function SuperAdminStoresScreen() {
  return <SuperAdminStoresContent />;
}
