import type { CatalogItemRecord, CategoryRecord } from '../types/domain';
import { readData, writeData } from './storage';
import { seedCatalogItems, seedCategories } from './seedData';

const getItems = () => readData('catalog-items', seedCatalogItems);
const getCategories = () => readData('categories', seedCategories);
const makeId = (kind: string) => `${kind}-${crypto.randomUUID()}`;

export const catalogService = {
  listCategories(storeId: string): CategoryRecord[] {
    return getCategories().filter((category) => category.storeId === storeId && category.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  },

  listItems(storeId: string, categoryId?: string, search = ''): CatalogItemRecord[] {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return getItems().filter((item) =>
      item.storeId === storeId &&
      item.isActive &&
      (!categoryId || item.categoryId === categoryId) &&
      (!normalizedSearch || item.name.toLocaleLowerCase().includes(normalizedSearch)),
    );
  },

  createCategory(input: Omit<CategoryRecord, 'id'>): CategoryRecord {
    if (!input.name.trim()) throw new Error('Category name is required.');
    const category = { ...input, id: makeId('category'), name: input.name.trim() };
    writeData('categories', [...getCategories(), category]);
    return category;
  },

  updateCategory(categoryId: string, changes: Partial<Pick<CategoryRecord, 'name' | 'icon' | 'sortOrder' | 'isActive'>>): CategoryRecord {
    const categories = getCategories();
    const category = categories.find((candidate) => candidate.id === categoryId);
    if (!category) throw new Error('Category could not be found.');
    const updated = { ...category, ...changes };
    writeData('categories', categories.map((candidate) => candidate.id === categoryId ? updated : candidate));
    return updated;
  },

  createItem(input: Omit<CatalogItemRecord, 'id'>): CatalogItemRecord {
    if (!input.name.trim() || input.priceMillimes < 0) throw new Error('Item name and a valid non-negative price are required.');
    const item = { ...input, id: makeId('item'), name: input.name.trim() };
    writeData('catalog-items', [...getItems(), item]);
    return item;
  },

  updateItem(itemId: string, changes: Partial<Pick<CatalogItemRecord, 'name' | 'categoryId' | 'icon' | 'priceMillimes' | 'stockCount' | 'outOfStock' | 'isActive'>>): CatalogItemRecord {
    const items = getItems();
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error('Catalog item could not be found.');
    if (changes.priceMillimes !== undefined && changes.priceMillimes < 0) throw new Error('Price cannot be negative.');
    const updated = { ...item, ...changes };
    writeData('catalog-items', items.map((candidate) => candidate.id === itemId ? updated : candidate));
    return updated;
  },

  setOutOfStock(itemId: string, outOfStock: boolean): CatalogItemRecord {
    return this.updateItem(itemId, { outOfStock });
  },

  setStockCount(itemId: string, stockCount: number | null): CatalogItemRecord {
    if (stockCount !== null && (!Number.isInteger(stockCount) || stockCount < 0)) throw new Error('Stock count must be a non-negative whole number.');
    return this.updateItem(itemId, { stockCount, outOfStock: stockCount === 0 });
  },
};
