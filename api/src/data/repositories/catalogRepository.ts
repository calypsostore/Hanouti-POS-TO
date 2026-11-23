import type {
  CatalogItemRecord,
  CatalogModifierRecord,
  CategoryRecord,
  ItemHistoryRecord,
} from '../../types/domain';
import { getSupabaseClient } from '../supabaseClient';

interface CategoryRow {
  id: string;
  store_id: string;
  name: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
}

interface CatalogItemRow {
  id: string;
  store_id: string;
  category_id: string;
  name: string;
  icon: string;
  price_millimes: number;
  stock_count: number | null;
  low_stock_threshold: number;
  description: string | null;
  sku: string | null;
  modifier_group_name: string | null;
  modifiers_required: boolean;
  modifier_selection_mode: 'single' | 'multiple';
  out_of_stock: boolean;
  out_of_stock_by: string | null;
  out_of_stock_at: string | null;
  is_active: boolean;
}

interface ModifierRow {
  id: string;
  name: string;
  price_millimes: number;
}

interface ItemHistoryRow {
  id: string;
  item_id: string;
  field: ItemHistoryRecord['field'];
  old_value: unknown;
  new_value: unknown;
  changed_by: string | null;
  changed_at: string;
  reason: ItemHistoryRecord['reason'] | null;
}

function mapCategory(row: CategoryRow): CategoryRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    icon: row.icon,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

function mapItem(row: CatalogItemRow, modifiers: CatalogModifierRecord[] = []): CatalogItemRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    categoryId: row.category_id,
    name: row.name,
    icon: row.icon,
    priceMillimes: Number(row.price_millimes),
    stockCount: row.stock_count,
    lowStockThreshold: row.low_stock_threshold,
    description: row.description ?? undefined,
    sku: row.sku ?? undefined,
    modifiers,
    modifierGroupName: row.modifier_group_name ?? undefined,
    modifiersRequired: row.modifiers_required,
    modifierSelectionMode: row.modifier_selection_mode,
    outOfStock: row.out_of_stock,
    outOfStockBy: row.out_of_stock_by ?? undefined,
    outOfStockAt: row.out_of_stock_at ?? undefined,
    isActive: row.is_active,
  };
}

function mapModifier(row: ModifierRow): CatalogModifierRecord {
  return { id: row.id, name: row.name, priceMillimes: Number(row.price_millimes) };
}

