import type { ActivityRecord, UserRecord } from '../types/domain';
import { formatMillimesAmountsInText } from '../lib/format';
import { readData, writeData } from './storage';
import { getProfile } from '../data/repositories/profileRepository';
import { getSupabaseClient } from '../data/supabaseClient';
import { isSupabaseDriver } from '../data/driver';

type ActivityActorFields = Pick<ActivityRecord, 'actorId' | 'actorName' | 'actorRole'>;

export type ActivityEntry = Omit<ActivityRecord, 'id' | 'createdAt' | keyof ActivityActorFields | 'meta'> &
  Partial<ActivityActorFields> & { meta?: ActivityRecord['meta'] };

export interface ActivityFilters {
  staffId?: string;
  actionGroup?: string;
  from?: string;
  to?: string;
  search?: string;
}

const getUsers = () => readData<UserRecord[]>('users', []);
const getStoredEntries = (): unknown[] => readData<unknown[]>('activity-logs', []);

function actionGroup(action: string): string {
  if (action.startsWith('order.')) return 'orders';
  if (action === 'item.86' || action.startsWith('price.') || action.startsWith('stock.') || action.startsWith('catalog.')) return 'catalog';
  if (action.startsWith('staff.') || action.startsWith('position.')) return 'staff';
  if (action.startsWith('customer.')) return 'customers';
  if (action.startsWith('tab.')) return 'tabs';
  if (action.startsWith('shift.')) return 'shifts';
  if (action.startsWith('cash.')) return 'cash';
  if (action.startsWith('report.')) return 'reports';
  if (action.startsWith('expense.')) return 'expenses';
  if (action.startsWith('supplier.')) return 'suppliers';
  if (action.startsWith('lock.') || action === 'login' || action === 'logout' || action.startsWith('auth.')) return 'security';
  if (action.startsWith('schedule.')) return 'schedule';
  if (action.startsWith('comp.')) return 'comps';
  if (action.startsWith('store.')) return 'settings';
  return 'other';
}

function resolveActor(entry: ActivityEntry): ActivityActorFields {
  const session = readData<{ userId: string } | null>('auth-session', null);
  const actorId = entry.actorId ?? session?.userId ?? 'system';
  const actor = getUsers().find((user) => user.id === actorId);
  return {
    actorId,
    actorName: entry.actorName ?? actor?.name ?? (actorId === 'system' ? 'System' : 'Unknown user'),
    actorRole: entry.actorRole ?? actor?.role ?? 'unknown',
  };
}

function dateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function normalizeLegacyEntry(value: unknown): ActivityRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== 'string' || typeof entry.storeId !== 'string' || typeof entry.actorId !== 'string') return undefined;
  const actor = getUsers().find((user) => user.id === entry.actorId);
  const createdAt = typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString();
  const common = {
    id: entry.id,
    storeId: entry.storeId,
    actorId: entry.actorId,
    actorName: actor?.name ?? 'Unknown user',
    actorRole: actor?.role ?? 'unknown',
    createdAt,
  };
  if (typeof entry.action === 'string' && typeof entry.summary === 'string' &&
    typeof entry.entityType === 'string' && typeof entry.entityId === 'string') {
    return {
      ...common,
      actorName: typeof entry.actorName === 'string' ? entry.actorName : common.actorName,
      actorRole: typeof entry.actorRole === 'string' ? entry.actorRole : common.actorRole,
      action: entry.action,
      summary: formatMillimesAmountsInText(entry.summary),
      entityType: entry.entityType,
      entityId: entry.entityId,
      meta: typeof entry.meta === 'object' && entry.meta !== null ? entry.meta as ActivityRecord['meta'] : {},
    };
  }
  if (entry.action === 'customer_payment_reversed') {
    return {
      ...common,
      action: 'tab.payment_reversed',
      summary: formatMillimesAmountsInText(`Reversed a payment of ${String(entry.amountMillimes ?? 0)} millimes. ${String(entry.reason ?? '')}`.trim()),
      entityType: 'customer_payment',
      entityId: String(entry.targetId ?? ''),
      meta: { after: { amountMillimes: entry.amountMillimes, reason: entry.reason } },
    };
  }
  if (entry.action === 'catalog_item_availability_changed') {
    return {
      ...common,
      action: entry.outOfStock === true ? 'item.86' : 'item.available',
      summary: `${String(entry.itemName ?? 'Item')} marked ${entry.outOfStock === true ? 'out of stock' : 'available'}.`,
      entityType: 'catalog_item',
      entityId: String(entry.targetId ?? ''),
      meta: { after: { outOfStock: entry.outOfStock } },
    };
  }
  if (entry.action === 'staff_session_locked' || entry.action === 'staff_session_unlocked') {
    const locked = entry.action === 'staff_session_locked';
    return {
      ...common,
      action: locked ? 'lock.locked' : 'lock.unlocked',
      summary: `Staff session ${locked ? 'locked' : 'unlocked'}.`,
      entityType: 'staff_session',
      entityId: String(entry.targetId ?? ''),
      meta: { after: { locked } },
    };
  }
  return undefined;
}

