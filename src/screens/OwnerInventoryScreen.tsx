import { useEffect, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { ItemLogo } from '../components/ItemLogo';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { StatusTag } from '../components/StatusTag';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { DataTable, PageHeader, type DataTableColumn } from '../components/layout';
import { t } from '../i18n/translations';
import { catalogService } from '../services/catalogService';
import { useAuthStore } from '../stores/authStore';
import type { CatalogItemRecord, CategoryRecord, ItemHistoryRecord, StockAdjustmentReason } from '../types/domain';
import { userService } from '../services/userService';

const adjustmentReasons: { value: StockAdjustmentReason; label: string }[] = [
  { value: 'restock', label: 'Restock' },
  { value: 'correction', label: 'Correction' },
  { value: 'waste', label: 'Waste' },
];

function historyCount(value: ItemHistoryRecord['oldValue']): string {
  return typeof value === 'number' ? String(value) : 'Not tracked';
}

function OwnerInventoryContent() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [items, setItems] = useState<CatalogItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [storeName, setStoreName] = useState<string>();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [thresholds, setThresholds] = useState<Record<string, string>>({});
  const [adjustTarget, setAdjustTarget] = useState<CatalogItemRecord | null>(null);
  const [adjustmentReason, setAdjustmentReason] = useState<StockAdjustmentReason>('restock');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [historyItem, setHistoryItem] = useState<CatalogItemRecord | null>(null);
  const [itemHistory, setItemHistory] = useState<ItemHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    void Promise.all([
      catalogService.listItems(storeId),
      catalogService.listCategories(storeId),
      userService.getStore(storeId),
    ]).then(([nextItems, nextCategories, store]) => {
      if (!active) return;
      setItems(nextItems);
      setCategories(nextCategories);
      setStoreName(store?.name);
    }).catch((loadError: unknown) => {
      console.error('Unable to load inventory.', loadError);
      if (active) setError(t('common.loadFailed'));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [storeId]);

  async function refreshItems() {
    setItems(await catalogService.listItems(storeId));
  }

  async function updateTracking(item: CatalogItemRecord, track: boolean) {
    setError('');
    setNotice('');
    try {
      if (!user) throw new Error('Your account could not be loaded.');
      await catalogService.setStockTracking(item.id, track, { id: user.id, name: user.name });
      await refreshItems();
      setNotice(track ? `${item.name} stock tracking enabled.` : `${item.name} stock tracking disabled.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update stock tracking.');
    }
  }

  async function saveThreshold(item: CatalogItemRecord) {
    setError('');
    setNotice('');
    const rawThreshold = thresholds[item.id] ?? String(item.lowStockThreshold ?? 5);
    const threshold = Number(rawThreshold);
    if (!rawThreshold.trim() || !Number.isInteger(threshold) || threshold < 0) {
      setError('Enter a non-negative whole-number low-stock threshold.');
      return;
    }
    try {
      if (!user) throw new Error('Your account could not be loaded.');
      await catalogService.updateItem(item.id, { lowStockThreshold: threshold }, { id: user.id, name: user.name });
      await refreshItems();
      setThresholds((current) => ({ ...current, [item.id]: String(threshold) }));
      setNotice(`${item.name} low-stock threshold saved.`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to save the low-stock threshold.');
    }
  }

  function openAdjustment(item: CatalogItemRecord) {
    setError('');
    setAdjustmentReason('restock');
    setAdjustmentAmount('');
    setAdjustTarget(item);
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjustTarget) return;
    setError('');
    setNotice('');
    try {
      if (!user) throw new Error('Your account could not be loaded.');
      await catalogService.adjustStock(adjustTarget.id, Number(adjustmentAmount), adjustmentReason, { id: user.id, name: user.name });
      await refreshItems();
      setNotice(`${adjustTarget.name} stock adjusted.`);
      setAdjustTarget(null);
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : 'Unable to adjust stock.');
    }
  }

  async function openHistory(item: CatalogItemRecord) {
    setHistoryItem(item);
    setItemHistory([]);
    setHistoryError('');
    setHistoryLoading(true);
    try {
      setItemHistory((await catalogService.listItemHistory(item.id)).filter((record) => record.field === 'stockTracking'));
    } catch (loadError) {
      console.error('Unable to load stock history.', loadError);
      setHistoryError('Unable to load stock history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  }

  const visibleItems = items.filter((item) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesSearch = !query || [item.name, item.sku, item.description]
      .some((value) => value?.toLocaleLowerCase().includes(query));
    const matchesCategory = categoryFilter === 'all' || item.categoryId === categoryFilter;
    const matchesLowStock = !lowStockOnly ||
      (item.stockCount !== null && item.stockCount <= (item.lowStockThreshold ?? 5));
    return matchesSearch && matchesCategory && matchesLowStock;
  });

  return (
    <WorkspaceLayout title={t('inventory.title')} storeName={storeName} links={ownerWorkspaceLinks}>
      <PageHeader title={t('inventory.title')} subtitle="Manage stock tracking, counts, and adjustments." />

      <section aria-label="Inventory filters" className="mb-4 flex flex-col gap-3">
        <label className="relative block">
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-outline" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search products"
            aria-label="Search inventory"
            className="h-12 w-full rounded-xl bg-surface-container-lowest pl-11 pr-4 font-body outline-none ring-1 ring-outline-variant focus:ring-2 focus:ring-primary"
          />
        </label>
        <div className="scrollbar-hidden flex gap-2 overflow-x-auto py-1">
          <Chip selected={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>All categories</Chip>
          {categories.map((category) => (
            <Chip key={category.id} selected={categoryFilter === category.id} onClick={() => setCategoryFilter(category.id)}>
              <ItemLogo id={category.icon} size="sm" />{category.name}
            </Chip>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Chip selected={lowStockOnly} onClick={() => setLowStockOnly((selected) => !selected)}>
            <MaterialIcon name="warning" className="text-lg" />Low stock
          </Chip>
          <span className="font-body text-body-sm text-outline">{visibleItems.length} items</span>
        </div>
      </section>

      {(error || notice) && (
        <p role={error ? 'alert' : 'status'} className={`mb-3 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-success-dark'}`}>
          {error || notice}
        </p>
      )}

      <div className="hidden lg:block">
        {loading ? <ListSkeleton label="Loading inventory" /> : <DataTable<CatalogItemRecord>
          rows={visibleItems}
          getRowKey={(item) => item.id}
          columns={[
            { key: 'name', label: 'Item', sortValue: (item) => item.name, render: (item) => <span className="flex min-w-0 items-center gap-2"><ItemLogo id={item.icon} size="sm" /><span className="truncate">{item.name}</span></span> },
            { key: 'category', label: 'Category', sortValue: (item) => categories.find((category) => category.id === item.categoryId)?.name ?? '', render: (item) => categories.find((category) => category.id === item.categoryId)?.name ?? 'Uncategorized' },
            { key: 'tracked', label: 'Tracked', render: (item) => (
              <input type="checkbox" role="switch" aria-label={`Track stock for ${item.name}`} checked={item.stockCount !== null} onChange={(event) => { void updateTracking(item, event.target.checked); }} className="h-5 w-5 accent-primary" />
            ) },
            { key: 'stock', label: 'Stock', sortValue: (item) => item.stockCount ?? -1, render: (item) => item.stockCount === null ? 'Not tracked' : item.outOfStock ? 'Out of stock' : `${item.stockCount} in stock` },
            { key: 'threshold', label: 'Low-stock threshold', sortValue: (item) => item.lowStockThreshold ?? 5, render: (item) => (
              <div className="flex items-center gap-2">
                <input type="number" min="0" step="1" aria-label={`Threshold for ${item.name}`} value={thresholds[item.id] ?? String(item.lowStockThreshold ?? 5)} onChange={(event) => setThresholds((current) => ({ ...current, [item.id]: event.target.value }))} className="h-9 w-20 rounded-md bg-surface-container-low px-2" />
                <Button variant="secondary" className="min-h-9 min-w-0 px-2 text-label-sm" onClick={() => { void saveThreshold(item); }}>Save</Button>
              </div>
            ) },
            { key: 'actions', label: 'Actions', render: (item) => (
              <div className="flex gap-1">
                <Button variant="secondary" disabled={item.stockCount === null} className="min-h-9 min-w-0 px-2 text-label-sm" onClick={() => openAdjustment(item)}>Adjust</Button>
                <Button variant="ghost" className="min-h-9 min-w-0 px-2 text-label-sm" onClick={() => { void openHistory(item); }}>History</Button>
              </div>
            ) },
          ] satisfies DataTableColumn<CatalogItemRecord>[]}
          mobileCards={() => null}
          empty={<p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">{items.length === 0 ? t('common.noData') : 'No items match these filters.'}</p>}
        />}
      </div>

      <section className="flex flex-col gap-3 lg:hidden">
        {loading ? <ListSkeleton label="Loading inventory" /> : visibleItems.map((item) => {
          const tracked = item.stockCount !== null;
          const threshold = item.lowStockThreshold ?? 5;
          const isLow = tracked && (item.stockCount ?? 0) <= threshold;
          return (
            <article key={item.id} className="rounded-2xl bg-surface-container-lowest p-4 shadow-card">
              <div className="flex min-w-0 items-start gap-3">
                <ItemLogo id={item.icon} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-body text-label-lg text-on-surface">{item.name}</h2>
                    <StatusTag status={!tracked ? 'open' : item.outOfStock ? 'voided' : isLow ? 'pending' : 'closed'}>
                      {!tracked ? 'Not tracked' : item.outOfStock ? '86 / out' : isLow ? 'Low stock' : `${item.stockCount} in stock`}
                    </StatusTag>
                  </div>
                  <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                    {categories.find((category) => category.id === item.categoryId)?.name ?? 'Uncategorized'}
                  </p>
                </div>
              </div>

              <div className="mt-4 flex min-h-12 items-center justify-between gap-3 rounded-xl bg-surface-container-low px-3">
                <span className="font-body text-label-md text-on-surface">Track stock</span>
                <label className="flex min-h-12 min-w-14 cursor-pointer items-center justify-end">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`Track stock for ${item.name}`}
                    checked={tracked}
                    onChange={(event) => { void updateTracking(item, event.target.checked); }}
                    className="h-6 w-6 accent-primary"
                  />
                </label>
              </div>
              {!tracked && <p className="mt-2 font-body text-body-sm text-outline">Stock is not counted and the item will not be automatically marked 86.</p>}

              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="font-body text-label-md text-on-surface">
                  {t('catalog.lowStockThreshold')}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={thresholds[item.id] ?? String(threshold)}
                    onChange={(event) => setThresholds((current) => ({ ...current, [item.id]: event.target.value }))}
                    className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary"
                  />
                </label>
                <Button variant="secondary" className="min-h-12 w-full sm:w-auto" onClick={() => { void saveThreshold(item); }}>
                  <MaterialIcon name="save" />Save threshold
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button disabled={!tracked} className="min-h-12 w-full" onClick={() => openAdjustment(item)}>
                  <MaterialIcon name="inventory" />Adjust stock
                </Button>
                <Button variant="secondary" className="min-h-12 w-full" onClick={() => { void openHistory(item); }}>
                  <MaterialIcon name="history" />Stock history
                </Button>
              </div>
            </article>
          );
        })}
        {!loading && !error && visibleItems.length === 0 && (
          <p className="rounded-xl bg-surface-container-lowest p-6 text-center font-body text-body-md text-outline">
            {items.length === 0 ? t('common.noData') : 'No items match these filters.'}
          </p>
        )}
      </section>

      <BottomSheet open={adjustTarget !== null} onClose={() => setAdjustTarget(null)} title={`Adjust ${adjustTarget?.name ?? 'stock'}`}>
        {adjustTarget && (
          <form onSubmit={(event) => { void submitAdjustment(event); }} className="flex flex-col gap-4">
            <p className="rounded-xl bg-surface-container-low p-3 font-body text-body-md text-on-surface">
              Current count: <strong className="tabular-nums">{adjustTarget.stockCount}</strong>
            </p>
            <label className="font-body text-label-md text-on-surface">
              Reason
              <select
                value={adjustmentReason}
                onChange={(event) => setAdjustmentReason(event.target.value as StockAdjustmentReason)}
                className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary"
              >
                {adjustmentReasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
              </select>
            </label>
            <label className="font-body text-label-md text-on-surface">
              {adjustmentReason === 'correction' ? 'New stock count' : 'Quantity'}
              <input
                type="number"
                min={adjustmentReason === 'correction' ? 0 : 1}
                step="1"
                inputMode="numeric"
                required
                autoFocus
                value={adjustmentAmount}
                onChange={(event) => setAdjustmentAmount(event.target.value)}
                placeholder={adjustmentReason === 'correction' ? String(adjustTarget.stockCount ?? 0) : 'Enter quantity'}
                className="mt-1 h-14 w-full rounded-lg bg-surface-container-low px-4 text-lg tabular-nums outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <p className="font-body text-body-sm text-on-surface-variant">
              {adjustmentReason === 'restock' ? 'Adds this quantity to current stock.' : adjustmentReason === 'waste' ? 'Removes this quantity from current stock.' : 'Replaces current stock with the corrected count.'}
            </p>
            {error && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{error}</p>}
            <Button type="submit" className="min-h-12 w-full"><MaterialIcon name="save" />Save adjustment</Button>
          </form>
        )}
      </BottomSheet>

      <BottomSheet open={historyItem !== null} onClose={() => setHistoryItem(null)} title={`${historyItem?.name ?? ''} stock history`}>
        {historyLoading ? (
          <p className="font-body text-body-sm text-on-surface-variant">Loading stock history…</p>
        ) : historyError ? (
          <p role="alert" className="font-body text-body-sm text-error-dark">{historyError}</p>
        ) : itemHistory.length > 0 ? (
          <ol className="flex flex-col gap-2">
            {itemHistory.map((record) => (
              <li key={record.id} className="rounded-xl bg-surface-container-low p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="font-body text-label-md text-on-surface">
                    {adjustmentReasons.find((reason) => reason.value === record.reason)?.label ?? 'Stock update'}
                  </strong>
                  <span className="font-body text-body-xs text-on-surface-variant">{new Date(record.changedAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 font-body text-body-sm text-on-surface-variant">By {record.changedBy}</p>
                <p className="mt-2 font-body text-body-sm text-on-surface">
                  From <strong className="tabular-nums">{historyCount(record.oldValue)}</strong> to <strong className="tabular-nums">{historyCount(record.newValue)}</strong>
                </p>
              </li>
            ))}
          </ol>
        ) : <p className="rounded-xl bg-surface-container-low p-4 font-body text-body-sm text-outline">No stock history yet.</p>}
      </BottomSheet>
    </WorkspaceLayout>
  );
}

export function OwnerInventoryScreen() {
  return <OwnerInventoryContent />;
}
