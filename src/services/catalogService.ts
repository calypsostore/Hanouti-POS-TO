import type { CatalogItemRecord, CatalogModifierRecord, CategoryRecord } from '../types/domain';
import { readData, writeData } from './storage';
import { seedCatalogItems, seedCategories } from './seedData';
import { activityLogService } from './activityLogService';
import { notificationService } from './notificationService';

interface CatalogActor {
  id: string;
  name: string;
}

const getItems = () => readData('catalog-items', seedCatalogItems);
const getCategories = () => readData('categories', seedCategories);
const makeId = (kind: string) => `${kind}-${crypto.randomUUID()}`;

async function updateCatalogItem(
  itemId: string,
  changes: Partial<Pick<CatalogItemRecord, 'name' | 'categoryId' | 'icon' | 'priceMillimes' | 'stockCount' | 'lowStockThreshold' | 'description' | 'sku' | 'modifiers' | 'modifierGroupName' | 'modifiersRequired' | 'modifierSelectionMode' | 'outOfStock' | 'isActive'>>,
  actor?: CatalogActor,
  notifyOnStockDepletion = true,
): Promise<CatalogItemRecord> {
  const items = getItems();
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error('Catalog item could not be found.');
  if (changes.priceMillimes !== undefined && changes.priceMillimes < 0) throw new Error('Price cannot be negative.');
  if (changes.modifiers?.some((modifier) => !modifier.name.trim() || !Number.isInteger(modifier.priceMillimes) || modifier.priceMillimes < 0)) {
    throw new Error('Each modifier needs a name and a valid non-negative add-on price.');
  }
  if (changes.stockCount !== undefined && changes.stockCount !== null &&
    (!Number.isInteger(changes.stockCount) || changes.stockCount < 0)) {
    throw new Error('Stock count must be a non-negative whole number.');
  }
  if (changes.lowStockThreshold !== undefined &&
    (!Number.isInteger(changes.lowStockThreshold) || changes.lowStockThreshold < 0)) {
    throw new Error('Low-stock threshold must be a non-negative whole number.');
  }
  const stockReachedZero = changes.stockCount === 0 && item.stockCount !== 0;
  const resultingStockCount = changes.stockCount !== undefined ? changes.stockCount : item.stockCount;
  if (changes.outOfStock === false && resultingStockCount === 0) {
    throw new Error('Add tracked stock before marking this item available.');
  }
  const nextOutOfStock = changes.stockCount === 0 ? true : changes.outOfStock ?? item.outOfStock;
  const availabilityChanged = item.outOfStock !== nextOutOfStock;
  if ((availabilityChanged || stockReachedZero) && !actor) {
    throw new Error('An acting staff member is required to change catalog availability.');
  }

  const markedAt = new Date().toISOString();
  const updated: CatalogItemRecord = {
    ...item,
    ...changes,
    outOfStock: nextOutOfStock,
    ...(availabilityChanged
      ? nextOutOfStock
        ? { outOfStockBy: actor?.name, outOfStockAt: markedAt }
        : { outOfStockBy: undefined, outOfStockAt: undefined }
      : {}),
  };
  writeData('catalog-items', items.map((candidate) => candidate.id === itemId ? updated : candidate));

  if (availabilityChanged && actor) {
    await activityLogService.recordCatalogItemAvailabilityChange({
      storeId: item.storeId,
      actorId: actor.id,
      action: 'catalog_item_availability_changed',
      targetType: 'catalog_item',
      targetId: item.id,
      itemName: item.name,
      outOfStock: nextOutOfStock,
    });
  }
  if (stockReachedZero && notifyOnStockDepletion) {
    await notificationService.notifyStockDepleted(item.storeId, item.id, item.name);
  }
  return updated;
}

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
    if (input.lowStockThreshold !== undefined &&
      (!Number.isInteger(input.lowStockThreshold) || input.lowStockThreshold < 0)) {
      throw new Error('Low-stock threshold must be a non-negative whole number.');
    }
    const item = { ...input, id: makeId('item'), name: input.name.trim() };
    writeData('catalog-items', [...getItems(), item]);
    return item;
  },

  async updateItem(
    itemId: string,
    changes: Partial<Pick<CatalogItemRecord, 'name' | 'categoryId' | 'icon' | 'priceMillimes' | 'stockCount' | 'lowStockThreshold' | 'description' | 'sku' | 'modifiers' | 'modifierGroupName' | 'modifiersRequired' | 'modifierSelectionMode' | 'outOfStock' | 'isActive'>>,
    actor?: CatalogActor,
  ): Promise<CatalogItemRecord> {
    return await updateCatalogItem(itemId, changes, actor);
  },

  async setOutOfStock(itemId: string, outOfStock: boolean, actor: CatalogActor): Promise<CatalogItemRecord> {
    return await updateCatalogItem(itemId, { outOfStock }, actor, false);
  },

  async setStockCount(itemId: string, stockCount: number | null, actor: CatalogActor): Promise<CatalogItemRecord> {
    return await updateCatalogItem(itemId, { stockCount, outOfStock: stockCount === 0 }, actor);
  },

  async decrementStock(itemId: string, quantity: number, actor: CatalogActor): Promise<CatalogItemRecord> {
    const item = getItems().find((candidate) => candidate.id === itemId);
    if (!item) throw new Error('Catalog item could not be found.');
    if (item.stockCount === null) return item;
    if (quantity > item.stockCount) throw new Error(`${item.name} has only ${item.stockCount} remaining.`);
    const stockCount = item.stockCount - quantity;
    return await updateCatalogItem(itemId, { stockCount, outOfStock: stockCount === 0 }, actor, false);
  },

  async incrementStock(itemId: string, quantity: number, actor: CatalogActor): Promise<CatalogItemRecord> {
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Stock quantity must be a positive whole number.');
    const item = getItems().find((candidate) => candidate.id === itemId);
    if (!item) throw new Error('Catalog item could not be found.');
    if (item.stockCount === null) return item;
    return await updateCatalogItem(itemId, { stockCount: item.stockCount + quantity, outOfStock: false }, actor, false);
  },

  async setModifiers(itemId: string, modifiers: CatalogModifierRecord[]): Promise<CatalogItemRecord> {
    return await this.updateItem(itemId, { modifiers });
  },
};