function readEntries(): ActivityRecord[] {
  const entries = getStoredEntries().map(normalizeLegacyEntry);
  if (entries.some((entry) => entry === undefined)) {
    throw new Error('Stored activity log contains an unsupported record.');
  }
  return entries as ActivityRecord[];
}

export const activityService = {
  async log(entry: ActivityEntry): Promise<ActivityRecord> {
    const summary = formatMillimesAmountsInText(entry.summary);
    if (!entry.storeId.trim() || !entry.action.trim() || !summary.trim() ||
      !entry.entityType.trim() || !entry.entityId.trim()) {
      throw new Error('Activity records require a store, action, summary, and entity.');
    }
    if (isSupabaseDriver()) {
      const { data: authData, error: authError } = await getSupabaseClient().auth.getUser();
      if (authError || !authData.user) throw new Error('An active sign-in is required to record activity.', { cause: authError });
      const actor = await getProfile(authData.user.id);
      if (!actor) throw new Error('The active profile could not be loaded to record activity.');
      if (entry.actorId && entry.actorId !== actor.id) {
        throw new Error('Activity can only be recorded for the signed-in user.');
      }
      const { data: id, error } = await getSupabaseClient().rpc('log_activity', {
        p_action: entry.action,
        p_summary: summary,
        p_entity_type: entry.entityType,
        p_entity_id: entry.entityId,
        p_meta: entry.meta ?? {},
      });
      if (error) throw new Error(`Could not record activity: ${error.message}`, { cause: error });
      return {
        ...entry,
        summary,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        id: id as string,
        meta: entry.meta ?? {},
        createdAt: new Date().toISOString(),
      };
    }
    const record: ActivityRecord = {
      ...entry,
      summary,
      ...resolveActor(entry),
      id: `activity-${crypto.randomUUID()}`,
      meta: entry.meta ?? {},
      createdAt: new Date().toISOString(),
    };
    writeData('activity-logs', [...readEntries(), record]);
    return record;
  },

  async list(storeId: string, filters: ActivityFilters = {}): Promise<ActivityRecord[]> {
    if (isSupabaseDriver()) {
      let query = getSupabaseClient()
        .from('activity_logs')
        .select('id, store_id, actor_id, actor_name, actor_role, action, summary, entity_type, entity_id, meta, created_at')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false });
      if (filters.staffId) query = query.eq('actor_id', filters.staffId);
      if (filters.from) query = query.gte('created_at', `${filters.from}T00:00:00`);
      if (filters.to) query = query.lt('created_at', `${filters.to}T23:59:59.999`);
      const { data, error } = await query;
      if (error) throw new Error(`Could not load activity history: ${error.message}`, { cause: error });
      const records: ActivityRecord[] = (data ?? []).map((row) => ({
        id: row.id,
        storeId: row.store_id,
        actorId: row.actor_id ?? '',
        actorName: row.actor_name,
        actorRole: row.actor_role,
        action: row.action,
        summary: formatMillimesAmountsInText(row.summary),
        entityType: row.entity_type,
        entityId: row.entity_id,
        meta: row.meta as ActivityRecord['meta'],
        createdAt: row.created_at,
      }));
      const search = filters.search?.trim().toLocaleLowerCase();
      return records.filter((entry) => !filters.actionGroup || actionGroup(entry.action) === filters.actionGroup)
        .filter((entry) => !search || [
          entry.summary,
          entry.action,
          entry.actorName,
          entry.entityType,
          entry.entityId,
          JSON.stringify(entry.meta ?? {}),
        ].some((value) => value.toLocaleLowerCase().includes(search)));
    }
    const search = filters.search?.trim().toLocaleLowerCase();
    return readEntries()
      .filter((entry) => entry.storeId === storeId)
      .filter((entry) => !filters.staffId || entry.actorId === filters.staffId)
      .filter((entry) => !filters.actionGroup || actionGroup(entry.action) === filters.actionGroup)
      .filter((entry) => !filters.from || dateKey(entry.createdAt) >= filters.from)
      .filter((entry) => !filters.to || dateKey(entry.createdAt) <= filters.to)
      .filter((entry) => !search || [
        entry.summary,
        entry.action,
        entry.actorName,
        entry.entityType,
        entry.entityId,
        JSON.stringify(entry.meta ?? {}),
      ].some((value) => value.toLocaleLowerCase().includes(search)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  },

  actionGroup,
};