function errorWithContext(error: { message: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

export async function listCategories(storeId: string, includeInactive = false): Promise<CategoryRecord[]> {
  let query = getSupabaseClient()
    .from('categories')
    .select('id, store_id, name, icon, sort_order, is_active')
    .eq('store_id', storeId)
    .order('sort_order');
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) errorWithContext(error, 'Could not load categories');
  return (data ?? []).map((row) => mapCategory(row as CategoryRow));
}

export async function listItems(
  storeId: string,
  categoryId?: string,
  search = '',
  includeInactive = false,
): Promise<CatalogItemRecord[]> {
  let query = getSupabaseClient()
    .from('catalog_items')
    .select('*')
    .eq('store_id', storeId)
    .order('name');
  if (!includeInactive) query = query.eq('is_active', true);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (search.trim()) query = query.ilike('name', `%${search.trim()}%`);
  const { data, error } = await query;
  if (error) errorWithContext(error, 'Could not load catalog items');
  const rows = (data ?? []) as CatalogItemRow[];
  if (!rows.length) return [];
  const { data: modifierRows, error: modifierError } = await getSupabaseClient()
    .from('catalog_modifiers')
    .select('id, item_id, name, price_millimes, sort_order')
    .in('item_id', rows.map((row) => row.id))
    .order('sort_order');
  if (modifierError) errorWithContext(modifierError, 'Could not load catalog modifiers');
  const modifiersByItem = new Map<string, CatalogModifierRecord[]>();
  for (const modifier of modifierRows ?? []) {
    const mapped = mapModifier(modifier as ModifierRow);
    const itemModifiers = modifiersByItem.get(modifier.item_id) ?? [];
    itemModifiers.push(mapped);
    modifiersByItem.set(modifier.item_id, itemModifiers);
  }
  return rows.map((row) => mapItem(row, modifiersByItem.get(row.id)));
}

export async function getItem(itemId: string): Promise<CatalogItemRecord | undefined> {
  const { data, error } = await getSupabaseClient().from('catalog_items').select('*').eq('id', itemId).maybeSingle();
  if (error) errorWithContext(error, 'Could not load catalog item');
  if (!data) return undefined;
  const { data: modifiers, error: modifierError } = await getSupabaseClient()
    .from('catalog_modifiers')
    .select('id, name, price_millimes')
    .eq('item_id', itemId)
    .order('sort_order');
  if (modifierError) errorWithContext(modifierError, 'Could not load catalog modifiers');
  return mapItem(data as CatalogItemRow, (modifiers ?? []).map((row) => mapModifier(row as ModifierRow)));
}

export async function listItemHistory(itemId: string): Promise<ItemHistoryRecord[]> {
  const { data, error } = await getSupabaseClient()
    .from('item_history')
    .select('id, item_id, field, old_value, new_value, changed_by, changed_at, reason')
    .eq('item_id', itemId)
    .order('changed_at', { ascending: false });
  if (error) errorWithContext(error, 'Could not load item history');
  return (data ?? []).map((row) => {
    const value = row as ItemHistoryRow;
    return {
      id: value.id,
      itemId: value.item_id,
      field: value.field,
      oldValue: value.old_value as ItemHistoryRecord['oldValue'],
      newValue: value.new_value as ItemHistoryRecord['newValue'],
      changedBy: value.changed_by ?? 'Unknown',
      changedAt: value.changed_at,
      reason: value.reason ?? undefined,
    };
  });
}

export async function createCategory(input: Omit<CategoryRecord, 'id'>): Promise<CategoryRecord> {
  const { data, error } = await getSupabaseClient().from('categories').insert({
    store_id: input.storeId,
    name: input.name,
    icon: input.icon,
    sort_order: input.sortOrder,
    is_active: input.isActive,
  }).select('id, store_id, name, icon, sort_order, is_active').single();
  if (error) errorWithContext(error, 'Could not create category');
  return mapCategory(data as CategoryRow);
}

export async function updateCategory(
  categoryId: string,
  changes: Partial<Pick<CategoryRecord, 'name' | 'icon' | 'sortOrder' | 'isActive'>>,
): Promise<CategoryRecord> {
  const { data, error } = await getSupabaseClient().from('categories').update({
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.icon !== undefined ? { icon: changes.icon } : {}),
    ...(changes.sortOrder !== undefined ? { sort_order: changes.sortOrder } : {}),
    ...(changes.isActive !== undefined ? { is_active: changes.isActive } : {}),
  }).eq('id', categoryId).select('id, store_id, name, icon, sort_order, is_active').single();
  if (error) errorWithContext(error, 'Could not update category');
  return mapCategory(data as CategoryRow);
}

function itemChangesToRow(changes: Partial<CatalogItemRecord>): Record<string, unknown> {
  return {
    ...(changes.categoryId !== undefined ? { category_id: changes.categoryId } : {}),
    ...(changes.name !== undefined ? { name: changes.name } : {}),
    ...(changes.icon !== undefined ? { icon: changes.icon } : {}),
    ...(changes.priceMillimes !== undefined ? { price_millimes: changes.priceMillimes } : {}),
    ...(changes.stockCount !== undefined ? { stock_count: changes.stockCount } : {}),
    ...(changes.lowStockThreshold !== undefined ? { low_stock_threshold: changes.lowStockThreshold } : {}),
    ...(changes.description !== undefined ? { description: changes.description || null } : {}),
    ...(changes.sku !== undefined ? { sku: changes.sku || null } : {}),
    ...(changes.modifierGroupName !== undefined ? { modifier_group_name: changes.modifierGroupName || null } : {}),
    ...(changes.modifiersRequired !== undefined ? { modifiers_required: changes.modifiersRequired } : {}),
    ...(changes.modifierSelectionMode !== undefined ? { modifier_selection_mode: changes.modifierSelectionMode } : {}),
    ...(changes.outOfStock !== undefined ? { out_of_stock: changes.outOfStock } : {}),
    ...(changes.isActive !== undefined ? { is_active: changes.isActive } : {}),
  };
}

