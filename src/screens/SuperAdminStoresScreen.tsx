import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { adminWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { orderService } from '../services/orderService';
import { shiftService } from '../services/shiftService';
import { useAuthStore } from '../stores/authStore';
import { isSubscriptionExpired, type StoreRecord, type StoreSubscription, type UserSummary } from '../types/domain';
import { userService } from '../services/userService';
import { formatTnd } from '../lib/format';

type StoreFilter = 'all' | 'active' | 'suspended' | 'archived';
type OwnerCredentials = { email: string; password: string; title: string };

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
  if (!paidUntil) return <StatusTag status="closed">No expiry set</StatusTag>;
  const days = subscriptionDaysRemaining(paidUntil);
  if (days < 0) return <StatusTag status="suspended">{`Expired ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago`}</StatusTag>;
  return <StatusTag status={days <= 7 ? 'pending' : 'open'}>{`Expires in ${days} ${days === 1 ? 'day' : 'days'}`}</StatusTag>;
}

export function SuperAdminOverviewScreen() {
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [stats, setStats] = useState({ totalOrders: 0, totalSales: 0, noOpenShifts: 0 });
  const [error, setError] = useState('');
  const today = localDateKey(new Date());

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const allStores = await userService.listStores();
        const visibleStores = allStores.filter((store) => !store.archivedAt);
        const summaries = await Promise.all(visibleStores.map(async (store) => {
          const [orders, shifts] = await Promise.all([
            orderService.listToday(store.id),
            shiftService.listShifts(store.id),
          ]);
          return {
            orders,
            hasOpenShift: shifts.some((shift) => shift.status === 'open'),
          };
        }));
        if (!active) return;
        setStores(allStores);
        setStats({
          totalOrders: summaries.reduce((sum, summary) => sum + summary.orders.length, 0),
          totalSales: summaries.reduce((sum, summary) => sum + summary.orders
            .filter((order) => order.status === 'done')
            .reduce((sales, order) => sales + order.totalMillimes, 0), 0),
          noOpenShifts: summaries.filter((summary) => !summary.hasOpenShift).length,
        });
        setError('');
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load platform overview.');
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  const nonArchivedStores = stores.filter((store) => !store.archivedAt);
  const activeStores = nonArchivedStores.filter((store) => !storeIsSuspended(store));
  const suspendedStores = nonArchivedStores.filter(storeIsSuspended);
  const newestStores = [...stores].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, 5);

  return (
    <WorkspaceLayout title="Platform overview" links={adminWorkspaceLinks}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">Platform overview</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">All-store activity for {today}.</p>
        </div>
        <Link to="/admin/stores" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 font-body text-label-md text-on-primary">
          <MaterialIcon name="storefront" />Manage stores
        </Link>
      </header>
      {error && <p role="alert" className="mb-4 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <OverviewMetric label="Total stores" value={nonArchivedStores.length.toLocaleString()} />
        <OverviewMetric label="Active" value={activeStores.length.toLocaleString()} />
        <OverviewMetric label="Suspended" value={suspendedStores.length.toLocaleString()} />
        <OverviewMetric label="Orders today" value={stats.totalOrders.toLocaleString()} />
        <OverviewMetric label="Sales today" value={`${formatTnd(stats.totalSales / 1000)} DT`} />
      </section>
      <section className="mb-5 rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <h2 className="font-display text-headline-md text-on-surface">Stores with no open shift</h2>
        <p className="mt-1 font-display text-headline-lg tabular-nums text-primary">{stats.noOpenShifts} <span className="font-body text-body-sm text-on-surface-variant">of {nonArchivedStores.length} stores</span></p>
      </section>
      <section className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-display text-headline-md text-on-surface">Newest stores</h2>
          <Link to="/admin/stores" className="font-body text-label-md text-primary underline">View all</Link>
        </div>
        <div className="flex flex-col gap-2">
          {newestStores.map((store) => (
            <Link key={store.id} to={`/admin/stores/${store.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-container-low p-3">
              <span className="min-w-0">
                <span className="block truncate font-body text-label-md text-on-surface">{store.name}</span>
                <span className="font-body text-body-sm text-outline">{store.code} · {new Date(store.createdAt).toLocaleDateString()}</span>
              </span>
              <span className="flex flex-wrap gap-2">
                <StatusTag status={storeIsSuspended(store) ? 'suspended' : 'open'}>{storeIsSuspended(store) ? 'Suspended' : 'Active'}</StatusTag>
                <ExpiryTag store={store} />
              </span>
            </Link>
          ))}
          {newestStores.length === 0 && <p className="font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </div>
      </section>
    </WorkspaceLayout>
  );
}

function OverviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="min-w-0 rounded-xl bg-surface-container-lowest p-3 shadow-card sm:p-4">
      <p className="font-body text-body-sm text-outline">{label}</p>
      <p className="mt-1 truncate font-display text-title-lg tabular-nums text-primary">{value}</p>
    </article>
  );
}

function SuperAdminStoresContent() {
  const admin = useAuthStore((state) => state.user);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [owners, setOwners] = useState<Record<string, UserSummary | undefined>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [storeName, setStoreName] = useState('');
  const [storeCode, setStoreCode] = useState('');
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
    const ownerRecords = await Promise.all(nextStores.map((store) => userService.getUser(store.ownerId)));
    setStores(nextStores);
    setOwners(Object.fromEntries(nextStores.map((store, index) => [store.ownerId, ownerRecords[index]])));
  }

  useEffect(() => {
    let active = true;
    void refresh().catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : t('common.loadFailed'));
    });
    return () => { active = false; };
  }, []);

  async function createOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const result = await userService.createOwnerAccount({ name, email, storeName, storeCode });
      setCredentials({ email: result.owner.email ?? email, password: result.temporaryPassword, title: 'New owner credentials' });
      setName('');
      setEmail('');
      setStoreName('');
      setStoreCode('');
      await refresh();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to create the owner account.');
    }
  }

  async function toggleStore(store: StoreRecord) {
    setError('');
    setNotice('');
    try {
      await userService.suspendStore(store.id, !store.isActive);
      await refresh();
      setNotice(`${store.name} ${store.isActive ? 'suspended' : 'activated'}.`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to update the store.');
    }
  }

  async function toggleOwner(ownerId: string, owner: UserSummary | undefined) {
    if (!owner) return;
    setError('');
    setNotice('');
    try {
      await userService.suspendOwner(ownerId, !owner.isActive);
      await refresh();
      setNotice(`${owner.name} ${owner.isActive ? 'suspended' : 'activated'}.`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to update the owner.');
    }
  }

  async function resetOwnerPassword() {
    if (!resetTarget || !admin) return;
    const owner = owners[resetTarget.ownerId];
    if (!owner) {
      setError('Owner account could not be found.');
      return;
    }
    setError('');
    try {
      const password = await userService.resetOwnerPassword(owner.id, admin.id);
      setResetTarget(null);
      setCredentials({ email: owner.email ?? '', password, title: `Temporary password for ${owner.name}` });
      setNotice('Owner password reset. The owner must change it at next login.');
      await refresh();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Unable to reset the owner password.');
    }
  }

  async function saveStoreName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameTarget || !admin) return;
    setError('');
    try {
      await userService.updateStoreNameAsAdmin(nameTarget.id, admin.id, nameDraft);
      setNotice('Store name updated.');
      setNameTarget(null);
      await refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update the store name.');
    }
  }

  async function saveSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subscriptionTarget || !admin) return;
    setError('');
    try {
      await userService.updateStoreSubscription(subscriptionTarget.id, admin.id, subscriptionDraft);
      setNotice(`${subscriptionTarget.name} subscription saved.`);
      setSubscriptionTarget(null);
      await refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update the subscription.');
    }
  }

  async function archiveStore() {
    if (!archiveTarget || !admin) return;
    setError('');
    try {
      await userService.archiveStore(archiveTarget.id, admin.id);
      setNotice(`${archiveTarget.name} archived.`);
      setArchiveTarget(null);
      await refresh();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'Unable to archive the store.');
    }
  }

  async function copyCredentials() {
    if (!credentials) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(`Email: ${credentials.email}\nTemporary password: ${credentials.password}`);
      setNotice('Credentials copied.');
      setError('');
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Unable to copy credentials.');
    }
  }

  async function copyCredentialValue(label: string, value: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable.');
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
      setError('');
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : `Unable to copy ${label.toLocaleLowerCase()}.`);
    }
  }

  async function shareCredentials() {
    if (!credentials) return;
    const text = `Email: ${credentials.email}\nTemporary password: ${credentials.password}`;
    try {
      const shareAvailable = typeof navigator.share === 'function';
      if (shareAvailable) await navigator.share({ title: credentials.title, text });
      else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error('Sharing and clipboard access are unavailable.');
      setNotice(shareAvailable ? 'Credentials shared.' : 'Credentials copied.');
      setError('');
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      setError(shareError instanceof Error ? shareError.message : 'Unable to share credentials.');
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

  return (
    <WorkspaceLayout title={t('admin.storeList')} links={adminWorkspaceLinks}>
      <header className="mb-4">
        <h1 className="font-display text-headline-lg text-on-surface">{t('admin.storeList')}</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">Manage stores, subscriptions, and owner accounts.</p>
      </header>

      <form onSubmit={(event) => { void createOwner(event); }} className="mb-5 grid gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card sm:grid-cols-2">
        <h2 className="font-display text-headline-md text-on-surface sm:col-span-2">{t('admin.createOwner')}</h2>
        <label className="font-body text-label-md">{t('common.name')}<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
        <label className="font-body text-label-md">{t('admin.ownerEmail')}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
        <label className="font-body text-label-md">{t('admin.storeName')}<input required value={storeName} onChange={(event) => setStoreName(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
        <label className="font-body text-label-md">{t('admin.storeCode')}<input required pattern="[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*" value={storeCode} onChange={(event) => setStoreCode(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
        <Button type="submit" className="min-h-12 sm:col-span-2">{t('admin.createAccount')}</Button>
      </form>

      <section aria-label="Store filters" className="mb-4 flex flex-col gap-3">
        <label className="relative block">
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-outline" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stores or owners" aria-label="Search stores" className="h-12 w-full rounded-xl bg-surface-container-lowest pl-11 pr-4 font-body outline-none ring-1 ring-outline-variant focus:ring-2 focus:ring-primary" />
        </label>
        <div className="scrollbar-hidden flex gap-2 overflow-x-auto py-1">
          {(['all', 'active', 'suspended', 'archived'] as StoreFilter[]).map((filter) => (
            <button key={filter} type="button" aria-pressed={statusFilter === filter} onClick={() => setStatusFilter(filter)} className={`min-h-11 shrink-0 rounded-full px-4 font-body text-label-md ${statusFilter === filter ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface-variant'}`}>
              {filter === 'all' ? 'All stores' : filter[0].toLocaleUpperCase() + filter.slice(1)}
            </button>
          ))}
          <span className="ml-auto self-center whitespace-nowrap font-body text-body-sm text-outline">{visibleStores.length} stores</span>
        </div>
      </section>

      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mb-3 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-success-dark'}`}>{error || notice}</p>}

      <section className="flex flex-col gap-3">
        {visibleStores.map((store) => {
          const owner = owners[store.ownerId];
          const suspended = storeIsSuspended(store);
          return (
            <article key={store.id} className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-body text-label-lg text-on-surface">{store.name}</h2>
                  <p className="mt-1 break-all font-body text-body-sm text-outline">{store.code} · {owner?.email ?? 'Owner account unavailable'}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <StatusTag status={store.archivedAt ? 'suspended' : suspended ? 'suspended' : 'open'}>{store.archivedAt ? 'Archived' : suspended ? 'Suspended' : 'Active'}</StatusTag>
                    {owner && <StatusTag status={owner.isActive ? 'open' : 'suspended'}>{`Owner ${owner.isActive ? 'active' : 'suspended'}`}</StatusTag>}
                    <StatusTag status="closed">{`${subscriptionFor(store).plan} plan`}</StatusTag>
                    <ExpiryTag store={store} />
                  </div>
                  {isSubscriptionExpired(store) && <p className="mt-2 font-body text-body-sm text-error-dark">Subscription expired. Owner access is suspended until the subscription is renewed.</p>}
                </div>
                <Link to={`/admin/stores/${store.id}`} className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg bg-surface-container-high px-3 font-body text-label-md text-primary"><MaterialIcon name="visibility" className="text-lg" />{t('admin.readOnly')}</Link>
              </div>
              {store.subscription?.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-container-low p-3 font-body text-body-sm text-on-surface-variant">{store.subscription.notes}</p>}
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <Button type="button" variant="secondary" className="min-h-11 w-full" onClick={() => { setSubscriptionTarget(store); setSubscriptionDraft(subscriptionFor(store)); }}>
                  <MaterialIcon name="credit_card" />Subscription
                </Button>
                <Button type="button" variant="secondary" className="min-h-11 w-full" onClick={() => { setNameTarget(store); setNameDraft(store.name); }}>
                  <MaterialIcon name="edit" />Edit store name
                </Button>
                {owner && <Button type="button" variant="secondary" className="min-h-11 w-full" onClick={() => { setResetTarget(store); }}>
                  <MaterialIcon name="lock_reset" />Reset owner password
                </Button>}
                {owner && <Button type="button" variant="secondary" className="min-h-11 w-full" onClick={() => { void toggleOwner(owner.id, owner); }}>
                  <MaterialIcon name={owner.isActive ? 'person_off' : 'person'} />{owner.isActive ? 'Suspend owner' : 'Activate owner'}
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
                  {isSubscriptionExpired(store) ? 'Renew subscription' : store.isActive ? 'Suspend store' : 'Activate store'}
                </Button>}
                {!store.archivedAt && <Button type="button" variant="danger" className="min-h-11 w-full" onClick={() => setArchiveTarget(store)}>
                  <MaterialIcon name="archive" />Archive store
                </Button>}
              </div>
            </article>
          );
        })}
        {visibleStores.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{stores.length === 0 ? t('common.noData') : 'No stores match these filters.'}</p>}
      </section>

      <BottomSheet open={Boolean(credentials)} onClose={() => setCredentials(null)} title={credentials?.title}>
        {credentials && (
          <div className="flex flex-col gap-4">
            <p className="font-body text-body-md text-on-surface-variant">Share these temporary credentials securely. The owner must set a new password at next login.</p>
            <CredentialField label="Email" value={credentials.email} onCopy={() => { void copyCredentialValue('Email', credentials.email); }} />
            <CredentialField label="Temporary password" value={credentials.password} onCopy={() => { void copyCredentialValue('Password', credentials.password); }} />
            {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
            {notice && <p role="status" className="font-body text-body-sm text-success-dark">{notice}</p>}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" className="min-h-12" onClick={() => { void copyCredentials(); }}><MaterialIcon name="content_copy" />Copy all</Button>
              <Button type="button" className="min-h-12" onClick={() => { void shareCredentials(); }}><MaterialIcon name="share" />Share</Button>
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={Boolean(resetTarget)} onClose={() => setResetTarget(null)} title="Reset owner password?">
        <div className="flex flex-col gap-4">
          <p className="font-body text-body-md text-on-surface-variant">Reset the temporary password for {owners[resetTarget?.ownerId ?? '']?.name ?? 'this owner'}? Existing owner sessions will be signed out.</p>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" className="min-h-12" onClick={() => setResetTarget(null)}>Cancel</Button>
            <Button type="button" className="min-h-12" onClick={() => { void resetOwnerPassword(); }}>Reset password</Button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet open={Boolean(nameTarget)} onClose={() => setNameTarget(null)} title="Edit store name">
        <form onSubmit={(event) => { void saveStoreName(event); }} className="flex flex-col gap-4">
          <label className="font-body text-label-md text-on-surface">Store name
            <input required autoFocus value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit" className="min-h-12">Save name</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={Boolean(subscriptionTarget)} onClose={() => setSubscriptionTarget(null)} title={`${subscriptionTarget?.name ?? ''} subscription`}>
        <form onSubmit={(event) => { void saveSubscription(event); }} className="flex flex-col gap-4">
          <label className="font-body text-label-md text-on-surface">Plan
            <select value={subscriptionDraft.plan} onChange={(event) => setSubscriptionDraft((current) => ({ ...current, plan: event.target.value as StoreSubscription['plan'] }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary">
              <option value="trial">Trial</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
            </select>
          </label>
          <label className="font-body text-label-md text-on-surface">Paid until
            <input type="date" value={subscriptionDraft.paidUntil ?? ''} onChange={(event) => setSubscriptionDraft((current) => ({ ...current, paidUntil: event.target.value || null }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>
          <p className="-mt-2 font-body text-body-sm text-outline">Leave blank for no expiry. Owners cannot sign in after this date has passed.</p>
          <label className="font-body text-label-md text-on-surface">Notes
            <textarea maxLength={1000} rows={4} value={subscriptionDraft.notes} onChange={(event) => setSubscriptionDraft((current) => ({ ...current, notes: event.target.value }))} className="mt-1 w-full rounded-lg bg-surface-container-low px-3 py-3 outline-none focus:ring-2 focus:ring-primary" />
          </label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit" className="min-h-12">Save subscription</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={Boolean(archiveTarget)} onClose={() => setArchiveTarget(null)} title="Archive store?">
        <div className="flex flex-col gap-4">
          <p className="font-body text-body-md text-on-surface-variant">Archive {archiveTarget?.name}? This suspends owner access and keeps the store in the archived filter.</p>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="secondary" className="min-h-12" onClick={() => setArchiveTarget(null)}>Cancel</Button>
            <Button type="button" variant="danger" className="min-h-12" onClick={() => { void archiveStore(); }}>Archive store</Button>
          </div>
        </div>
      </BottomSheet>
    </WorkspaceLayout>
  );
}

function CredentialField({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <label className="font-body text-label-md text-on-surface">{label}
      <span className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <input readOnly value={value} className="h-12 min-w-0 rounded-lg bg-surface-container-low px-3 font-mono text-body-sm" />
        <Button type="button" variant="secondary" className="min-h-12 px-3" onClick={onCopy}>Copy</Button>
      </span>
    </label>
  );
}

export function SuperAdminStoresScreen() {
  return <SuperAdminStoresContent />;
}
