import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { Button } from '../components/Button';
import { Chip } from '../components/Chip';
import { MaterialIcon } from '../components/MaterialIcon';
import { WorkspaceLayout } from '../components/WorkspaceLayout';
import { ownerWorkspaceLinks } from '../app/navigation';
import { t } from '../i18n/translations';
import { formatTnd } from '../lib/format';
import { catalogService } from '../services/catalogService';
import { useAuthStore } from '../stores/authStore';
import type { CatalogItemRecord, CatalogModifierRecord, CategoryRecord, StoreRecord } from '../types/domain';
import { userService } from '../services/userService';

type CatalogSheet = 'item' | 'category' | null;
type Availability = 'available' | '86' | 'out';
type StatusFilter = 'all' | Availability;

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
  availability: Availability;
  isActive: boolean;
  imageDataUrl: string;
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
  icon: 'local_cafe',
  stockCount: '',
  availability: 'available',
  isActive: true,
  imageDataUrl: '',
  modifierGroupName: '',
  modifiersRequired: false,
  modifierSelectionMode: 'multiple',
  modifiers: [],
});

function draftFromItem(item: CatalogItemRecord): ProductDraft {
  return {
    name: item.name,
    description: item.description ?? '',
    sku: item.sku ?? '',
    price: String(item.priceMillimes / 1000),
    categoryId: item.categoryId,
    icon: item.icon,
    stockCount: item.stockCount === null ? '' : String(item.stockCount),
    availability: item.stockCount === 0 ? 'out' : item.outOfStock ? '86' : 'available',
    isActive: item.isActive,
    imageDataUrl: item.imageDataUrl ?? '',
    modifierGroupName: item.modifierGroupName ?? '',
    modifiersRequired: item.modifiersRequired ?? false,
    modifierSelectionMode: item.modifierSelectionMode ?? 'multiple',
    modifiers: (item.modifiers ?? []).map((modifier) => ({
      id: modifier.id,
      name: modifier.name,
      price: String(modifier.priceMillimes / 1000),
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

async function readProductImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 10 * 1024 * 1024) throw new Error('Choose an image smaller than 10 MB.');

  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read this image.'));
    reader.onerror = () => reject(new Error('Unable to read this image.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const loadedImage = new Image();
    loadedImage.onload = () => resolve(loadedImage);
    loadedImage.onerror = () => reject(new Error('Unable to preview this image.'));
    loadedImage.src = source;
  });

  const scale = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to process this image.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

function OwnerCatalogContent() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const [store, setStore] = useState<StoreRecord>();
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [items, setItems] = useState<CatalogItemRecord[]>([]);
  const [categoryId, setCategoryId] = useState('all');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sheet, setSheet] = useState<CatalogSheet>(null);
  const [editingItem, setEditingItem] = useState<CatalogItemRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogItemRecord | null>(null);
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft());
  const [categoryName, setCategoryName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const [nextCategories, nextItems] = await Promise.all([catalogService.listCategories(storeId), catalogService.listItems(storeId)]);
    setCategories(nextCategories);
    setItems(nextItems);
  }, [storeId]);

  useEffect(() => {
    void refresh().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : t('common.loadFailed')));
    void userService.getStore(storeId).then(setStore).catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : t('common.storeLoadFailed')));
  }, [refresh, storeId]);

  function openNewItem() {
    setError('');
    setDraft(emptyDraft(categories[0]?.id ?? ''));
    setEditingItem(null);
    setSheet('item');
  }

  function openEditItem(item: CatalogItemRecord) {
    setError('');
    setDraft(draftFromItem(item));
    setEditingItem(item);
    setSheet('item');
  }

  async function saveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      if (!draft.categoryId || !categories.some((category) => category.id === draft.categoryId)) {
        throw new Error('Choose a category for this product.');
      }
      if (!draft.price.trim()) throw new Error('Enter a product price.');
      const price = Number(draft.price.trim().replace(',', '.'));
      const priceMillimes = Math.round(price * 1000);
      if (!Number.isFinite(price) || price < 0 || !Number.isSafeInteger(priceMillimes)) throw new Error('Enter a valid non-negative TND price.');

      const stockCount = draft.availability === 'out' ? 0 : draft.stockCount.trim() ? Number(draft.stockCount) : null;
      if (stockCount !== null && (!Number.isInteger(stockCount) || stockCount < 0)) throw new Error('Stock count must be a non-negative whole number.');

      const modifiers: CatalogModifierRecord[] = [];
      const names = new Set<string>();
      for (const modifier of draft.modifiers) {
        const name = modifier.name.trim();
        const rawPrice = modifier.price.trim().replace(',', '.');
        if (!name && !rawPrice) continue;
        if (!name) throw new Error('Give every modifier option a name.');
        const normalizedName = name.toLocaleLowerCase();
        if (names.has(normalizedName)) throw new Error('Modifier option names must be unique.');
        names.add(normalizedName);
        const amount = rawPrice ? Number(rawPrice) : 0;
        const modifierPriceMillimes = Math.round(amount * 1000);
        if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(modifierPriceMillimes)) throw new Error('Enter a valid non-negative modifier price.');
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
        outOfStock: draft.availability !== 'available',
        isActive: draft.isActive,
        imageDataUrl: draft.imageDataUrl,
        modifierGroupName: draft.modifierGroupName.trim(),
        modifiersRequired: draft.modifiersRequired,
        modifierSelectionMode: draft.modifierSelectionMode,
        modifiers,
      };
      if (!changes.name) throw new Error('Product name is required.');

      if (editingItem) {
        await catalogService.updateItem(editingItem.id, changes);
      } else {
        await catalogService.createItem({ storeId, ...changes });
      }
      await refresh();
      setSheet(null);
      setEditingItem(null);
      setNotice(editingItem ? 'Product updated.' : 'Product added.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save this product.');
    }
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const category: Omit<CategoryRecord, 'id'> = {
        storeId,
        name: categoryName,
        icon: 'category',
        sortOrder: categories.length,
        isActive: true,
      };
      const created = await catalogService.createCategory(category);
      await refresh();
      setCategoryName('');
      setSheet(null);
      setCategoryId(created.id);
      setNotice('Category added.');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to add this category.');
    }
  }

  async function toggleAvailability(item: CatalogItemRecord) {
    setError('');
    setNotice('');
    try {
      await catalogService.updateItem(item.id, {
        outOfStock: !item.outOfStock,
        stockCount: item.stockCount === 0 ? null : item.stockCount,
      });
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

  async function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    try {
      const imageDataUrl = await readProductImage(file);
      setDraft((current) => ({ ...current, imageDataUrl }));
    } catch (imageError) {
      setError(imageError instanceof Error ? imageError.message : 'Unable to upload this image.');
    }
  }

  const visibleItems = items.filter((item) => {
    const query = search.trim().toLocaleLowerCase();
    const matchesCategory = categoryId === 'all' || item.categoryId === categoryId;
    const matchesSearch = !query || [item.name, item.sku, item.description].some((value) => value?.toLocaleLowerCase().includes(query));
    const matchesStatus = statusFilter === 'all' || getAvailability(item) === statusFilter;
    return matchesCategory && matchesSearch && matchesStatus;
  });

  return (
    <WorkspaceLayout title={t('catalog.title')} storeName={store?.name} links={ownerWorkspaceLinks}>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">{t('catalog.title')}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">Manage products, categories, prices, and availability.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setError(''); setSheet('category'); }}><MaterialIcon name="create_new_folder" className="text-lg" />{t('catalog.addCategory')}</Button>
          <Button onClick={openNewItem}><MaterialIcon name="add" />{t('catalog.addItem')}</Button>
        </div>
      </header>

      <div className="mb-4 flex flex-col gap-3">
        <label className="relative block">
          <MaterialIcon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xl text-outline" />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products, descriptions, or SKU" aria-label="Search products" className="h-12 w-full rounded-xl bg-surface-container-lowest pl-11 pr-4 font-body outline-none ring-1 ring-outline-variant focus:ring-2 focus:ring-primary" />
        </label>
        <div className="scrollbar-hidden flex gap-2 overflow-x-auto py-1">
          <Chip selected={categoryId === 'all'} onClick={() => setCategoryId('all')}>{t('catalog.items')}</Chip>
          {categories.map((category) => <Chip key={category.id} selected={categoryId === category.id} onClick={() => setCategoryId(category.id)}>{category.name}</Chip>)}
        </div>
        <div className="scrollbar-hidden flex gap-2 overflow-x-auto py-1">
          {(['all', 'available', '86', 'out'] as const).map((status) => (
            <Chip key={status} selected={statusFilter === status} onClick={() => setStatusFilter(status)}>
              {status === 'all' ? 'All statuses' : availabilityLabel(status)}
            </Chip>
          ))}
          <span className="ml-auto self-center whitespace-nowrap font-body text-body-sm text-outline">{visibleItems.length} {visibleItems.length === 1 ? 'product' : 'products'}</span>
        </div>
      </div>

      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mb-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      {visibleItems.length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((item) => (
            <CatalogItemCard
              key={item.id}
              item={item}
              category={categories.find((value) => value.id === item.categoryId)}
              onToggle={() => { void toggleAvailability(item); }}
              onEdit={() => openEditItem(item)}
              onDelete={() => setDeleteTarget(item)}
            />
          ))}
        </section>
      ) : (
        <section className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-outline-variant bg-surface-container-lowest p-8 text-center">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-surface-container text-primary"><MaterialIcon name={search || categoryId !== 'all' || statusFilter !== 'all' ? 'search_off' : 'inventory_2'} className="text-2xl" /></span>
          <h2 className="font-display text-headline-sm text-on-surface">{search || categoryId !== 'all' || statusFilter !== 'all' ? 'No matching products' : 'Your catalog is empty'}</h2>
          <p className="mt-1 max-w-sm font-body text-body-sm text-on-surface-variant">
            {categories.length === 0 ? 'Create a category first, then add products to organize your menu.' : search || categoryId !== 'all' || statusFilter !== 'all' ? 'Try another search or clear the selected filters.' : 'Add your first product to start building your menu.'}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {categories.length === 0 && <Button variant="secondary" onClick={() => setSheet('category')}><MaterialIcon name="create_new_folder" />{t('catalog.addCategory')}</Button>}
            {categories.length > 0 && !search && categoryId === 'all' && statusFilter === 'all' && <Button onClick={openNewItem}><MaterialIcon name="add" />{t('catalog.addItem')}</Button>}
            {(search || categoryId !== 'all' || statusFilter !== 'all') && <Button variant="secondary" onClick={() => { setSearch(''); setCategoryId('all'); setStatusFilter('all'); }}>Clear filters</Button>}
          </div>
        </section>
      )}

      <BottomSheet open={sheet === 'item'} onClose={() => setSheet(null)} title={editingItem ? 'Edit product' : t('catalog.addItem')}>
        <form onSubmit={saveItem} className="flex flex-col gap-4">
          <div>
            <span className="font-body text-label-md">Product image</span>
            <div className="mt-2 flex items-center gap-3">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-container text-primary">
                {draft.imageDataUrl ? <img src={draft.imageDataUrl} alt="Product preview" className="h-full w-full object-cover" /> : <MaterialIcon name={draft.icon || 'image'} className="text-3xl" />}
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg bg-surface-container-high px-3 font-body text-label-md text-primary">
                  <MaterialIcon name="upload" />Upload image
                  <input type="file" accept="image/*" onChange={(event) => { void selectImage(event); }} className="sr-only" />
                </label>
                {draft.imageDataUrl && <Button type="button" variant="ghost" onClick={() => setDraft((current) => ({ ...current, imageDataUrl: '' }))}>Remove</Button>}
                <p className="basis-full font-body text-body-sm text-outline">Image is resized and stored on this device.</p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="font-body text-label-md">Product name<input required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
            <label className="font-body text-label-md">{t('catalog.priceTnd')}<input required inputMode="decimal" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
            <label className="font-body text-label-md">SKU / barcode<input value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
            <label className="font-body text-label-md">Category<select required value={draft.categoryId} onChange={(event) => setDraft((current) => ({ ...current, categoryId: event.target.value }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary"><option value="">Select a category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
            <label className="font-body text-label-md">Product icon<select value={draft.icon} onChange={(event) => setDraft((current) => ({ ...current, icon: event.target.value }))} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary">{Array.from(new Set(['local_cafe', 'coffee', 'bakery_dining', 'water_drop', ...categories.map((category) => category.icon), draft.icon])).map((icon) => <option key={icon} value={icon}>{icon}</option>)}</select></label>
            <label className="font-body text-label-md">Stock count <span className="text-outline">(leave blank for untracked)</span><input type="number" min="0" step="1" value={draft.availability === 'out' ? '0' : draft.stockCount} onChange={(event) => setDraft((current) => ({ ...current, stockCount: event.target.value, availability: event.target.value === '0' ? 'out' : current.availability === 'out' ? 'available' : current.availability }))} placeholder="Not tracked" className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          </div>
          <label className="font-body text-label-md">Description<textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} rows={3} className="mt-1 w-full rounded-lg bg-surface-container-low px-3 py-2 outline-none focus:ring-2 focus:ring-primary" /></label>

          <fieldset>
            <legend className="font-body text-label-md">Availability</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['available', '86', 'out'] as const).map((status) => (
                <button key={status} type="button" aria-pressed={draft.availability === status} onClick={() => setDraft((current) => ({ ...current, availability: status, stockCount: status === 'out' ? '0' : current.stockCount === '0' ? '' : current.stockCount }))} className={`min-h-11 rounded-lg px-2 font-body text-label-md ${draft.availability === status ? availabilityStyle(status) + ' ring-2 ring-primary' : 'bg-surface-container text-on-surface-variant'}`}>{availabilityLabel(status)}</button>
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
                  <div className="relative w-32 shrink-0"><input id={`modifier-price-${modifier.id}`} inputMode="decimal" value={modifier.price} onChange={(event) => setDraft((current) => ({ ...current, modifiers: current.modifiers.map((option, optionIndex) => optionIndex === index ? { ...option, price: event.target.value } : option) }))} placeholder="0.000" className="h-11 w-full rounded-lg bg-surface-container-low px-3 pr-10 text-right outline-none focus:ring-2 focus:ring-primary" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-body-sm text-outline">TND</span></div>
                  <button type="button" aria-label={`Remove ${modifier.name || 'modifier option'}`} onClick={() => setDraft((current) => ({ ...current, modifiers: current.modifiers.filter((_, optionIndex) => optionIndex !== index) }))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-error-dark hover:bg-error-container"><MaterialIcon name="delete" /></button>
                </div>
              ))}
              <Button type="button" variant="secondary" className="self-start" onClick={() => setDraft((current) => ({ ...current, modifiers: [...current.modifiers, { id: crypto.randomUUID(), name: '', price: '' }] }))}><MaterialIcon name="add" />Add option</Button>
            </div>
            <p className="mt-2 font-body text-body-sm text-outline">Each option can have its own TND add-on price.</p>
          </fieldset>

          <label className="flex items-center gap-2 font-body text-label-md"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} className="h-4 w-4 accent-primary" />Product is active in the POS</label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit">{editingItem ? 'Save changes' : t('catalog.save')}</Button>
        </form>
      </BottomSheet>

      <BottomSheet open={sheet === 'category'} onClose={() => setSheet(null)} title={t('catalog.addCategory')}>
        <form onSubmit={addCategory} className="flex flex-col gap-3">
          <label className="font-body text-label-md">{t('common.name')}<input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit">{t('common.save')}</Button>
        </form>
      </BottomSheet>

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

