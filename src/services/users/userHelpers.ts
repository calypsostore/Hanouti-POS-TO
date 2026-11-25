import type { PositionRecord, StoreRecord, UserRecord, UserSummary } from '../../types/domain';
import { readData, writeData } from '../storage';
import { seedPositions, seedStores, seedUsers } from '../seedData';
import { activityService } from '../activityService';
import { migrateLegacyDemoStoreIdentity } from '../accountIdentity';
import { PERMISSIONS_CHANGED_EVENT } from '../userEvents';

export const getUsers = () => {
  migrateLegacyDemoStoreIdentity();
  return readData('users', seedUsers);
};

export const getStores = () => {
  migrateLegacyDemoStoreIdentity();
  return readData('stores', seedStores);
};

export const getPositions = () => {
  const positions = readData('positions', seedPositions);
  let migrated = false;
  const updated = positions.map((position) => {
    const needsCustomerView = (position.permissionIds.includes('use_tabs') || position.permissionIds.includes('settle_tabs')) &&
      !position.permissionIds.includes('customers_view');
    if (!needsCustomerView) return position;
    migrated = true;
    return { ...position, permissionIds: [...position.permissionIds, 'customers_view'] };
  });
  if (migrated) writeData('positions', updated);
  return updated;
};

export const saveUsers = (value: UserRecord[]) => writeData('users', value);
export const saveStores = (value: StoreRecord[]) => writeData('stores', value);
export const savePositions = (value: PositionRecord[]) => writeData('positions', value);

export function notifyStoreSettingsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('hanouti:store-settings-updated'));
}

export function notifyPermissionsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PERMISSIONS_CHANGED_EVENT));
}

export function makeTemporaryPassword(): string {
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => (value % 10).toString()).join('');
}

const STAFF_TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export function makeStaffTemporaryPassword(): string {
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => STAFF_TEMPORARY_PASSWORD_ALPHABET[value % STAFF_TEMPORARY_PASSWORD_ALPHABET.length]).join('');
}

export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function assertSuperAdmin(actorId: string): UserRecord {
  const actor = getUsers().find((candidate) => candidate.id === actorId && candidate.role === 'super_admin' && candidate.isActive);
  if (!actor) throw new Error('Only an active platform owner can manage stores.');
  return actor;
}

export function positionFromRow(row: {
  id: string;
  store_id: string;
  name: string;
  permission_ids: string[];
  self_service_item_ids: string[];
  self_service_category_ids: string[];
  max_staff_drink_quantity_per_shift: number;
}): PositionRecord {
  return {
    id: row.id,
    storeId: row.store_id,
    name: row.name,
    permissionIds: row.permission_ids,
    selfServiceItemIds: row.self_service_item_ids,
    selfServiceCategoryIds: row.self_service_category_ids,
    maxStaffDrinkQuantityPerShift: row.max_staff_drink_quantity_per_shift,
  };
}

export function withoutPassword(user: UserRecord): UserSummary {
  const { password: _password, passwordHash: _passwordHash, pinHash: _pinHash, ...safeUser } = user;
  const store = user.role === 'owner' && user.storeId
    ? getStores().find((candidate) => candidate.id === user.storeId)
    : undefined;
  return {
    ...safeUser,
    mustSetPin: (user.role === 'staff' || user.role === 'owner')
      ? user.mustSetPin ?? (user.mustChangePassword || !user.pinHash)
      : false,
    mustSetVoidPin: user.role === 'owner' && Boolean(store?.pinMustChange),
  };
}

export async function logUserMutation(input: {
  storeId: string;
  actorId?: string;
  action: string;
  summary: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  if (!input.storeId.trim()) return;
  await activityService.log({
    storeId: input.storeId,
    actorId: input.actorId,
    action: input.action,
    summary: input.summary,
    entityType: input.entityType,
    entityId: input.entityId,
    meta: { before: input.before, after: input.after },
  });
}