async function replaceModifiers(itemId: string, modifiers: CatalogModifierRecord[]): Promise<void> {
  const client = getSupabaseClient();
  const { error: deleteError } = await client.from('catalog_modifiers').delete().eq('item_id', itemId);
  if (deleteError) errorWithContext(deleteError, 'Could not update modifiers');
  if (!modifiers.length) return;
  const { data: item, error: itemError } = await client.from('catalog_items').select('store_id').eq('id', itemId).single();
  if (itemError) errorWithContext(itemError, 'Could not load item store');
  const { error } = await client.from('catalog_modifiers').insert(modifiers.map((modifier, index) => ({
    store_id: item.store_id,
    item_id: itemId,
    name: modifier.name.trim(),
    price_millimes: modifier.priceMillimes,
    sort_order: index,
  })));
  if (error) errorWithContext(error, 'Could not save modifiers');
}

export async function createItem(input: Omit<CatalogItemRecord, 'id'>): Promise<CatalogItemRecord> {
  const { data, error } = await getSupabaseClient().from('catalog_items').insert({
    store_id: input.storeId,
    category_id: input.categoryId,
    name: input.name,
    icon: input.icon,
    price_millimes: input.priceMillimes,
    stock_count: input.stockCount,
    low_stock_threshold: input.lowStockThreshold ?? 5,
    description: input.description ?? null,
    sku: input.sku ?? null,
    modifier_group_name: input.modifierGroupName ?? null,
    modifiers_required: input.modifiersRequired ?? false,
    modifier_selection_mode: input.modifierSelectionMode ?? 'multiple',
    out_of_stock: input.outOfStock,
    is_active: input.isActive,
  }).select('*').single();
  if (error) errorWithContext(error, 'Could not create catalog item');
  try {
    if (input.modifiers?.length) await replaceModifiers(data.id, input.modifiers);
  } catch (error) {
    const { error: rollbackError } = await getSupabaseClient().from('catalog_items').delete().eq('id', data.id);
    if (rollbackError) console.error('Could not roll back catalog item after modifier creation failed.', rollbackError);
    throw error;
  }
  const item = await getItem(data.id);
  if (!item) throw new Error('The new catalog item could not be reloaded.');
  return item;
}

export async function updateItem(
  itemId: string,
  changes: Partial<CatalogItemRecord>,
): Promise<CatalogItemRecord> {
  const { data, error } = await getSupabaseClient().from('catalog_items').update(itemChangesToRow(changes))
    .eq('id', itemId).select('*').single();
  if (error) errorWithContext(error, 'Could not update catalog item');
  if (changes.modifiers !== undefined) await replaceModifiers(itemId, changes.modifiers);
  if (changes.modifiers !== undefined) return mapItem(data as CatalogItemRow, changes.modifiers);
  const updated = await getItem(itemId);
  if (!updated) throw new Error('The updated catalog item could not be reloaded.');
  return updated;
}

export async function setAvailability(itemId: string, outOfStock: boolean): Promise<CatalogItemRecord> {
  const { data, error } = await getSupabaseClient().rpc('set_catalog_availability', {
    p_item_id: itemId,
    p_out_of_stock: outOfStock,
  });
  if (error) errorWithContext(error, 'Could not update item availability');
  return mapItem(data as CatalogItemRow);
}

export async function setStockCount(itemId: string, stockCount: number | null, reason: string): Promise<CatalogItemRecord> {
  const { data, error } = await getSupabaseClient().rpc('adjust_catalog_stock', {
    p_item_id: itemId,
    p_stock_count: stockCount,
    p_out_of_stock: stockCount === 0,
    p_reason: reason,
  });
  if (error) errorWithContext(error, 'Could not update stock');
  return mapItem(data as CatalogItemRow);
}
