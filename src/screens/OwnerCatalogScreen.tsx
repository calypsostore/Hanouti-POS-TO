import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { DinarInput } from '../components/DinarInput';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { ItemLogo } from '../components/ItemLogo';
import { LogoPicker } from '../components/LogoPicker';
import { MaterialIcon } from '../components/MaterialIcon';
import { ListSkeleton } from '../components/ListSkeleton';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { CardGrid, PageHeader } from '../components/layout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { parseNonNegativeMillimes } from '../lib/millimes';
import { catalogService } from '../services/catalogService';
import { useAuthStore } from '../stores/authStore';
import { resolveStoreSettings, type CatalogItemRecord, type CatalogModifierRecord, type CategoryRecord, type ItemHistoryRecord, type QuickPickMode, type StoreRecord } from '../types/domain';
import { userService } from '../services/userService';
import { subscribeToStoreChanges } from '../data/repositories/realtimeRepository';
import { useFocusRefreshKey } from '../lib/useFocusRefreshKey';

type CatalogSheet = 'item' | 'category' | null;
type Availability = 'available' | '86' | 'out';
type StatusFilter = 'all' | Availability;
type ProductStateFilter = 'active' | 'archived';

interface ModifierOptionDraft {
  id: string;
  name: string;
  price: string;
}

interface ProductDraft {
  name: string;
  description: string;
  sku: string;
  price: string;
  categoryId: string;
  icon: string;
  stockCount: string;
  lowStockThreshold: string;
  availability: Availability;
  isActive: boolean;
  quickPick: boolean;
  modifierGroupName: string;
  modifiersRequired: boolean;
  modifierSelectionMode: 'single' | 'multiple';
  modifiers: ModifierOptionDraft[];
}

const emptyDraft = (categoryId = ''): ProductDraft => ({
  name: '',
  description: '',
  sku: '',
  price: '',
  categoryId,
  icon: 'espresso',
  stockCount: '',
  lowStockThreshold: '',
  availability: 'available',
  isActive: true,
  quickPick: false,
  modifierGroupName: '',
  modifiersRequired: false,
  modifierSelectionMode: 'multiple',
  modifiers: [],
});

function draftFromItem(item: CatalogItemRecord, isQuickPick: boolean): ProductDraft {
  return {
    name: item.name,
    description: item.description ?? '',
    sku: item.sku ?? '',
    price: '',
    categoryId: item.categoryId,
    icon: item.icon,
    stockCount: '',
    lowStockThreshold: '',
    availability: item.stockCount === 0 ? 'out' : item.outOfStock ? '86' : 'available',
    isActive: item.isActive,
    quickPick: isQuickPick,
    modifierGroupName: item.modifierGroupName ?? '',
    modifiersRequired: item.modifiersRequired ?? false,
    modifierSelectionMode: item.modifierSelectionMode ?? 'multiple',
    modifiers: (item.modifiers ?? []).map((modifier) => ({
      id: modifier.id,
      name: modifier.name,
      price: '',
    })),
  };
}

function getAvailability(item: CatalogItemRecord): Availability {
  if (item.stockCount === 0) return 'out';
  return item.outOfStock ? '86' : 'available';
}

function availabilityLabel(status: Availability) {
  if (status === 'out') return 'Out of stock';
  if (status === '86') return '86';
  return 'Available';
}

function availabilityStyle(status: Availability) {
  if (status === 'out') return 'bg-error-container text-on-error-container';
  if (status === '86') return 'bg-amber-100 text-amber-900';
  return 'bg-success-container text-success-dark';
}

function formatHistoryValue(record: ItemHistoryRecord, value: ItemHistoryRecord['oldValue']): string {
  if (record.field === 'price') return typeof value === 'number' ? `${formatTnd(value / 1000)} DT` : '—';
  if (record.field === 'stockTracking') return typeof value === 'number' ? `${value} in stock` : 'Not tracked';
  if (record.field === 'outOfStock') return value === true ? '86' : 'Available';
  return value === null ? '—' : String(value);
}

function historyFieldLabel(field: ItemHistoryRecord['field']): string {
  if (field === 'stockTracking') return 'Stock tracking';
  if (field === 'outOfStock') return '86 status';
  return field[0].toLocaleUpperCase() + field.slice(1);
}