function CatalogItemCard({ item, category, onToggle, onEdit, onDelete }: { item: CatalogItemRecord; category?: CategoryRecord; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const availability = getAvailability(item);
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-container text-primary">
          {item.imageDataUrl ? <img src={item.imageDataUrl} alt="" className="h-full w-full object-cover" /> : <MaterialIcon name={item.icon} className="text-2xl" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-body text-label-lg text-on-surface">{item.name}</p>
            <span className={`rounded-full px-2 py-0.5 font-body text-label-sm ${availabilityStyle(availability)}`}>{availabilityLabel(availability)}</span>
          </div>
          <p className="mt-1 font-body text-body-sm text-outline">{category?.name ?? 'Uncategorized'} · <span className="tabular-nums">{formatTnd(item.priceMillimes / 1000)} DT</span></p>
          {item.sku && <p className="mt-1 truncate font-body text-body-sm text-outline">SKU: {item.sku}</p>}
          {item.description && <p className="mt-1 truncate font-body text-body-sm text-on-surface-variant">{item.description}</p>}
          {item.stockCount !== null && <p className="mt-1 font-body text-body-sm text-outline">{item.stockCount} in stock</p>}
          {(item.modifiers?.length ?? 0) > 0 && <p className="mt-1 font-body text-body-sm text-outline">{item.modifierGroupName || 'Options'} · {item.modifiers?.length} options</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-outline-variant pt-3">
        <Button variant="secondary" className="min-h-10 flex-1 px-3" onClick={onEdit}><MaterialIcon name="edit" className="text-lg" />Edit</Button>
        <Button variant="secondary" className="min-h-10 px-3" aria-label={`${availability === 'available' ? 'Mark 86' : 'Mark available'}: ${item.name}`} onClick={onToggle}><MaterialIcon name={availability === 'available' ? 'block' : 'check'} className="text-lg" />{availability === 'available' ? '86' : 'Available'}</Button>
        <Button variant="ghost" className="min-h-10 px-3 text-error-dark" aria-label={`Remove ${item.name}`} onClick={onDelete}><MaterialIcon name="delete" className="text-lg" /></Button>
      </div>
    </article>
  );
}

export function OwnerCatalogScreen() {
  return <OwnerCatalogContent />;
}
