import { useState, type FormEvent } from 'react';
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
import type { CatalogItemRecord, CategoryRecord } from '../types/domain';
import { userService } from '../services/userService';

type CatalogSheet = 'item' | 'category' | null;

function OwnerCatalogContent() {
  const user = useAuthStore((state) => state.user);
  const storeId = user?.storeId ?? '';
  const store = userService.getStore(storeId);
  const [categories, setCategories] = useState(() => catalogService.listCategories(storeId));
  const [items, setItems] = useState(() => catalogService.listItems(storeId));
  const [categoryId, setCategoryId] = useState('all');
  const [sheet, setSheet] = useState<CatalogSheet>(null);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  function refresh() {
    setCategories(catalogService.listCategories(storeId));
    setItems(catalogService.listItems(storeId));
  }

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    try {
      const selectedCategory = itemCategory || categories[0]?.id;
      if (!selectedCategory) throw new Error('Create a category before adding catalog items.');
      const priceMillimes = Math.round(Number(itemPrice.replace(',', '.')) * 1000);
      if (!Number.isFinite(priceMillimes) || priceMillimes < 0) throw new Error('Enter a valid non-negative TND price.');
      catalogService.createItem({
        storeId,
        categoryId: selectedCategory,
        name: itemName,
        icon: categories.find((category) => category.id === selectedCategory)?.icon ?? 'local_cafe',
        priceMillimes,
        stockCount: null,
        outOfStock: false,
        isActive: true,
      });
      refresh();
      setItemName('');
      setItemPrice('');
      setSheet(null);
      setNotice('Catalog item added.');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to add this item.');
    }
  }

  function addCategory(event: FormEvent<HTMLFormElement>) {
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
      catalogService.createCategory(category);
      refresh();
      setCategoryName('');
      setSheet(null);
      setNotice('Category added.');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Unable to add this category.');
    }
  }

  function toggleOutOfStock(item: CatalogItemRecord) {
    setError('');
    setNotice('');
    try {
      catalogService.setOutOfStock(item.id, !item.outOfStock);
      refresh();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update availability.');
    }
  }

  const visibleItems = items.filter((item) => categoryId === 'all' || item.categoryId === categoryId);
  return (
    <WorkspaceLayout title={t('catalog.title')} storeName={store?.name} links={ownerWorkspaceLinks}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-headline-lg text-on-surface">{t('catalog.title')}</h1>
          <p className="mt-1 font-body text-body-md text-on-surface-variant">Manage categories, prices, and availability.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => { setError(''); setSheet('category'); }}><MaterialIcon name="create_new_folder" className="text-lg" />{t('catalog.addCategory')}</Button>
          <Button onClick={() => { setError(''); setSheet('item'); }}><MaterialIcon name="add" />{t('catalog.addItem')}</Button>
        </div>
      </header>

      <div className="scrollbar-hidden mb-4 flex gap-2 overflow-x-auto py-1">
        <Chip selected={categoryId === 'all'} onClick={() => setCategoryId('all')}>{t('catalog.items')}</Chip>
        {categories.map((category) => <Chip key={category.id} selected={categoryId === category.id} onClick={() => setCategoryId(category.id)}>{category.name}</Chip>)}
      </div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visibleItems.map((item) => (
          <CatalogItemCard key={item.id} item={item} category={categories.find((value) => value.id === item.categoryId)} onToggle={() => toggleOutOfStock(item)} />
        ))}
        {visibleItems.length === 0 && <p className="rounded-xl bg-surface-container-lowest p-4 font-body text-body-sm text-outline">{t('common.noData')}</p>}
      </section>

      {(error || notice) && <p role={error ? 'alert' : 'status'} className={`mt-4 rounded-lg p-3 font-body text-body-sm ${error ? 'bg-error-container text-on-error-container' : 'bg-success-container text-on-success-container'}`}>{error || notice}</p>}

      <BottomSheet open={sheet === 'item'} onClose={() => setSheet(null)} title={t('catalog.addItem')}>
        <form onSubmit={addItem} className="flex flex-col gap-3">
          <label className="font-body text-label-md">{t('common.name')}<input required value={itemName} onChange={(event) => setItemName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          <label className="font-body text-label-md">{t('catalog.priceTnd')}<input required inputMode="decimal" value={itemPrice} onChange={(event) => setItemPrice(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          <label className="font-body text-label-md">{t('catalog.category')}<select required value={itemCategory || categories[0]?.id || ''} onChange={(event) => setItemCategory(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary">{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit">{t('catalog.save')}</Button>
        </form>
      </BottomSheet>
      <BottomSheet open={sheet === 'category'} onClose={() => setSheet(null)} title={t('catalog.addCategory')}>
        <form onSubmit={addCategory} className="flex flex-col gap-3">
          <label className="font-body text-label-md">{t('common.name')}<input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} className="mt-1 h-12 w-full rounded-lg bg-surface-container-low px-3 outline-none focus:ring-2 focus:ring-primary" /></label>
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          <Button type="submit">{t('common.save')}</Button>
        </form>
      </BottomSheet>
    </WorkspaceLayout>
  );
}

function CatalogItemCard({ item, category, onToggle }: { item: CatalogItemRecord; category?: CategoryRecord; onToggle: () => void }) {
  return (
    <article className="flex items-center gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-container text-primary"><MaterialIcon name={item.icon} className="text-2xl" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-body text-label-lg text-on-surface">{item.name}</p>
        <p className="mt-1 font-body text-body-sm text-outline">{category?.name} • <span className="tabular-nums">{formatTnd(item.priceMillimes / 1000)} DT</span></p>
      </div>
      <button type="button" aria-pressed={item.outOfStock} aria-label={`${t('catalog.outOfStock')}: ${item.name}`} onClick={onToggle} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${item.outOfStock ? 'bg-error-container text-error-dark' : 'bg-success-container text-success-dark'}`}>
        <MaterialIcon name={item.outOfStock ? 'block' : 'check'} />
      </button>
    </article>
  );
}

export function OwnerCatalogScreen() {
  return <OwnerCatalogContent />;
}
