import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { adminWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { userService } from '../services/userService';
import type { StoreRecord, UserSummary } from '../types/domain';

function SuperAdminStoresContent() {
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [owners, setOwners] = useState<Record<string, UserSummary | undefined>>({});
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [storeName, setStoreName] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function refresh() {
    const nextStores = await userService.listStores();
    const ownerRecords = await Promise.all(nextStores.map((store) => userService.getUser(store.ownerId)));
    setStores(nextStores);
    setOwners(Object.fromEntries(nextStores.map((store, index) => [store.ownerId, ownerRecords[index]])));
  }

  useEffect(() => {
    void refresh().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : t('common.loadFailed')));
  }, []);

  async function createOwner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const result = await userService.createOwnerAccount({ name, email, storeName, storeCode });
      setCredentials({ email: result.owner.email ?? email, password: result.temporaryPassword });
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
    try {
      await userService.suspendOwner(ownerId, !owner.isActive);
      await refresh();
      setNotice(`${owner.name} ${owner.isActive ? 'suspended' : 'activated'}.`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Unable to update the owner.');
    }
  }

  return (
    <WorkspaceLayout title={t('admin.title')} links={adminWorkspaceLinks}>
      <header className="mb-4">
        <h1 className="font-display text-headline-lg text-on-surface">{t('admin.title')}</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">Create and suspend owner accounts and stores.</p>
      </header>

      <form onSubmit={(event) => { void createOwner(event); }} className="mb-5 grid gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-card sm:grid-cols-2">
        <h2 className="sm:col-span-2 font-display text-headline-md text-on-surface">{t('admin.createOwner')}</h2>
        <label className="font-body text-label-md">{t('common.name')}<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
        <label className="font-body text-label-md">{t('admin.ownerEmail')}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
        <label className="font-body text-label-md">{t('admin.storeName')}<input required value={storeName} onChange={(event) => setStoreName(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
        <label className="font-body text-label-md">{t('admin.storeCode')}<input required pattern="[a-zA-Z0-9]+(-[a-zA-Z0-9]+)*" value={storeCode} onChange={(event) => setStoreCode(event.target.value)} className="mt-1.5 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
        <Button type="submit" className="sm:col-span-2">{t('admin.createAccount')}</Button>
      </form>

      {credentials && (
        <section role="status" className="mb-5 rounded-xl border border-success/30 bg-success-container p-4 text-on-success-container">
          <h2 className="font-display text-headline-sm">Share these initial owner credentials securely.</h2>
          <p className="mt-2 font-body text-body-md"><strong>{t('admin.ownerEmail')}:</strong> {credentials.email}</p>
          <p className="font-body text-body-md"><strong>{t('staff.temporaryPassword')}:</strong> {credentials.password}</p>
          <p className="mt-1 font-body text-body-sm">The owner must set a new password at first login.</p>
          <button type="button" onClick={() => setCredentials(null)} className="mt-2 min-h-10 font-body text-label-md underline">Dismiss</button>
        </section>
      )}
      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mb-3 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      <section>
        <h2 className="mb-3 font-display text-headline-md text-on-surface">{t('admin.storeList')}</h2>
        <div className="flex flex-col gap-3">
          {stores.map((store) => {
            const owner = owners[store.ownerId];
            return (
              <article key={store.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
                <div className="min-w-0">
                  <h3 className="truncate font-body text-label-lg text-on-surface">{store.name}</h3>
                  <p className="mt-1 font-body text-body-sm text-outline">{store.code} • {owner?.email ?? 'Owner account unavailable'}</p>
                  <div className="mt-2 flex flex-wrap gap-2"><StatusTag status={store.isActive ? 'open' : 'suspended'}>{store.isActive ? t('common.active') : t('common.suspended')}</StatusTag>{owner && <StatusTag status={owner.isActive ? 'open' : 'suspended'}>{`Owner ${owner.isActive ? 'active' : 'suspended'}`}</StatusTag>}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/admin/stores/${store.id}`} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-surface-container-high px-3 font-body text-label-md text-primary"><MaterialIcon name="visibility" className="text-lg" />{t('admin.readOnly')}</Link>
                  {owner && <Button variant="secondary" className="min-h-11 px-3 text-label-md" onClick={() => { void toggleOwner(owner.id, owner); }}>{owner.isActive ? 'Suspend owner' : 'Activate owner'}</Button>}
                  <Button variant={store.isActive ? 'danger' : 'secondary'} className="min-h-11 px-3 text-label-md" onClick={() => { void toggleStore(store); }}>{store.isActive ? t('admin.suspend') : t('admin.activate')}</Button>
                </div>
              </article>
            );
          })}
          {stores.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
        </div>
      </section>
    </WorkspaceLayout>
  );
}

export function SuperAdminStoresScreen() {
  return <SuperAdminStoresContent />;
}