function OwnerCatalogContent() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const refreshKey = useFocusRefreshKey();
  const catalogLoadSentinel = useRef<HTMLDivElement>(null);
  const [renderLimit, setRenderLimit] = useState(6);
  const [store, setStore] = useState<StoreRecord>();
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [items, setItems] = useState<CatalogItemRecord[]>([]);
  const [quickPickMode, setQuickPickMode] = useState<QuickPickMode>('auto');
  const [quickPickItemIds, setQuickPickItemIds] = useState<string[]>([]);
  const [savingQuickPicks, setSavingQuickPicks] = useState(false);
  const [quickPicksError, setQuickPicksError] = useState('');
  const [quickPicksNotice, setQuickPicksNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [categoryId, setCategoryId] = useState('all');
  const [productStateFilter, setProductStateFilter] = useState<ProductStateFilter>(() =>
    new URLSearchParams(window.location.search).get('state') === 'archived' ? 'archived' : 'active',
  );
  const [search, setSearch] = useState(() => new URLSearchParams(window.location.search).get('search') ?? '');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sheet, setSheet] = useState<CatalogSheet>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [logoPickerOpen, setLogoPickerOpen] = useState(false);
  const [categoryIcon, setCategoryIcon] = useState('');
  const [editingCategory, setEditingCategory] = useState<CategoryRecord | null>(null);
  const [editingItem, setEditingItem] = useState<CatalogItemRecord | null>(null);
  const [historyItem, setHistoryItem] = useState<CatalogItemRecord | null>(null);
  const [itemHistory, setItemHistory] = useState<ItemHistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CatalogItemRecord | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft());
  const [categoryName, setCategoryName] = useState('');
  const [categoryPosition, setCategoryPosition] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeCategories = categories.filter((category) => category.isActive);

  const refresh = useCallback(async () => {
    const [nextCategories, nextItems] = await Promise.all([
      catalogService.listCategories(storeId, true),
      catalogService.listItems(storeId, undefined, '', true),
    ]);
    setCategories(nextCategories);
    setItems(nextItems);
  }, [storeId]);

  useEffect(() => {
    setLoading(true);
    void refresh().catch((loadError: unknown) => {
      console.error('Unable to load the catalog.', loadError);
      setError(t('common.loadFailed'));
    }).finally(() => setLoading(false));
    void userService.getStore(storeId).then((nextStore) => {
      setStore(nextStore);
      const settings = resolveStoreSettings(nextStore?.settings);
      setQuickPickMode(settings.quickPickMode);
      setQuickPickItemIds(settings.quickPickItemIds);
    }).catch((loadError: unknown) => {
      console.error('Unable to load store information for the catalog.', loadError);
      setError(t('common.storeLoadFailed'));
    });
  }, [refresh, refreshKey, storeId]);

  useEffect(() => subscribeToStoreChanges(storeId, ['catalog_items', 'categories'], () => {
    void refresh().catch((loadError: unknown) => {
      console.error('Unable to refresh the catalog after a live update.', loadError);
      setError(t('common.refreshFailed'));
    });
  }), [refresh, storeId]);

  function openNewItem() {
    setError('');
    setDraft(emptyDraft(activeCategories[0]?.id ?? ''));
    setEditingItem(null);
    setSheet('item');
  }

  function openNewCategory() {
    setError('');
    setCategoryError('');
    setEditingCategory(null);
    setCategoryIcon('');
    setCategoryName('');
    setCategoryPosition('');
    setSheet('category');
  }

  function openEditCategory(category: CategoryRecord) {
    setCategoryError('');
    setEditingCategory(category);
    setCategoryName(category.name);
    setCategoryIcon(category.icon);
    setCategoryPosition('');
    setCategoryManagerOpen(false);
    setSheet('category');
  }

  function openEditItem(item: CatalogItemRecord) {
    setError('');
    setDraft(draftFromItem(item, quickPickItemIds.includes(item.id)));
    setEditingItem(item);
    setSheet('item');
  }

  async function openItemHistory(item: CatalogItemRecord) {
    setHistoryItem(item);
    setItemHistory([]);
    setHistoryError('');
    setHistoryLoading(true);
    try {
      setItemHistory(await catalogService.listItemHistory(item.id));
    } catch (loadError) {
      console.error('Unable to load product history.', loadError);
      setHistoryError('Unable to load product history. Please try again.');
    } finally {
      setHistoryLoading(false);
    }
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      if (!draft.categoryId || !activeCategories.some((category) => category.id === draft.categoryId)) {
        throw new Error('Choose a category for this product.');
      }
      if (!draft.price.trim()) throw new Error('Enter a product price.');
      const priceMillimes = parseNonNegativeMillimes(draft.price);
      if (priceMillimes === undefined) throw new Error('Enter a valid product price in TND with up to three decimal places.');

      const stockCount = draft.availability === 'out' ? 0 : draft.stockCount.trim() ? Number(draft.stockCount) : null;
      if (stockCount !== null && (!Number.isInteger(stockCount) || stockCount < 0)) throw new Error('Stock count must be a non-negative whole number.');
      const lowStockThreshold = Number(draft.lowStockThreshold);
      if (!draft.lowStockThreshold.trim() || !Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
        throw new Error('Low-stock threshold must be a non-negative whole number.');
      }

      const modifiers: CatalogModifierRecord[] = [];
      const names = new Set<string>();
      for (const modifier of draft.modifiers) {
        const name = modifier.name.trim();
        const rawPrice = modifier.price.trim();
        if (!name && !rawPrice) continue;
        if (!name) throw new Error('Give every modifier option a name.');
        if (!rawPrice) throw new Error('Enter a price for each modifier option.');
        const normalizedName = name.toLocaleLowerCase();
        if (names.has(normalizedName)) throw new Error('Modifier option names must be unique.');
        names.add(normalizedName);
        const modifierPriceMillimes = parseNonNegativeMillimes(rawPrice);
        if (modifierPriceMillimes === undefined) throw new Error('Enter a valid modifier price in TND with up to three decimal places.');
        modifiers.push({ id: modifier.id, name, priceMillimes: modifierPriceMillimes });
      }
      if (draft.modifiersRequired && modifiers.length === 0) throw new Error('Add at least one modifier option for a required group.');

      const changes = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        sku: draft.sku.trim(),
        categoryId: draft.categoryId,
        icon: draft.icon,
        priceMillimes,
        stockCount,
        lowStockThreshold,
        outOfStock: draft.availability !== 'available',
        isActive: draft.isActive,
        modifierGroupName: draft.modifierGroupName.trim(),
        modifiersRequired: draft.modifiersRequired,
        modifierSelectionMode: draft.modifierSelectionMode,
        modifiers,
      };
      if (!changes.name) throw new Error('Product name is required.');

      const savedItemId = editingItem?.id;
      if (quickPickMode === 'manual' &&
        (draft.isActive && draft.quickPick) !== quickPickItemIds.includes(savedItemId ?? '') &&
        !user) {
        throw new Error('Your account could not be loaded.');
      }

      let updatedItem: CatalogItemRecord;
      if (editingItem) {
        if (!user) throw new Error('Your account could not be loaded.');
        updatedItem = await catalogService.updateItem(editingItem.id, changes, { id: user.id, name: user.name });
      } else {
        updatedItem = await catalogService.createItem({ storeId, ...changes });
      }

      if (quickPickMode === 'manual') {
        const nextQuickPickItemIds = [...quickPickItemIds];
        if (draft.isActive && draft.quickPick && !nextQuickPickItemIds.includes(updatedItem.id)) {
          nextQuickPickItemIds.push(updatedItem.id);
        } else if ((!draft.isActive || !draft.quickPick) && nextQuickPickItemIds.includes(updatedItem.id)) {
          nextQuickPickItemIds.splice(nextQuickPickItemIds.indexOf(updatedItem.id), 1);
        }
        const quickPickSelectionChanged = nextQuickPickItemIds.length !== quickPickItemIds.length ||
          nextQuickPickItemIds.some((itemId, index) => itemId !== quickPickItemIds[index]);
        if (quickPickSelectionChanged) {
          try {
            if (!user) throw new Error('Your account could not be loaded.');
            const updatedStore = await userService.updateStoreSettings(storeId, user.id, {
              quickPickMode: 'manual',
              quickPickItemIds: nextQuickPickItemIds,
            });
            setStore(updatedStore);
            setQuickPickItemIds(nextQuickPickItemIds);
          } catch (quickPickSaveError) {
            console.error('Product saved, but its Quick Picks selection could not be updated.', quickPickSaveError);
            setQuickPicksError(`Product saved, but its Quick Picks selection could not be updated: ${quickPickSaveError instanceof Error ? quickPickSaveError.message : 'Please try again.'}`);
            setSheet(null);
            setEditingItem(null);
            void refresh().catch((loadError: unknown) => {
              console.error('Unable to refresh the catalog after saving a product.', loadError);
              setError(t('common.refreshFailed'));
            });
            return;
          }
        }
      }
      await refresh();
      setSheet(null);
      setEditingItem(null);
      setNotice(editingItem ? 'Product updated.' : 'Product added.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save this product.');
    }
  }

  async function saveCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setCategoryError('');
    setNotice('');
    try {
      const name = categoryName.trim();
      const position = Number(categoryPosition);
      if (!name) throw new Error('Category name is required.');
      if (!Number.isInteger(position) || position < 1) throw new Error('Position must be a positive whole number.');
      const sortOrder = position - 1;
      if (categories.some((category) => category.id !== editingCategory?.id && category.sortOrder === sortOrder)) {
        throw new Error('That position is already in use. Choose another position.');
      }
      if (editingCategory) {
        await catalogService.updateCategory(editingCategory.id, { name, icon: categoryIcon, sortOrder });
      } else {
        await catalogService.createCategory({ storeId, name, icon: categoryIcon, sortOrder, isActive: true });
      }
      await refresh();
      setCategoryName('');
      setCategoryIcon('');
      setEditingCategory(null);
      setSheet(null);
      setNotice(editingCategory ? 'Category updated.' : 'Category added.');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'Unable to save this category.';
      setCategoryError(message);
      setError(message);
    }
  }

  async function setCategoryActive(category: CategoryRecord, isActive: boolean) {
    setCategoryError('');
    setError('');
    setNotice('');
    try {
      const assignedItems = await catalogService.listItems(storeId, category.id, '', true);
      const assignedCount = assignedItems.length;
      if (!isActive && assignedCount > 0) {
        throw new Error(`Move all ${assignedCount} assigned product${assignedCount === 1 ? '' : 's'} to another category before archiving this category.`);
      }
      await catalogService.updateCategory(category.id, { isActive });
      if (!isActive && categoryId === category.id) setCategoryId('all');
      await refresh();
      setNotice(`Category ${isActive ? 'restored' : 'archived'}.`);
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'Unable to update this category.';
      setCategoryError(message);
      setError(message);
    }
  }

  async function toggleAvailability(item: CatalogItemRecord) {
    setError('');
    setNotice('');
    try {
      if (!user) throw new Error('Your account could not be loaded.');
      await catalogService.updateItem(item.id, {
        outOfStock: !item.outOfStock,
        stockCount: item.stockCount === 0 ? null : item.stockCount,
      }, { id: user.id, name: user.name });
      await refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update availability.');
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setError('');
    setNotice('');
    try {
      await catalogService.updateItem(deleteTarget.id, { isActive: false });
      await refresh();
      setNotice(`${deleteTarget.name} was removed from the catalog.`);
      setDeleteTarget(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Unable to remove this product.');
    }
  }

  async function restoreProduct(item: CatalogItemRecord) {
    setError('');
    setNotice('');
    try {
      await catalogService.updateItem(item.id, { isActive: true });
      await refresh();
      setNotice(`${item.name} was restored to the active catalog.`);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : 'Unable to restore this product.');
    }
  }

  async function saveQuickPicks() {
    setQuickPicksError('');
    setQuickPicksNotice('');
    if (!user || !store) {
      setQuickPicksError('Your store information could not be loaded.');
      return;
    }
    setSavingQuickPicks(true);
    try {
      const updatedStore = await userService.updateStoreSettings(storeId, user.id, {
        quickPickMode,
      });
      setStore(updatedStore);
      setQuickPickItemIds(resolveStoreSettings(updatedStore.settings).quickPickItemIds);
      setQuickPicksNotice('Quick Picks settings saved.');
    } catch (saveError) {
      console.error('Unable to save Quick Picks settings.', saveError);
      setQuickPicksError(saveError instanceof Error ? saveError.message : 'Unable to save Quick Picks settings.');
    } finally {
      setSavingQuickPicks(false);
    }
  }

  const visibleItems = items.filter((item) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesCategory = categoryId === 'all' || item.categoryId === categoryId;
    const matchesSearch = !query || [item.name, item.sku, item.description].some((value) => value?.toLocaleLowerCase().includes(query));
    const matchesStatus = statusFilter === 'all' || getAvailability(item) === statusFilter;
    const matchesProductState = item.isActive === (productStateFilter === 'active');
    return matchesProductState && matchesCategory && matchesSearch && matchesStatus;
  });

  useEffect(() => {
    setRenderLimit(6);
  }, [categoryId, search, statusFilter, productStateFilter]);

  useEffect(() => {
    const sentinel = catalogLoadSentinel.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setRenderLimit((current) => Math.min(current + 6, visibleItems.length));
      }
    }, { rootMargin: '300px 0px' });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleItems.length, loading]);

  return (
    <WorkspaceLayout title={t('catalog.title')} storeName={store?.name} links={ownerWorkspaceLinks} legacyAppearance>
      <PageHeader title={t('catalog.title')} subtitle="Manage products, categories, prices, and availability." actions={
        <>
          <Button variant="secondary" onClick={() => { setCategoryError(''); setCategoryManagerOpen(true); }}><MaterialIcon name="tune" className="text-lg" />Manage categories</Button>
          <Button variant="secondary" onClick={openNewCategory}><MaterialIcon name="create_new_folder" className="text-lg" />{t('catalog.addCategory')}</Button>
          <Button onClick={openNewItem}><MaterialIcon name="add" />{t('catalog.addItem')}</Button>
        </>
      } />

      <section aria-labelledby="quick-picks-settings-title" className="mb-5 rounded-2xl bg-surface-container-lowest p-3 shadow-card sm:p-4">
        <div className="mb-2">
          <h2 id="quick-picks-settings-title" className="font-display text-headline-sm text-on-surface">POS Quick Picks</h2>
          <p className="mt-1 font-body text-body-sm text-on-surface-variant">Automatic shows top sellers. Manual picks are selected per product.</p>
        </div>
        <fieldset>
          <legend className="sr-only">Quick Picks mode</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg bg-surface-container-low px-2 font-body text-body-sm">
              <input type="radio" name="quick-pick-mode" value="auto" checked={quickPickMode === 'auto'} onChange={() => { setQuickPickMode('auto'); setQuickPicksError(''); setQuickPicksNotice(''); }} className="h-4 w-4 accent-primary" />
              Automatic
            </label>
            <label className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg bg-surface-container-low px-2 font-body text-body-sm">
              <input type="radio" name="quick-pick-mode" value="manual" checked={quickPickMode === 'manual'} onChange={() => { setQuickPickMode('manual'); setQuickPicksError(''); setQuickPicksNotice(''); }} className="h-4 w-4 accent-primary" />
              Manual
            </label>
          </div>
        </fieldset>
        {quickPicksError && <p role="alert" className="mt-3 rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{quickPicksError}</p>}
        {quickPicksNotice && <p role="status" className="mt-3 rounded-lg bg-success-container p-3 font-body text-body-sm text-on-success-container">{quickPicksNotice}</p>}
        <Button
          type="button"
          className="mt-2"
          onClick={() => { void saveQuickPicks(); }}
          disabled={savingQuickPicks}
        >
          <MaterialIcon name={savingQuickPicks ? 'hourglass_top' : 'save'} />
          {savingQuickPicks ? 'Saving…' : 'Save Quick Picks'}
        </Button>
      </section>

      <div className="mb-4 flex flex-col gap-3">
        <label className="relative block">
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-outline" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, descriptions, or SKU" aria-label="Search products" className="h-12 w-full rounded-xl bg-surface-container-lowest pl-11 pr-4 font-body outline-none ring-1 ring-outline-variant focus:ring-2 focus:ring-primary" />
        </label>
        <div className="scrollbar-hidden flex gap-2 overflow-x-auto">
          <Chip compact selected={categoryId === 'all'} onClick={() => setCategoryId('all')}>{t('catalog.items')}</Chip>
          {activeCategories.map((category) => <Chip compact key={category.id} selected={categoryId === category.id} onClick={() => setCategoryId(category.id)}><ItemLogo id={category.icon} size="sm" />{category.name}</Chip>)}
        </div>
        <div className="scrollbar-hidden flex gap-2 overflow-x-auto">
          {(['active', 'archived'] as const).map((state) => {
            const count = items.filter((item) => item.isActive === (state === 'active')).length;
            return <Chip compact key={state} selected={productStateFilter === state} onClick={() => setProductStateFilter(state)}>{state === 'active' ? 'Active products' : 'Archived products'} · {count}</Chip>;
          })}
        </div>
        <div className="scrollbar-hidden flex gap-2 overflow-x-auto">
          {(['all', 'available', '86', 'out'] as const).map((status) => (
            <Chip compact key={status} selected={statusFilter === status} onClick={() => setStatusFilter(status)}>
              {status === 'all' ? 'All statuses' : availabilityLabel(status)}
            </Chip>
          ))}
          <span className="ml-auto self-center whitespace-nowrap font-body text-body-sm text-outline">{visibleItems.length} {visibleItems.length === 1 ? 'product' : 'products'}</span>
        </div>
      </div>

      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mb-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      {loading ? <ListSkeleton label="Loading catalog" /> : visibleItems.length > 0 ? (
        <>
          <CardGrid className="mobile-gap-3">
            {visibleItems.slice(0, renderLimit).map((item) => (
              <CatalogItemCard
                key={item.id}
                item={item}
                category={categories.find((value) => value.id === item.categoryId)}
                onToggle={() => { void toggleAvailability(item); }}
                onEdit={() => openEditItem(item)}
                onDelete={() => setDeleteTarget(item)}
                onRestore={() => { void restoreProduct(item); }}
              />
            ))}
          </CardGrid>
          {renderLimit < visibleItems.length && (
            <div ref={catalogLoadSentinel} className="h-1" aria-hidden="true" />
          )}
        </>
      ) : (
        <section className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-outline-variant bg-surface-container-lowest p-8 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-surface-container text-primary"><MaterialIcon name={search || categoryId !== 'all' || statusFilter !== 'all' ? 'search_off' : 'inventory_2'} className="text-2xl" /></span>
          <h2 className="font-display text-headline-sm text-on-surface">{search || categoryId !== 'all' || statusFilter !== 'all' ? 'No matching products' : productStateFilter === 'archived' ? 'No archived products' : 'Your catalog is empty'}</h2>
          <p className="mt-1 max-w-sm font-body text-body-sm text-on-surface-variant">
            {activeCategories.length === 0 ? 'Create or restore a category first, then add products to organize your menu.' : search || categoryId !== 'all' || statusFilter !== 'all' ? 'Try another search or clear the selected filters.' : productStateFilter === 'archived' ? 'Products you remove from the active catalog will appear here and can be restored.' : 'Add your first product to start building your menu.'}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {activeCategories.length === 0 && <Button variant="secondary" onClick={openNewCategory}><MaterialIcon name="create_new_folder" />{t('catalog.addCategory')}</Button>}
            {activeCategories.length > 0 && productStateFilter === 'active' && !search && categoryId === 'all' && statusFilter === 'all' && <Button onClick={openNewItem}><MaterialIcon name="add" />{t('catalog.addItem')}</Button>}
            {(search || categoryId !== 'all' || statusFilter !== 'all') && <Button variant="secondary" onClick={() => { setSearch(''); setCategoryId('all'); setStatusFilter('all'); }}>Clear filters</Button>}
          </div>
        </section>
      )}

      <BottomSheet open={sheet === 'item'} onClose={() => setSheet(null)} title={editingItem ? 'Edit product' : t('catalog.addItem')}>
        <form onSubmit={saveItem} className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <ItemLogo id={draft.icon} size="lg" />
            <Button type="button" variant="secondary" onClick={() => setLogoPickerOpen(true)}>
              <MaterialIcon name="palette" />{t('logo.chooseProduct')}
            </Button>
          </div>
          {editingItem && (
            <Button variant="secondary" className="self-start" onClick={() => { void openItemHistory(editingItem); }}>
              <MaterialIcon name="history" />History
            </Button>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="font-body text-label-md">Product name<input required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
            <label className="font-body text-label-md">{t('catalog.priceMillimes')}<DinarInput required value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /><span className="mt-1 block text-body-sm text-outline">Enter the price in TND, for example 50.000.</span></label>
            <label className="font-body text-label-md">SKU / barcode<input value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
            <label className="font-body text-label-md">Category<select required value={draft.categoryId} onChange={(event) => setDraft((current) => ({ ...current, categoryId: event.target.value }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary"><option value="">Select a category</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="font-body text-label-md">Stock count <span className="text-outline">(leave blank for untracked)</span><input type="number" min="0" step="1" required={Boolean(editingItem && editingItem.stockCount !== null && draft.availability !== 'out')} value={draft.stockCount} onChange={(event) => setDraft((current) => ({ ...current, stockCount: event.target.value, availability: event.target.value === '0' ? 'out' : current.availability === 'out' ? 'available' : current.availability }))} placeholder="Not tracked" className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
            <label className="font-body text-label-md">{t('catalog.lowStockThreshold')}<input type="number" min="0" step="1" required value={draft.lowStockThreshold} onChange={(event) => setDraft((current) => ({ ...current, lowStockThreshold: event.target.value }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          </div>
          <label className="font-body text-label-md">Description<textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="mt-1 w-full rounded-lg bg-surface-container-low px-3 py-2 outline-none focus:ring-2 focus:ring-primary" /></label>

          <fieldset>
            <legend className="font-body text-label-md">Availability</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['available', '86', 'out'] as const).map((status) => (
                <button key={status} type="button" aria-pressed={draft.availability === status} onClick={() => setDraft((current) => ({ ...current, availability: status }))} className={`min-h-11 rounded-lg px-2 font-body text-label-md ${draft.availability === status ? availabilityStyle(status) + ' ring-2 ring-primary' : 'bg-surface-container text-on-surface-variant'}`}>{availabilityLabel(status)}</button>
              ))}
            </div>
          </fieldset>

          <fieldset className="rounded-xl border border-outline-variant p-3">
            <legend className="px-1 font-body text-label-lg text-on-surface">Options & modifiers</legend>
            <label className="block font-body text-label-md">Modifier group name<input value={draft.modifierGroupName} onChange={(event) => setDraft((current) => ({ ...current, modifierGroupName: event.target.value }))} placeholder="e.g. Coffee extras" className="mt-1 h-11 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
            <div className="mt-3 flex flex-wrap gap-3">
              <label className="flex min-h-10 items-center gap-2 font-body text-body-sm"><input type="checkbox" checked={draft.modifiersRequired} onChange={(event) => setDraft((current) => ({ ...current, modifiersRequired: event.target.checked }))} className="h-4 w-4 accent-primary" />Selection required</label>
              <label className="flex items-center gap-2 font-body text-body-sm">Selection
                <select value={draft.modifierSelectionMode} onChange={(event) => setDraft((current) => ({ ...current, modifierSelectionMode: event.target.value === 'single' ? 'single' : 'multiple' }))} className="h-10 rounded-lg bg-surface-container-low px-2 outline-none focus:ring-2 focus:ring-primary">
                  <option value="single">Choose one</option><option value="multiple">Choose multiple</option>
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {draft.modifiers.map((modifier, index) => (
                <div key={modifier.id} className="flex items-center gap-2">
                  <label className="sr-only" htmlFor={`modifier-name-${modifier.id}`}>Option name</label>
                  <input id={`modifier-name-${modifier.id}`} value={modifier.name} onChange={(event) => setDraft((current) => ({ ...current, modifiers: current.modifiers.map((option, optionIndex) => optionIndex === index ? { ...option, name: event.target.value } : option) }))} placeholder="Option name" className="h-11 min-w-0 flex-1 rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" />
                  <label className="sr-only" htmlFor={`modifier-price-${modifier.id}`}>Option price in TND</label>
                  <div className="relative w-40 shrink-0"><DinarInput id={`modifier-price-${modifier.id}`} value={modifier.price} onChange={(event) => setDraft((current) => ({ ...current, modifiers: current.modifiers.map((option, optionIndex) => optionIndex === index ? { ...option, price: event.target.value } : option) }))} className="h-11 w-full rounded-lg bg-surface-container-low px-3 pr-16 text-right outline-none focus:ring-2 focus:ring-primary" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-body-sm text-outline">TND</span></div>
                  <button type="button" aria-label={`Remove ${modifier.name || 'modifier option'}`} onClick={() => setDraft((current) => ({ ...current, modifiers: current.modifiers.filter((_, optionIndex) => optionIndex !== index) }))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-error-dark hover:bg-error-container"><MaterialIcon name="delete" /></button>
                </div>
              ))}
              <Button type="button" variant="secondary" className="self-start" onClick={() => setDraft((current) => ({ ...current, modifiers: [...current.modifiers, { id: crypto.randomUUID(), name: '', price: '' }] }))}><MaterialIcon name="add" />Add option</Button>
            </div>
            <p className="mt-2 font-body text-body-sm text-outline">Enter each option add-on in TND, for example 0.250.</p>
          </fieldset>

          <label className="flex items-center gap-2 font-body text-label-md"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 accent-primary" />Product is active in the POS</label>
          {quickPickMode === 'manual' && (
            <div>
              <label className={`flex items-center gap-2 font-body text-label-md ${draft.isActive ? '' : 'text-outline'}`}>
                <input type="checkbox" checked={draft.quickPick} disabled={!draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, quickPick: event.target.checked }))} className="h-4 w-4 accent-primary" />
                Show in POS Quick Picks
              </label>
              {!draft.isActive && <p className="ml-6 mt-1 font-body text-body-sm text-outline">Activate this product in the POS to include it in Quick Picks.</p>}
            </div>
          )}
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit">{editingItem ? 'Save changes' : t('catalog.save')}</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={historyItem !== null} onClose={() => setHistoryItem(null)} title={`${historyItem?.name ?? ''} history`}>
        {historyLoading ? (
          <p className="font-body text-body-sm text-on-surface-variant">Loading history…</p>
        ) : historyError ? (
          <p role="alert" className="font-body text-body-sm text-error-dark">{historyError}</p>
        ) : itemHistory.length > 0 ? (
          <ol className="flex flex-col gap-3">
            {itemHistory.map((record) => (
              <li key={record.id} className="rounded-lg bg-surface-container-low p-3 font-body text-body-sm">
                <p className="font-body text-label-md text-on-surface">{historyFieldLabel(record.field)}</p>
                <p className="mt-1 text-on-surface-variant">{record.changedBy} · {new Date(record.changedAt).toLocaleString()}</p>
                <p className="mt-2 text-on-surface-variant">From <span className="font-medium text-on-surface">{formatHistoryValue(record, record.oldValue)}</span> to <span className="font-medium text-on-surface">{formatHistoryValue(record, record.newValue)}</span></p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="font-body text-body-sm text-on-surface-variant">No changes recorded yet.</p>
        )}
      </BottomSheet>

      <BottomSheet open={sheet === 'category'} onClose={() => setSheet(null)} title={editingCategory ? 'Edit category' : t('catalog.addCategory')}>
        <form onSubmit={saveCategory} className="flex flex-col gap-3">
          <label className="font-body text-label-md">{t('common.name')}<input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          <label className="font-body text-label-md">Position (1 is first)<input type="number" min="1" step="1" required value={categoryPosition} onChange={(event) => setCategoryPosition(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          <div className="flex items-center gap-3">
            <ItemLogo id={categoryIcon} size="md" />
            <Button type="button" variant="secondary" onClick={() => setLogoPickerOpen(true)}>
              <MaterialIcon name="palette" />{t('logo.chooseCategory')}
            </Button>
            <span className="font-body text-body-sm text-outline">{categoryIcon ? t('logo.selected') : t('logo.noLogo')}</span>
          </div>
          {categoryError && <p role="alert" className="font-body text-body-sm text-error-dark">{categoryError}</p>}
          <Button type="submit">{editingCategory ? 'Save category' : t('common.save')}</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={categoryManagerOpen} onClose={() => setCategoryManagerOpen(false)} title="Manage categories" panelClassName="max-h-[85dvh] overflow-y-auto">
        <div className="flex flex-col gap-3">
          <p className="font-body text-body-sm text-on-surface-variant">Edit category details, control their order, and archive categories that no longer have products assigned.</p>
          {categoryError && <p role="alert" className="rounded-lg bg-error-container p-3 font-body text-body-sm text-on-error-container">{categoryError}</p>}
          {categories.length === 0 ? (
            <p className="rounded-lg bg-surface-container-low p-3 font-body text-body-sm text-on-surface-variant">No categories yet. Add one to organize your products.</p>
          ) : categories.map((category) => {
            const assignedCount = items.filter((item) => item.categoryId === category.id).length;
            return (
              <article key={category.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-container-low p-3">
                <ItemLogo id={category.icon} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-body text-label-lg text-on-surface">{category.name}</p>
                  <p className="font-body text-body-sm text-on-surface-variant">Position {category.sortOrder + 1} · {assignedCount} assigned {assignedCount === 1 ? 'product' : 'products'} · {category.isActive ? 'Active' : 'Archived'}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" className="min-h-10 px-3" onClick={() => openEditCategory(category)}><MaterialIcon name="edit" className="text-lg" />Edit</Button>
                  {category.isActive ? (
                    <Button variant="ghost" className="min-h-10 px-3 text-error-dark" onClick={() => { void setCategoryActive(category, false); }}><MaterialIcon name="archive" className="text-lg" />Archive</Button>
                  ) : (
                    <Button variant="secondary" className="min-h-10 px-3" onClick={() => { void setCategoryActive(category, true); }}><MaterialIcon name="unarchive" className="text-lg" />Restore</Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </BottomSheet>

      <LogoPicker
        open={logoPickerOpen}
        value={sheet === 'category' ? categoryIcon : draft.icon}
        onChange={(icon) => {
          if (sheet === 'category') setCategoryIcon(icon);
          else setDraft((current) => ({ ...current, icon }));
        }}
        onClose={() => setLogoPickerOpen(false)}
      />

      <BottomSheet open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} title="Remove product">
        <div className="flex flex-col gap-3">
          <p className="font-body text-body-md text-on-surface-variant">Remove <strong className="text-on-surface">{deleteTarget?.name}</strong> from the active catalog? Past orders will remain unchanged.</p>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="danger" onClick={() => { void confirmDelete(); }}>Remove product</Button></div>
        </div>
      </BottomSheet>
    </WorkspaceLayout>
  );
}

function CatalogItemCard({ item, category, onToggle, onEdit, onDelete, onRestore }: { item: CatalogItemRecord; category?: CategoryRecord; onToggle: () => void; onEdit: () => void; onDelete: () => void; onRestore: () => void }) {
  const availability = getAvailability(item);
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
      <div className="flex min-w-0 items-start gap-3">
        <ItemLogo id={item.icon} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-body text-label-lg text-on-surface">{item.name}</p>
            <span className={`rounded-full px-2 py-0.5 font-body text-label-sm ${availabilityStyle(availability)}`}>{availabilityLabel(availability)}</span>
            {!item.isActive && <span className="rounded-full bg-surface-container px-2 py-0.5 font-body text-label-sm text-on-surface-variant">Archived</span>}
          </div>
          <p className="mt-1 font-body text-body-sm text-outline">{category?.name ?? 'Uncategorized'} · <span className="tabular-nums">{formatTnd(item.priceMillimes / 1000)} DT</span></p>
          {item.sku && <p className="mt-1 truncate font-body text-body-sm text-outline">SKU: {item.sku}</p>}
          {item.description && <p className="mt-1 truncate font-body text-body-sm text-on-surface-variant">{item.description}</p>}
          {item.stockCount !== null && <p className="mt-1 font-body text-body-sm text-outline">{item.stockCount} in stock</p>}
          {item.stockCount !== null && <p className="mt-1 font-body text-body-sm text-outline">Low stock at {item.lowStockThreshold ?? 5}</p>}
          {(item.modifiers?.length ?? 0) > 0 && <p className="mt-1 font-body text-body-sm text-outline">{item.modifierGroupName || 'Options'} · {item.modifiers?.length} options</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-outline-variant pt-3">
        <Button variant="secondary" className="min-h-10 flex-1 px-3" onClick={onEdit}><MaterialIcon name="edit" className="text-lg" />Edit</Button>
        {item.isActive ? (
          <>
            <Button variant="secondary" className="min-h-10 px-3" aria-label={`${availability === 'available' ? 'Mark 86' : 'Mark available'}: ${item.name}`} onClick={onToggle}><MaterialIcon name={availability === 'available' ? 'block' : 'check'} className="text-lg" />{availability === 'available' ? '86' : 'Available'}</Button>
            <Button variant="ghost" className="min-h-10 px-3 text-error-dark" aria-label={`Remove ${item.name}`} onClick={onDelete}><MaterialIcon name="archive" className="text-lg" />Archive</Button>
          </>
        ) : (
          <Button variant="secondary" className="min-h-10 flex-1 px-3" onClick={onRestore}><MaterialIcon name="unarchive" className="text-lg" />Restore product</Button>
        )}
      </div>
    </article>
  );
}

export function OwnerCatalogScreen() {
  return <OwnerCatalogContent />;
}
