import { useState } from 'react';
import { Button } from '../components/Button';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { catalogService } from '../services/catalogService';
import { useAuthStore } from '../stores/authStore';
import type { CatalogItemRecord } from '../types/domain';
import { userService } from '../services/userService';

function OwnerInventoryContent() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [items, setItems] = useState(() => catalogService.listItems(storeId));
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function updateCount(item: CatalogItemRecord) {
    const rawCount = counts[item.id] ?? String(item.stockCount ?? '');
    if (!rawCount.trim()) {
      setError('Enter a stock count before updating.');
      setNotice('');
      return;
    }
    const count = Number(rawCount);
    if (!Number.isInteger(count) || count < 0) {
      setError('Enter a non-negative whole-number stock count.');
      setNotice('');
      return;
    }
    try {
      catalogService.setStockCount(item.id, count);
      setItems(catalogService.listItems(storeId));
      setCounts((current) => ({ ...current, [item.id]: String(count) }));
      setError('');
      setNotice(`${item.name} stock updated.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update stock.');
    }
  }

  return (
    <WorkspaceLayout title={t('inventory.title')} storeName={user?.storeId ? userService.getStore(user.storeId)?.name : undefined} links={ownerWorkspaceLinks}>
      <header className="mb-4">
        <h1 className="font-display text-headline-lg text-on-surface">{t('inventory.title')}</h1>
        <p className="mt-1 font-body text-body-md text-on-surface-variant">Track basic stock counts and availability.</p>
      </header>
      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mb-3 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}
      <section className="flex flex-col gap-2">
        {items.map((item) => (
          <article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-container text-primary"><MaterialIcon name={item.icon} /></span>
              <div><p className="font-body text-label-lg text-on-surface">{item.name}</p><StatusTag status={item.outOfStock ? 'voided' : 'open'}>{item.outOfStock ? '86 / out' : item.stockCount === null ? 'Not tracked' : `${item.stockCount} in stock`}</StatusTag></div>
            </div>
            <div className="flex items-center gap-2">
              <input aria-label={`${t('catalog.stockCount')}: ${item.name}`} type="number" min="0" step="1" value={counts[item.id] ?? (item.stockCount === null ? '' : item.stockCount)} placeholder="—" onChange={(event) => setCounts((current) => ({ ...current, [item.id]: event.target.value }))} className="h-11 w-24 rounded-lg bg-surface-container-low px-3 text-right font-body tabular-nums outline-none focus:ring-2 focus:ring-primary" />
              <Button variant="secondary" className="min-h-11 px-3" onClick={() => updateCount(item)}><MaterialIcon name="save" className="text-lg" />{t('inventory.updateCount')}</Button>
            </div>
          </article>
        ))}
      </section>
    </WorkspaceLayout>
  );
}

export function OwnerInventoryScreen() {
  return <OwnerInventoryContent />;
}
