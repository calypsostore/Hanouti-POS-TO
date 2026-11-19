import type { ActivityRecord, UserRecord } from '../types/domain';
import { readData, writeData } from './storage';

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
      summary: entry.summary,
      entityType: entry.entityType,
      entityId: entry.entityId,
      meta: typeof entry.meta === 'object' && entry.meta !== null ? entry.meta as ActivityRecord['meta'] : {},
    };
  }
  if (entry.action === 'customer_payment_reversed') {
    return {
      ...common,
      action: 'tab.payment_reversed',
      summary: `Reversed a payment of ${String(entry.amountMillimes ?? 0)} millimes. ${String(entry.reason ?? '')}`.trim(),
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
    if (!entry.storeId.trim() || !entry.action.trim() || !entry.summary.trim() ||
      !entry.entityType.trim() || !entry.entityId.trim()) {
      throw new Error('Activity records require a store, action, summary, and entity.');
    }
    const record: ActivityRecord = {
      ...entry,
      ...resolveActor(entry),
      id: `activity-${crypto.randomUUID()}`,
      meta: entry.meta ?? {},
      createdAt: new Date().toISOString(),
    };
    writeData('activity-logs', [...readEntries(), record]);
    return record;
  },

  async list(storeId: string, filters: ActivityFilters = {}): Promise<ActivityRecord[]> {
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
