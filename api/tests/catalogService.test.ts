import { beforeEach, describe, expect, it } from 'vitest';
import { catalogService } from '../src/services/catalogService';
import type { CatalogItemRecord, CategoryRecord } from '../src/types/domain';

const categories: CategoryRecord[] = [
  { id: 'category-active', storeId: 'store-1', name: 'Drinks', icon: 'coffee', sortOrder: 0, isActive: true },
  { id: 'category-archived', storeId: 'store-1', name: 'Seasonal', icon: 'star', sortOrder: 1, isActive: false },
];

const items: CatalogItemRecord[] = [
  {
    id: 'item-active',
    storeId: 'store-1',
    categoryId: 'category-active',
    name: 'Coffee',
    icon: 'coffee',
    priceMillimes: 2500,
    stockCount: null,
    outOfStock: false,
    isActive: true,
  },
  {
    id: 'item-archived',
    storeId: 'store-1',
    categoryId: 'category-archived',
    name: 'Seasonal tea',
    icon: 'tea',
    priceMillimes: 3000,
    stockCount: null,
    outOfStock: false,
    isActive: false,
  },
];

describe('catalog service management lists', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('7anouti-pos:categories', JSON.stringify(categories));
    localStorage.setItem('7anouti-pos:catalog-items', JSON.stringify(items));
  });

  it('keeps archived categories out of normal lists but exposes them to category management', async () => {
    expect(await catalogService.listCategories('store-1')).toEqual([categories[0]]);
    expect(await catalogService.listCategories('store-1', true)).toEqual(categories);
  });

  it('keeps archived products out of normal lists but exposes them to product management', async () => {
    expect(await catalogService.listItems('store-1')).toEqual([items[0]]);
    expect(await catalogService.listItems('store-1', undefined, '', true)).toEqual(items);
  });
});
