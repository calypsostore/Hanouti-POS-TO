import type { CatalogItemRecord, CatalogModifierRecord, CategoryRecord } from '../types/domain';
import { readData, writeData } from './storage';
import { seedCatalogItems, seedCategories } from './seedData';

const getItems = () => readData('catalog-items', seedCatalogItems);
const getCategories = () => readData('categories', seedCategories);
const makeId = (kind: string) => `${kind}-${crypto.randomUUID()}`;

export const catalogService = {
  async listCategories(storeId: string): Promise<CategoryRecord[]> {
    return getCategories().filter((category) => category.storeId === storeId && category.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  },

  async listItems(storeId: string, categoryId?: string, search = ''): Promise<CatalogItemRecord[]> {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return getItems().filter((item) =>
      item.storeId === storeId &&
      item.isActive &&
      (!categoryId || item.categoryId === categoryId) &&
      (!normalizedSearch || item.name.toLocaleLowerCase().includes(normalizedSearch)),
    );
  },

  async createCategory(input: Omit<CategoryRecord, 'id'>): Promise<CategoryRecord> {
    if (!input.name.trim()) throw new Error('Category name is required.');
    const category = { ...input, id: makeId('category'), name: input.name.trim() };
    writeData('categories', [...getCategories(), category]);
    return category;
  },

  async updateCategory(categoryId: string, changes: Partial<Pick<CategoryRecord, 'name' | 'icon' | 'sortOrder' | 'isActive'>>): Promise<CategoryRecord> {
    const categories = getCategories();
    const category = categories.find((candidate) => candidate.id === categoryId);
    if (!category) throw new Error('Category could not be found.');
    const updated = { ...category, ...changes };
    writeData('categories', categories.map((candidate) => candidate.id === categoryId ? updated : candidate));
    return updated;
  },

  async createItem(input: Omit<CatalogItemRecord, 'id'>): Promise<CatalogItemRecord> {
    if (!input.name.trim() || input.priceMillimes < 0) throw new Error('Item name and a valid non-negative price are required.');
    const item = { ...input, id: makeId('item'), name: input.name.trim() };
    writeData('catalog-items', [...getItems(), item]);
    return item;
  },

  async updateItem(itemId: string, changes: Partial<Pick<CatalogItemRecord, 'name' | 'categoryId' | 'icon' | 'priceMillimes' | 'stockCount' | 'description' | 'sku' | 'imageDataUrl' | 'modifiers' | 'modifierGroupName' | 'modifiersRequired' | 'modifierSelectionMode' | 'outOfStock' | 'isActive'>>): Promise<CatalogItemRecord> {
    const items = getItems();
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error('Catalog item could not be found.');
    if (changes.priceMillimes !== undefined && changes.priceMillimes < 0) throw new Error('Price cannot be negative.');
    if (changes.modifiers?.some((modifier) => !modifier.name.trim() || !Number.isInteger(modifier.priceMillimes) || modifier.priceMillimes < 0)) {
      throw new Error('Each modifier needs a name and a valid non-negative add-on price.');
    }
    const updated = { ...item, ...changes };
    writeData('catalog-items', items.map((candidate) => candidate.id === itemId ? updated : candidate));
    return updated;
  },

  async setOutOfStock(itemId: string, outOfStock: boolean): Promise<CatalogItemRecord> {
    return await this.updateItem(itemId, { outOfStock });
  },

  async setStockCount(itemId: string, stockCount: number | null): Promise<CatalogItemRecord> {
    if (stockCount !== null && (!Number.isInteger(stockCount) || stockCount < 0)) throw new Error('Stock count must be a non-negative whole number.');
    return await this.updateItem(itemId, { stockCount, outOfStock: stockCount === 0 });
  },

  async decrementStock(itemId: string, quantity: number): Promise<CatalogItemRecord> {
    const item = getItems().find((candidate) => candidate.id === itemId);
    if (!item) throw new Error('Catalog item could not be found.');
    if (item.stockCount === null) return item;
    if (quantity > item.stockCount) throw new Error(`${item.name} has only ${item.stockCount} remaining.`);
    const stockCount = item.stockCount - quantity;
    return await this.updateItem(itemId, { stockCount, outOfStock: stockCount === 0 });
  },

  async incrementStock(itemId: string, quantity: number): Promise<CatalogItemRecord> {
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Stock quantity must be a positive whole number.');
    const item = getItems().find((candidate) => candidate.id === itemId);
    if (!item) throw new Error('Catalog item could not be found.');
    if (item.stockCount === null) return item;
    return await this.updateItem(itemId, { stockCount: item.stockCount + quantity, outOfStock: false });
  },

  async setModifiers(itemId: string, modifiers: CatalogModifierRecord[]): Promise<CatalogItemRecord> {
    return await this.updateItem(itemId, { modifiers });
  },
};
