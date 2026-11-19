import type { CatalogItemRecord, CatalogModifierRecord, CategoryRecord } from '../types/domain';
import { readData, writeData } from './storage';
import { seedCatalogItems, seedCategories } from './seedData';
import { activityService } from './activityService';
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
  const priceChanged = changes.priceMillimes !== undefined && changes.priceMillimes !== item.priceMillimes;
  const stockChanged = changes.stockCount !== undefined && changes.stockCount !== item.stockCount;
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

  const changesToLog: { action: string; summary: string }[] = [];
  if (availabilityChanged) {
    changesToLog.push({
      action: nextOutOfStock ? 'item.86' : 'item.available',
      summary: `${item.name} marked ${nextOutOfStock ? 'out of stock' : 'available'}.`,
    });
  }
  if (priceChanged) {
    changesToLog.push({
      action: 'price.changed',
      summary: `Changed the price of ${item.name} from ${item.priceMillimes} to ${updated.priceMillimes} millimes.`,
    });
  }
  if (stockChanged) {
    changesToLog.push({
      action: 'stock.updated',
      summary: `Updated ${item.name} stock from ${item.stockCount ?? 'untracked'} to ${updated.stockCount ?? 'untracked'}.`,
    });
  }
  if (changesToLog.length === 0 && Object.keys(changes).length > 0) {
    changesToLog.push({ action: 'catalog.item_updated', summary: `Updated item "${item.name}".` });
  }
  for (const change of changesToLog) {
    await activityService.log({
      storeId: item.storeId,
      actorId: actor?.id,
      actorName: actor?.name,
      action: change.action,
      summary: change.summary,
      entityType: 'catalog_item',
      entityId: item.id,
      meta: {
        before: {
          name: item.name,
          priceMillimes: item.priceMillimes,
          stockCount: item.stockCount,
          outOfStock: item.outOfStock,
          isActive: item.isActive,
        },
        after: {
          name: updated.name,
          priceMillimes: updated.priceMillimes,
          stockCount: updated.stockCount,
          outOfStock: updated.outOfStock,
          isActive: updated.isActive,
        },
      },
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
    await activityService.log({
      storeId: category.storeId,
      action: 'catalog.category_created',
      summary: `Created category "${category.name}".`,
      entityType: 'category',
      entityId: category.id,
      meta: { after: category },
    });
    return category;
  },

  async updateCategory(categoryId: string, changes: Partial<Pick<CategoryRecord, 'name' | 'icon' | 'sortOrder' | 'isActive'>>): Promise<CategoryRecord> {
    const categories = getCategories();
    const category = categories.find((candidate) => candidate.id === categoryId);
    if (!category) throw new Error('Category could not be found.');
    const updated = { ...category, ...changes };
    writeData('categories', categories.map((candidate) => candidate.id === categoryId ? updated : candidate));
    await activityService.log({
      storeId: category.storeId,
      action: 'catalog.category_updated',
      summary: `Updated category "${updated.name}".`,
      entityType: 'category',
      entityId: category.id,
      meta: { before: category, after: updated },
    });
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
    await activityService.log({
      storeId: item.storeId,
      action: 'catalog.item_created',
      summary: `Created item "${item.name}".`,
      entityType: 'catalog_item',
      entityId: item.id,
      meta: { after: item },
    });
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
