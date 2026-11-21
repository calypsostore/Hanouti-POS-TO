import { resolveStoreSettings, type PermissionDefinition, type PermissionOverrides, type PositionRecord, type ProfileAvatarId, type StoreRecord, type StoreSettings, type StoreSubscription, type UserRecord, type UserSummary } from '../types/domain';
import { readData, removeData, writeData } from './storage';
import { seedPositions, seedStores, seedUsers } from './seedData';
import { hashSecret, verifySecret } from './secretService';
import { activityService } from './activityService';
import { getLogoDefinition } from '../data/logoCatalog';
import { authService } from './authService';
import { getSupabaseClient } from '../data/supabaseClient';
import { isSupabaseDriver } from '../data/driver';
import { createOwnerAccount, createStaff, resetPassword } from '../data/repositories/accountRepository';
import { getPermissionOverrides, getProfile, listProfiles } from '../data/repositories/profileRepository';
import { getStore as getRemoteStore, listStores as listRemoteStores } from '../data/repositories/storeRepository';
import { formatStaffUsername, generateStoreCode, migrateLegacyDemoStoreIdentity } from './accountIdentity';
import { isProfileAvatarId } from '../data/profileAvatars';

const PERMISSIONS: PermissionDefinition[] = [
  { id: 'take_orders', group: 'Orders', label: 'Take orders' },
  { id: 'view_order_history', group: 'Orders', label: 'View order history (own orders)' },
  { id: 'view_all_orders', group: 'Orders', label: 'View all orders' },
  { id: 'request_void', group: 'Orders', label: 'Request void' },
  { id: 'add_order_note', group: 'Orders', label: 'Add order note' },
  { id: 'comp_items', group: 'Orders', label: 'Comp items' },
  { id: '86_items', group: 'Catalog', label: '86 items' },
  { id: 'edit_stock_counts', group: 'Catalog', label: 'Edit stock counts' },
  { id: 'customers_view', group: 'Customers and tabs', label: 'View customers' },
  { id: 'customers_create', group: 'Customers and tabs', label: 'Create customers' },
  { id: 'customers_edit', group: 'Customers and tabs', label: 'Edit customers' },
  { id: 'use_tabs', group: 'Customers and tabs', label: 'Charge orders to a tab' },
  { id: 'settle_tabs', group: 'Customers and tabs', label: 'Take tab payments' },
  { id: 'tab_override_limit', group: 'Customers and tabs', label: 'Override tab credit limit' },
  { id: 'open_close_shift', group: 'Shift and cash', label: 'Open / close shift' },
  { id: 'cash_in_out', group: 'Shift and cash', label: 'Cash in/out' },
  { id: 'print_x_report', group: 'Shift and cash', label: 'Print an X report for own shift' },
  { id: 'view_schedule', group: 'Other', label: 'View schedule' },
  { id: 'view_own_hours', group: 'Other', label: 'View own hours' },
];

const getUsers = () => {
  migrateLegacyDemoStoreIdentity();
  return readData('users', seedUsers);
};
const getStores = () => {
  migrateLegacyDemoStoreIdentity();
  return readData('stores', seedStores);
};
const getPositions = () => {
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
const saveUsers = (value: UserRecord[]) => writeData('users', value);
const saveStores = (value: StoreRecord[]) => writeData('stores', value);
const savePositions = (value: PositionRecord[]) => writeData('positions', value);

export const PERMISSIONS_CHANGED_EVENT = '7anouti-permissions-changed';

function notifyPermissionsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PERMISSIONS_CHANGED_EVENT));
}

function makeTemporaryPassword(): string {
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => (value % 10).toString()).join('');
}

const STAFF_TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function makeStaffTemporaryPassword(): string {
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => STAFF_TEMPORARY_PASSWORD_ALPHABET[value % STAFF_TEMPORARY_PASSWORD_ALPHABET.length]).join('');
}

function normalizePermissionOverrides(overrides: PermissionOverrides): PermissionOverrides {
  const knownPermissions = new Set(PERMISSIONS.map((permission) => permission.id));
  if ([...overrides.granted, ...overrides.revoked].some((permissionId) => !knownPermissions.has(permissionId))) {
    throw new Error('Permission overrides contain an unknown permission.');
  }
  return {
    granted: [...new Set(overrides.granted)],
    revoked: [...new Set(overrides.revoked)],
  };
}

function validatePositionCompRules(rules: Pick<PositionRecord,
  'selfServiceItemIds' | 'selfServiceCategoryIds' | 'maxStaffDrinkQuantityPerShift'>): void {
  const maximum = rules.maxStaffDrinkQuantityPerShift;
  if (maximum !== undefined && (!Number.isInteger(maximum) || maximum < 0)) {
    throw new Error('Staff drink limit must be a non-negative whole number.');
  }
  for (const ids of [rules.selfServiceItemIds, rules.selfServiceCategoryIds]) {
    if (ids?.some((id) => !id.trim())) throw new Error('Staff drink item and category selections are invalid.');
  }
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function assertSuperAdmin(actorId: string): UserRecord {
  const actor = getUsers().find((candidate) => candidate.id === actorId && candidate.role === 'super_admin' && candidate.isActive);
  if (!actor) throw new Error('Only an active platform owner can manage stores.');
  return actor;
}

function positionFromRow(row: {
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

function withoutPassword(user: UserRecord): UserSummary {
  const { password: _password, passwordHash: _passwordHash, pinHash: _pinHash, ...safeUser } = user;
  return {
    ...safeUser,
    mustSetPin: user.role === 'staff'
      ? user.mustSetPin ?? (user.mustChangePassword || !user.pinHash)
      : user.role === 'owner' && (user.mustSetPin ?? false),
  };
}

async function logUserMutation(input: {
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

export const userService = {
  async listUsers(storeId?: string): Promise<UserSummary[]> {
    if (isSupabaseDriver()) {
      const users = await listProfiles(storeId);
      const { data: authData, error } = await getSupabaseClient().auth.getUser();
      if (error || !authData.user) throw new Error('An active sign-in is required to list accounts.', { cause: error });
      const actor = await getProfile(authData.user.id);
      if (actor?.role !== 'owner') return users;
      return Promise.all(users.map(async (user) => user.role === 'staff'
        ? { ...user, permissionOverrides: await getPermissionOverrides(user.id) }
        : user));
    }
    return getUsers().filter((user) => !storeId || user.storeId === storeId).map(withoutPassword);
  },

  async getUser(userId: string): Promise<UserSummary | undefined> {
    if (isSupabaseDriver()) {
      const user = await getProfile(userId);
      if (!user || user.role !== 'staff') return user;
      const { data: authData, error } = await getSupabaseClient().auth.getUser();
      if (error || !authData.user) throw new Error('An active sign-in is required to load staff permissions.', { cause: error });
      const actor = await getProfile(authData.user.id);
      return actor?.role === 'owner'
        ? { ...user, permissionOverrides: await getPermissionOverrides(user.id) }
        : user;
    }
    const user = getUsers().find((candidate) => candidate.id === userId);
    if (!user) return undefined;
    return withoutPassword(user);
  },

  async getStore(storeId: string): Promise<StoreRecord | undefined> {
    if (isSupabaseDriver()) return getRemoteStore(storeId);
    return getStores().find((store) => store.id === storeId);
  },

  async updateStoreSettings(
    storeId: string,
    ownerId: string,
    changes: {
      defaultSettlementTerms?: StoreSettings['defaultSettlementTerms'];
      notificationPreferences?: Partial<StoreSettings['notificationPreferences']>;
      quickPickMode?: StoreSettings['quickPickMode'];
      quickPickItemIds?: StoreSettings['quickPickItemIds'];
      ticketHeaderText?: string[];
      ticketFooterText?: string[];
      reportFooterText?: string[];
      storeLogoId?: string;
      showLogo?: boolean;
      showAddress?: boolean;
      showPhone?: boolean;
      showStaffName?: boolean;
      showDateTime?: boolean;
      paperWidth?: 58 | 80;
    },
  ): Promise<StoreRecord> {
    if (changes.quickPickMode !== undefined && !['auto', 'manual'].includes(changes.quickPickMode)) {
      throw new Error('Choose automatic or manual Quick Picks.');
    }
    if (changes.quickPickItemIds &&
      changes.quickPickItemIds.some((itemId) => typeof itemId !== 'string' || !itemId.trim())) {
      throw new Error('Quick Pick product selections are invalid.');
    }
    const normalizedChanges = changes.quickPickItemIds
      ? { ...changes, quickPickItemIds: [...new Set(changes.quickPickItemIds)] }
      : changes;
    if (isSupabaseDriver()) {
      if (changes.defaultSettlementTerms !== undefined &&
        !['weekly', 'monthly', 'anytime'].includes(changes.defaultSettlementTerms)) {
        throw new Error('Choose valid default customer settlement terms.');
      }
      if (changes.notificationPreferences &&
        Object.values(changes.notificationPreferences).some((enabled) => typeof enabled !== 'boolean')) {
        throw new Error('Notification preferences must be enabled or disabled.');
      }
      if (changes.storeLogoId !== undefined && changes.storeLogoId !== '' && !getLogoDefinition(changes.storeLogoId)) {
        throw new Error('Choose a logo from the platform logo catalog.');
      }
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can change store settings.');
      const settings = {
        ...resolveStoreSettings(store.settings),
        ...normalizedChanges,
        notificationPreferences: {
          ...resolveStoreSettings(store.settings).notificationPreferences,
          ...normalizedChanges.notificationPreferences,
        },
      };
      const { error } = await getSupabaseClient().from('store_settings').upsert({ store_id: storeId, settings });
      if (error) throw new Error(`Could not save store settings: ${error.message}`, { cause: error });
      await activityService.log({
        storeId,
        action: 'store.settings_changed',
        summary: 'Updated store preferences.',
        entityType: 'store',
        entityId: storeId,
        meta: { before: store.settings, after: settings },
      });
      return { ...store, settings };
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error('Only this store owner can change store settings.');
    }
    if (changes.defaultSettlementTerms !== undefined &&
      !['weekly', 'monthly', 'anytime'].includes(changes.defaultSettlementTerms)) {
      throw new Error('Choose valid default customer settlement terms.');
    }
    if (changes.notificationPreferences &&
      Object.values(changes.notificationPreferences).some((enabled) => typeof enabled !== 'boolean')) {
      throw new Error('Notification preferences must be enabled or disabled.');
    }
    if (changes.storeLogoId !== undefined && changes.storeLogoId !== '' && !getLogoDefinition(changes.storeLogoId)) {
      throw new Error('Choose a logo from the platform logo catalog.');
    }
    const currentSettings = resolveStoreSettings(store.settings);
    const settings: StoreSettings = {
      ...currentSettings,
      ...normalizedChanges,
      notificationPreferences: {
        ...currentSettings.notificationPreferences,
        ...normalizedChanges.notificationPreferences,
      },
    };
    const updated = { ...store, settings };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary: 'Updated store preferences.',
      entityType: 'store',
      entityId: store.id,
      before: store.settings ?? currentSettings,
      after: settings,
    });
    return updated;
  },

  async listStores(): Promise<StoreRecord[]> {
    if (isSupabaseDriver()) return listRemoteStores();
    return getStores();
  },

  async updateStoreNameAsAdmin(storeId: string, actorId: string, name: string): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      const cleanedName = name.trim();
      if (!cleanedName) throw new Error('Store name is required.');
      const store = await getRemoteStore(storeId);
      if (!store) throw new Error('The store could not be found.');
      const { error } = await getSupabaseClient().from('stores').update({ name: cleanedName }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update store name: ${error.message}`, { cause: error });
      const updated = { ...store, name: cleanedName };
      await activityService.log({
        storeId,
        actorId,
        action: 'store.name_changed',
        summary: `Platform owner changed store name to "${cleanedName}".`,
        entityType: 'store',
        entityId: store.id,
        meta: { before: { name: store.name }, after: { name: updated.name } },
      });
      return updated;
    }
    assertSuperAdmin(actorId);
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const cleanedName = name.trim();
    if (!store) throw new Error('The store could not be found.');
    if (!cleanedName) throw new Error('Store name is required.');
    const updated = { ...store, name: cleanedName };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId,
      action: 'store.name_changed',
      summary: `Platform owner changed store name to "${cleanedName}".`,
      entityType: 'store',
      entityId: store.id,
      before: { name: store.name },
      after: { name: updated.name },
    });
    return updated;
  },

  async updateStoreSubscription(
    storeId: string,
    actorId: string,
    subscription: StoreSubscription,
  ): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      if (!['trial', 'monthly', 'yearly'].includes(subscription.plan)) throw new Error('Choose a valid subscription plan.');
      if (subscription.paidUntil !== null) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(subscription.paidUntil);
        if (!match) throw new Error('Subscription end date must use YYYY-MM-DD format.');
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
          throw new Error('Enter a valid subscription end date.');
        }
      }
      if (subscription.notes.length > 2000) throw new Error('Subscription notes must be 2000 characters or fewer.');
      const store = await getRemoteStore(storeId);
      if (!store) throw new Error('The store could not be found.');
      const { error } = await getSupabaseClient().from('stores').update({
        subscription_plan: subscription.plan,
        subscription_paid_until: subscription.paidUntil,
        subscription_notes: subscription.notes,
      }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update subscription: ${error.message}`, { cause: error });
      const updated = { ...store, subscription };
      await activityService.log({
        storeId,
        actorId,
        action: 'store.subscription_changed',
        summary: `Updated subscription for "${store.name}".`,
        entityType: 'store',
        entityId: store.id,
        meta: { before: store.subscription, after: subscription },
      });
      return updated;
    }
    assertSuperAdmin(actorId);
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    if (!['trial', 'monthly', 'yearly'].includes(subscription.plan)) {
      throw new Error('Choose a valid subscription plan.');
    }
    if (subscription.paidUntil !== null) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(subscription.paidUntil);
      if (!match) throw new Error('Subscription end date must use YYYY-MM-DD format.');
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
        throw new Error('Enter a valid subscription end date.');
      }
    }
    const notes = subscription.notes.trim();
    if (notes.length > 1000) throw new Error('Subscription notes must be 1000 characters or fewer.');
    const updated = { ...store, subscription: { ...subscription, notes } };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId,
      action: 'store.subscription_changed',
      summary: `Updated ${store.name} subscription (${subscription.plan}${subscription.paidUntil ? ` through ${subscription.paidUntil}` : ', no end date'}).`,
      entityType: 'store',
      entityId: store.id,
      before: store.subscription,
      after: updated.subscription,
    });
    return updated;
  },

  async archiveStore(storeId: string, actorId: string): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store) throw new Error('The store could not be found.');
      const archivedAt = new Date().toISOString();
      const { error } = await getSupabaseClient().from('stores').update({ is_active: false, archived_at: archivedAt }).eq('store_id', storeId);
      if (error) throw new Error(`Could not archive store: ${error.message}`, { cause: error });
      await activityService.log({
        storeId,
        actorId,
        action: 'store.archived',
        summary: `Archived store "${store.name}".`,
        entityType: 'store',
        entityId: store.id,
        meta: { before: { isActive: store.isActive, archivedAt: store.archivedAt }, after: { isActive: false, archivedAt } },
      });
      return { ...store, isActive: false, archivedAt };
    }
    assertSuperAdmin(actorId);
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    if (store.archivedAt) return store;
    const updated = { ...store, isActive: false, archivedAt: new Date().toISOString() };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId,
      action: 'store.archived',
      summary: `Archived store "${store.name}".`,
      entityType: 'store',
      entityId: store.id,
      before: { isActive: store.isActive, archivedAt: store.archivedAt },
      after: { isActive: updated.isActive, archivedAt: updated.archivedAt },
    });
    return updated;
  },

  async clearDayClosed(storeId: string): Promise<void> {
    if (isSupabaseDriver()) return;
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    saveStores(stores.map((store) => store.id === storeId ? { ...store, dayClosedOn: undefined } : store));
    if (store.dayClosedOn) {
      await logUserMutation({
        storeId,
        action: 'store.day_reopened',
        summary: 'Reopened the business day.',
        entityType: 'store',
        entityId: store.id,
        before: { dayClosedOn: store.dayClosedOn },
        after: { dayClosedOn: undefined },
      });
    }
  },

  async createOwnerAccount(input: { name: string; email: string; storeName: string }): Promise<{ owner: UserSummary; store: StoreRecord; temporaryPassword: string }> {
    if (isSupabaseDriver()) return createOwnerAccount(input);
    const users = getUsers();
    if (users.some((user) => user.email?.toLocaleLowerCase() === input.email.toLocaleLowerCase())) {
      throw new Error('An account already uses this email address.');
    }
    const storeName = input.storeName.trim();
    if (!storeName) throw new Error('Store name is required.');
    const existingStores = getStores();
    const code = generateStoreCode(storeName, existingStores.map((store) => store.code));

    const temporaryPassword = makeTemporaryPassword();
    const ownerId = createId('owner');
    const defaultPinHash = await hashSecret('1234');
    const store: StoreRecord = {
      id: createId('store'),
      ownerId,
      code,
      name: storeName,
      adminPinHash: defaultPinHash,
      pinMustChange: true,
      isActive: true,
      settings: resolveStoreSettings(),
      subscription: {
        plan: 'trial',
        paidUntil: (() => {
          const end = new Date();
          end.setDate(end.getDate() + 14);
          return localDateKey(end);
        })(),
        notes: '',
      },
      createdAt: new Date().toISOString(),
    };
    const owner: UserRecord = {
      id: ownerId,
      role: 'owner',
      name: input.name.trim(),
      email: input.email.trim(),
      passwordHash: await hashSecret(temporaryPassword),
      mustChangePassword: true,
      mustSetPin: true,
      isActive: true,
      storeId: store.id,
      createdAt: new Date().toISOString(),
    };
    saveUsers([...users, owner]);
    saveStores([...getStores(), store]);
    await logUserMutation({
      storeId: store.id,
      actorId: undefined,
      action: 'store.created',
      summary: `Created store "${store.name}" and its owner account.`,
      entityType: 'store',
      entityId: store.id,
      after: { store: { id: store.id, name: store.name, code: store.code }, owner: withoutPassword(owner) },
    });
    const ownerSummary = await this.getUser(owner.id);
    if (!ownerSummary) throw new Error('The new owner account could not be loaded.');
    return { owner: ownerSummary, store, temporaryPassword };
  },

  generateStoreCode(storeName: string, existingCodes: string[] = []): string {
    return generateStoreCode(storeName, existingCodes);
  },

  formatStaffUsername(storeCode: string, name: string, existingUsernames: string[] = []): string {
    return formatStaffUsername(storeCode, name, existingUsernames);
  },

  async createStaff(input: {
    storeId: string;
    name: string;
    phone?: string;
    notes?: string;
    positionId: string;
    permissionOverrides?: PermissionOverrides;
  }): Promise<{ staff: UserSummary; temporaryPassword: string }> {
    if (isSupabaseDriver()) return createStaff(input);
    const name = input.name.trim();
    const store = await this.getStore(input.storeId);
    if (!store) throw new Error('The store could not be found.');
    if (!getPositions().some((position) => position.id === input.positionId && position.storeId === input.storeId)) {
      throw new Error('Select a position from this store.');
    }
    if (!name) throw new Error('Staff name is required.');
    const users = getUsers();
    const username = formatStaffUsername(store.code, name, users.flatMap((user) => user.username ? [user.username] : []));
    const temporaryPassword = makeStaffTemporaryPassword();
    const permissionOverrides = input.permissionOverrides ? normalizePermissionOverrides(input.permissionOverrides) : undefined;
    const staff: UserRecord = {
      id: createId('staff'),
      role: 'staff',
      name,
      phone: input.phone?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      username,
      passwordHash: await hashSecret(temporaryPassword),
      mustChangePassword: true,
      mustSetPin: true,
      isActive: true,
      storeId: input.storeId,
      positionId: input.positionId,
      permissionOverrides,
      createdAt: new Date().toISOString(),
    };
    saveUsers([...users, staff]);
    await logUserMutation({
      storeId: input.storeId,
      action: 'staff.created',
      summary: `Created staff account "${staff.name}".`,
      entityType: 'staff',
      entityId: staff.id,
      after: withoutPassword(staff),
    });
    const staffSummary = await this.getUser(staff.id);
    if (!staffSummary) throw new Error('The new staff account could not be loaded.');
    return { staff: staffSummary, temporaryPassword };
  },

  async resetStaffPassword(userId: string): Promise<string> {
    if (isSupabaseDriver()) {
      const temporaryPassword = await resetPassword(userId);
      const staff = await getProfile(userId);
      if (staff?.storeId) {
        await activityService.log({
          storeId: staff.storeId,
          action: 'staff.password_reset',
          summary: `Reset the password for "${staff.name}".`,
          entityType: 'staff',
          entityId: staff.id,
          meta: { after: { mustChangePassword: true } },
        });
      }
      return temporaryPassword;
    }
    const users = getUsers();
    const staff = users.find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!staff) throw new Error('Staff account could not be found.');
    const temporaryPassword = makeStaffTemporaryPassword();
    const updated = {
      ...staff,
      passwordHash: await hashSecret(temporaryPassword),
      password: undefined,
      mustChangePassword: true,
      pinHash: undefined,
      mustSetPin: true,
      sessionVersion: (staff.sessionVersion ?? 0) + 1,
    };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    removeData(`staff-pin-attempts:${userId}`);
    await logUserMutation({
      storeId: staff.storeId ?? '',
      action: 'staff.password_reset',
      summary: `Reset the password for "${staff.name}".`,
      entityType: 'staff',
      entityId: staff.id,
      before: { mustChangePassword: staff.mustChangePassword },
      after: { mustChangePassword: true, mustSetPin: true, hasPin: false },
    });
    return temporaryPassword;
  },

  async resetOwnerPassword(ownerId: string, actorId: string): Promise<string> {
    if (isSupabaseDriver()) {
      const actor = await getProfile(actorId);
      if (!actor || actor.role !== 'super_admin') throw new Error('Only an active platform owner can manage stores.');
      const temporaryPassword = await resetPassword(ownerId);
      const owner = await getProfile(ownerId);
      if (owner?.storeId) {
        await activityService.log({
          storeId: owner.storeId,
          actorId: actor.id,
          action: 'owner.password_reset',
          summary: `Platform owner reset the password for "${owner.name}".`,
          entityType: 'owner',
          entityId: owner.id,
          meta: { after: { mustChangePassword: true } },
        });
      }
      return temporaryPassword;
    }
    assertSuperAdmin(actorId);
    const users = getUsers();
    const owner = users.find((candidate) => candidate.id === ownerId && candidate.role === 'owner');
    if (!owner || !owner.storeId) throw new Error('Owner account could not be found.');
    const temporaryPassword = makeTemporaryPassword();
    const updated: UserRecord = {
      ...owner,
      passwordHash: await hashSecret(temporaryPassword),
      password: undefined,
      mustChangePassword: true,
      pinHash: undefined,
      mustSetPin: true,
      sessionVersion: (owner.sessionVersion ?? 0) + 1,
    };
    saveUsers(users.map((candidate) => candidate.id === ownerId ? updated : candidate));
    await logUserMutation({
      storeId: owner.storeId,
      actorId,
      action: 'owner.password_reset',
      summary: `Platform owner reset the password for "${owner.name}".`,
      entityType: 'owner',
      entityId: owner.id,
      before: { mustChangePassword: owner.mustChangePassword },
      after: { mustChangePassword: true, mustSetPin: true, hasPin: false },
    });
    return temporaryPassword;
  },

  async resetStaffPin(ownerId: string, staffId: string, pin: string): Promise<void> {
    if (isSupabaseDriver()) {
      if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain exactly 4 digits.');
      const { data: authData, error: authError } = await getSupabaseClient().auth.getUser();
      if (authError || authData.user?.id !== ownerId) throw new Error('Only this store owner can reset this staff PIN.');
      const { error } = await getSupabaseClient().rpc('set_staff_pin_by_owner', { p_staff_id: staffId, p_pin: pin });
      if (error) throw new Error(`Could not reset the staff PIN: ${error.message}`, { cause: error });
      const staff = await getProfile(staffId);
      if (staff?.storeId) {
        await activityService.log({
          storeId: staff.storeId,
          action: 'staff.pin_reset',
          summary: `Reset the personal PIN for "${staff.name}".`,
          entityType: 'staff',
          entityId: staff.id,
          meta: { after: { hasPin: true } },
        });
      }
      return;
    }
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain exactly 4 digits.');
    const users = getUsers();
    const owner = users.find((candidate) => candidate.id === ownerId && candidate.role === 'owner');
    const staff = users.find((candidate) => candidate.id === staffId && candidate.role === 'staff');
    const store = owner?.storeId ? getStores().find((candidate) => candidate.id === owner.storeId) : undefined;
    if (!owner || !staff || !store || store.ownerId !== owner.id || owner.storeId !== staff.storeId) {
      throw new Error('Only this store owner can reset this staff PIN.');
    }
    if (staff.mustChangePassword || staff.mustSetPin || !staff.pinHash) {
      throw new Error('The staff member must complete first-login PIN setup before their PIN can be reset.');
    }
    const pinHash = await hashSecret(pin);
    saveUsers(users.map((candidate) => candidate.id === staffId ? { ...candidate, pinHash, mustSetPin: false } : candidate));
    removeData(`staff-pin-attempts:${staffId}`);
    await logUserMutation({
      storeId: store.id,
      actorId: owner.id,
      action: 'staff.pin_reset',
      summary: `Reset the personal PIN for "${staff.name}".`,
      entityType: 'staff',
      entityId: staff.id,
      before: { hasPin: Boolean(staff.pinHash) },
      after: { hasPin: true },
    });
  },

  async forceLogoutStaff(userId: string): Promise<void> {
    if (isSupabaseDriver()) {
      const { error } = await getSupabaseClient().rpc('force_logout_staff', { p_staff_id: userId });
      if (error) throw new Error(`Could not force logout staff: ${error.message}`, { cause: error });
      const staff = await getProfile(userId);
      if (staff?.storeId) {
        await activityService.log({
          storeId: staff.storeId,
          action: 'staff.force_logged_out',
          summary: `Force-logged out "${staff.name}".`,
          entityType: 'staff',
          entityId: staff.id,
        });
      }
      return;
    }
    const users = getUsers();
    const staff = users.find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!staff) throw new Error('Staff account could not be found.');
    const updated = { ...staff, sessionVersion: (staff.sessionVersion ?? 0) + 1 };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    if (staff.storeId) {
      await logUserMutation({
        storeId: staff.storeId,
        action: 'staff.force_logged_out',
        summary: `Force-logged out "${staff.name}".`,
        entityType: 'staff',
        entityId: staff.id,
        before: { sessionVersion: staff.sessionVersion ?? 0 },
        after: { sessionVersion: updated.sessionVersion },
      });
    }
  },

  async updateStaff(userId: string, changes: { name?: string; phone?: string; notes?: string; positionId?: string; isActive?: boolean }): Promise<UserSummary> {
    if (isSupabaseDriver()) {
      if (changes.name !== undefined && !changes.name.trim()) throw new Error('Staff name is required.');
      const { error } = await getSupabaseClient().from('profiles').update({
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone.trim() || null } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes.trim() || null } : {}),
        ...(changes.positionId !== undefined ? { position_id: changes.positionId } : {}),
        ...(changes.isActive !== undefined ? { is_active: changes.isActive } : {}),
      }).eq('id', userId).eq('role', 'staff');
      if (error) throw new Error(`Could not update staff account: ${error.message}`, { cause: error });
      if (changes.positionId !== undefined) notifyPermissionsChanged();
      const updated = await this.getUser(userId);
      if (!updated) throw new Error('Updated staff account could not be loaded.');
      if (updated.storeId) {
        await activityService.log({
          storeId: updated.storeId,
          action: changes.positionId !== undefined ? 'staff.permission_changed' : 'staff.updated',
          summary: `Updated staff account "${updated.name}".`,
          entityType: 'staff',
          entityId: updated.id,
          meta: { after: { name: updated.name, phone: updated.phone, notes: updated.notes, positionId: updated.positionId, isActive: updated.isActive } },
        });
      }
      return updated;
    }
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!user) throw new Error('Staff account could not be found.');
    if (changes.name !== undefined && !changes.name.trim()) throw new Error('Staff name is required.');
    if (changes.positionId && !getPositions().some((position) => position.id === changes.positionId && position.storeId === user.storeId)) {
      throw new Error('Select a position from this store.');
    }
    const updated = {
      ...user,
      ...changes,
      name: changes.name?.trim() ?? user.name,
      phone: changes.phone !== undefined ? changes.phone.trim() || undefined : user.phone,
      notes: changes.notes !== undefined ? changes.notes.trim() || undefined : user.notes,
    };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    if (changes.positionId !== undefined) notifyPermissionsChanged();
    await logUserMutation({
      storeId: user.storeId ?? '',
      action: changes.positionId !== undefined ? 'staff.permission_changed' : 'staff.updated',
      summary: `Updated staff account "${updated.name}".`,
      entityType: 'staff',
      entityId: user.id,
      before: { name: user.name, phone: user.phone, notes: user.notes, positionId: user.positionId, isActive: user.isActive },
      after: { name: updated.name, phone: updated.phone, notes: updated.notes, positionId: updated.positionId, isActive: updated.isActive },
    });
    const updatedUser = await this.getUser(userId);
    if (!updatedUser) throw new Error('Updated staff account could not be loaded.');
    return updatedUser;
  },

  async listPositions(storeId: string): Promise<PositionRecord[]> {
    if (isSupabaseDriver()) {
      const { data, error } = await getSupabaseClient()
        .from('positions')
        .select('id, store_id, name, permission_ids, self_service_item_ids, self_service_category_ids, max_staff_drink_quantity_per_shift')
        .eq('store_id', storeId)
        .order('name');
      if (error) throw new Error(`Could not load positions: ${error.message}`, { cause: error });
      return (data ?? []).map((row) => positionFromRow(row));
    }
    return getPositions().filter((position) => position.storeId === storeId);
  },

  async listPermissionDefinitions(): Promise<PermissionDefinition[]> {
    return PERMISSIONS;
  },

  async getEffectivePermissions(userId: string): Promise<string[]> {
    if (isSupabaseDriver()) {
      const { data: sessionData, error: sessionError } = await getSupabaseClient().auth.getSession();
      if (sessionError) throw new Error(`Could not load the active session: ${sessionError.message}`, { cause: sessionError });
      if (!sessionData.session) throw new Error('An active sign-in is required to read permissions.');
      if (sessionData.session.user.id === userId) {
        const { data, error } = await getSupabaseClient().rpc('get_store_permissions');
        if (error) throw new Error(`Could not load effective permissions: ${error.message}`, { cause: error });
        if (!Array.isArray(data) || data.some((permissionId) => typeof permissionId !== 'string')) {
          throw new Error('The server returned an invalid effective permission list.');
        }
        return data;
      }
      const user = await getProfile(userId);
      if (!user || user.role !== 'staff' || !user.storeId) return [];
      const [{ data: position, error: positionError }, overrides] = await Promise.all([
        user.positionId
          ? getSupabaseClient().from('positions').select('permission_ids').eq('id', user.positionId).eq('store_id', user.storeId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        getPermissionOverrides(user.id),
      ]);
      if (positionError) throw new Error(`Could not load staff position: ${positionError.message}`, { cause: positionError });
      const permissions = new Set([
        ...((position?.permission_ids as string[] | undefined) ?? []),
        ...(overrides?.granted ?? []),
      ]);
      for (const permissionId of overrides?.revoked ?? []) permissions.delete(permissionId);
      return [...permissions];
    }
    const user = getUsers().find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!user) return [];
    const position = user.storeId && user.positionId
      ? getPositions().find((candidate) => candidate.id === user.positionId && candidate.storeId === user.storeId)
      : undefined;
    const permissions = new Set([
      ...(position?.permissionIds ?? []),
      ...(user.permissionOverrides?.granted ?? []),
    ]);
    for (const permissionId of user.permissionOverrides?.revoked ?? []) permissions.delete(permissionId);
    return [...permissions];
  },

  async hasPermission(userId: string, permissionId: string): Promise<boolean> {
    if (isSupabaseDriver()) {
      const { data: authData, error } = await getSupabaseClient().auth.getUser();
      if (error || !authData.user) throw new Error('An active sign-in is required to check permissions.', { cause: error });
      if (authData.user.id === userId) {
        const { data, error: permissionError } = await getSupabaseClient().rpc('has_store_permission', { p_permission: permissionId });
        if (permissionError) throw new Error(`Could not verify permission: ${permissionError.message}`, { cause: permissionError });
        return data === true;
      }
    }
    return (await this.getEffectivePermissions(userId)).includes(permissionId);
  },

  async setPermissionOverrides(userId: string, overrides: { granted: string[]; revoked: string[] }): Promise<UserSummary> {
    if (isSupabaseDriver()) {
      const normalized = normalizePermissionOverrides(overrides);
      const user = await getProfile(userId);
      if (!user?.storeId) throw new Error('Staff account could not be found.');
      const { error } = await getSupabaseClient().from('permission_overrides').upsert({
        store_id: user.storeId,
        user_id: userId,
        granted: normalized.granted,
        revoked: normalized.revoked,
      });
      if (error) throw new Error(`Could not save permission overrides: ${error.message}`, { cause: error });
      notifyPermissionsChanged();
      const updated = await this.getUser(userId);
      if (!updated) throw new Error('Updated staff account could not be loaded.');
      return updated;
    }
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!user) throw new Error('Staff account could not be found.');
    const updated = {
      ...user,
      permissionOverrides: normalizePermissionOverrides(overrides),
    };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    notifyPermissionsChanged();
    await logUserMutation({
      storeId: user.storeId ?? '',
      action: 'staff.permission_changed',
      summary: `Changed permission overrides for "${user.name}".`,
      entityType: 'staff',
      entityId: user.id,
      before: user.permissionOverrides,
      after: updated.permissionOverrides,
    });
    return withoutPassword(updated);
  },

  async createPosition(
    storeId: string,
    name: string,
    permissionIds: string[],
    compRules: Pick<PositionRecord, 'selfServiceItemIds' | 'selfServiceCategoryIds' | 'maxStaffDrinkQuantityPerShift'> = {},
  ): Promise<PositionRecord> {
    if (isSupabaseDriver()) {
      if (!name.trim()) throw new Error('Position name is required.');
      validatePositionCompRules(compRules);
      const { data, error } = await getSupabaseClient().from('positions').insert({
        store_id: storeId,
        name: name.trim(),
        permission_ids: [...new Set(permissionIds)],
        self_service_item_ids: [...new Set(compRules.selfServiceItemIds ?? [])],
        self_service_category_ids: [...new Set(compRules.selfServiceCategoryIds ?? [])],
        max_staff_drink_quantity_per_shift: compRules.maxStaffDrinkQuantityPerShift ?? 0,
      }).select('id, store_id, name, permission_ids, self_service_item_ids, self_service_category_ids, max_staff_drink_quantity_per_shift').single();
      if (error) throw new Error(`Could not create position: ${error.message}`, { cause: error });
      const position = positionFromRow(data);
      await activityService.log({
        storeId,
        action: 'position.created',
        summary: `Created staff position "${position.name}".`,
        entityType: 'position',
        entityId: position.id,
        meta: { after: position },
      });
      return position;
    }
    if (!await this.getStore(storeId)) throw new Error('The store could not be found.');
    if (!name.trim()) throw new Error('Position name is required.');
    validatePositionCompRules(compRules);
    const position: PositionRecord = {
      id: createId('position'),
      storeId,
      name: name.trim(),
      permissionIds: [...new Set(permissionIds)],
      ...compRules,
      selfServiceItemIds: compRules.selfServiceItemIds ? [...new Set(compRules.selfServiceItemIds)] : [],
      selfServiceCategoryIds: compRules.selfServiceCategoryIds ? [...new Set(compRules.selfServiceCategoryIds)] : [],
      maxStaffDrinkQuantityPerShift: compRules.maxStaffDrinkQuantityPerShift ?? 0,
    };
    savePositions([...getPositions(), position]);
    await logUserMutation({
      storeId,
      action: 'position.created',
      summary: `Created staff position "${position.name}".`,
      entityType: 'position',
      entityId: position.id,
      after: position,
    });
    return position;
  },

  async updatePosition(positionId: string, changes: Partial<Pick<PositionRecord,
    'name' | 'permissionIds' | 'selfServiceItemIds' | 'selfServiceCategoryIds' | 'maxStaffDrinkQuantityPerShift'>>): Promise<PositionRecord> {
    if (isSupabaseDriver()) {
      if (changes.name !== undefined && !changes.name.trim()) throw new Error('Position name is required.');
      validatePositionCompRules(changes);
      const { data: current, error: loadError } = await getSupabaseClient().from('positions')
        .select('id, store_id, name, permission_ids, self_service_item_ids, self_service_category_ids, max_staff_drink_quantity_per_shift')
        .eq('id', positionId).maybeSingle();
      if (loadError) throw new Error(`Could not load position: ${loadError.message}`, { cause: loadError });
      if (!current) throw new Error('Position could not be found.');
      const { data, error } = await getSupabaseClient().from('positions').update({
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        ...(changes.permissionIds !== undefined ? { permission_ids: changes.permissionIds } : {}),
        ...(changes.selfServiceItemIds !== undefined ? { self_service_item_ids: changes.selfServiceItemIds } : {}),
        ...(changes.selfServiceCategoryIds !== undefined ? { self_service_category_ids: changes.selfServiceCategoryIds } : {}),
        ...(changes.maxStaffDrinkQuantityPerShift !== undefined ? { max_staff_drink_quantity_per_shift: changes.maxStaffDrinkQuantityPerShift } : {}),
      }).eq('id', positionId).select('id, store_id, name, permission_ids, self_service_item_ids, self_service_category_ids, max_staff_drink_quantity_per_shift').single();
      if (error) throw new Error(`Could not update position: ${error.message}`, { cause: error });
      notifyPermissionsChanged();
      const before = positionFromRow(current);
      const updated = positionFromRow(data);
      await activityService.log({
        storeId: before.storeId,
        action: 'staff.permission_changed',
        summary: `Changed permissions for position "${updated.name}".`,
        entityType: 'position',
        entityId: positionId,
        meta: { before, after: updated },
      });
      return updated;
    }
    const positions = getPositions();
    const position = positions.find((candidate) => candidate.id === positionId);
    if (!position) throw new Error('Position could not be found.');
    if (changes.name !== undefined && !changes.name.trim()) throw new Error('Position name is required.');
    validatePositionCompRules(changes);
    const updated = { ...position, ...changes, name: changes.name?.trim() ?? position.name };
    savePositions(positions.map((candidate) => candidate.id === positionId ? updated : candidate));
    notifyPermissionsChanged();
    await logUserMutation({
      storeId: position.storeId,
      action: 'staff.permission_changed',
      summary: `Changed permissions for position "${updated.name}".`,
      entityType: 'position',
      entityId: position.id,
      before: position,
      after: updated,
    });
    return updated;
  },

  async deletePosition(positionId: string, replacementPositionId?: string): Promise<void> {
    if (isSupabaseDriver()) {
      const { data: positionRow, error: positionError } = await getSupabaseClient().from('positions')
        .select('id, store_id, name, permission_ids, self_service_item_ids, self_service_category_ids, max_staff_drink_quantity_per_shift')
        .eq('id', positionId).maybeSingle();
      if (positionError) throw new Error(`Could not load position: ${positionError.message}`, { cause: positionError });
      if (!positionRow) throw new Error('Position could not be found.');
      const position = positionFromRow(positionRow);
      const { data: assignedStaff, error: assignedError } = await getSupabaseClient().from('profiles')
        .select('id')
        .eq('position_id', positionId)
        .eq('role', 'staff');
      if (assignedError) throw new Error(`Could not check assigned staff: ${assignedError.message}`, { cause: assignedError });
      if (assignedStaff?.length && !replacementPositionId) {
        throw new Error(`Move ${assignedStaff.length} staff to a replacement position before deleting this position.`);
      }
      if (assignedStaff?.length && replacementPositionId) {
        const { data: replacement, error: replacementError } = await getSupabaseClient().from('positions')
          .select('id')
          .eq('id', replacementPositionId)
          .eq('store_id', position.storeId)
          .maybeSingle();
        if (replacementError) throw new Error(`Could not load replacement position: ${replacementError.message}`, { cause: replacementError });
        if (!replacement || replacement.id === positionId) throw new Error('Select a replacement position from this store.');
        const { error: updateError } = await getSupabaseClient().from('profiles')
          .update({ position_id: replacement.id })
          .in('id', assignedStaff.map((staff) => staff.id));
        if (updateError) throw new Error(`Could not reassign staff: ${updateError.message}`, { cause: updateError });
      }
      const { error } = await getSupabaseClient().from('positions').delete().eq('id', positionId);
      if (error) throw new Error(`Could not delete position: ${error.message}`, { cause: error });
      notifyPermissionsChanged();
      await activityService.log({
        storeId: position.storeId,
        action: 'position.deleted',
        summary: `Deleted staff position "${position.name}".`,
        entityType: 'position',
        entityId: position.id,
        meta: { before: position, after: { replacementPositionId, reassignedStaffIds: assignedStaff?.map((staff) => staff.id) ?? [] } },
      });
      return;
    }
    const positions = getPositions();
    const position = positions.find((candidate) => candidate.id === positionId);
    if (!position) throw new Error('Position could not be found.');
    const users = getUsers();
    const assignedStaff = users.filter((candidate) => candidate.role === 'staff' && candidate.positionId === positionId);
    if (assignedStaff.length > 0) {
      if (!replacementPositionId) throw new Error(`Move ${assignedStaff.length} staff to a replacement position before deleting this position.`);
      const replacement = positions.find((candidate) =>
        candidate.id === replacementPositionId &&
        candidate.id !== positionId &&
        candidate.storeId === position.storeId,
      );
      if (!replacement) throw new Error('Select a replacement position from this store.');
      const updatedUsers = users.map((candidate) => candidate.role === 'staff' && candidate.positionId === positionId
        ? { ...candidate, positionId: replacement.id }
        : candidate);
      saveUsers(updatedUsers);
    }
    savePositions(positions.filter((candidate) => candidate.id !== positionId));
    notifyPermissionsChanged();
    await logUserMutation({
      storeId: position.storeId,
      action: 'position.deleted',
      summary: `Deleted staff position "${position.name}".`,
      entityType: 'position',
      entityId: position.id,
      before: position,
      after: { replacementPositionId, reassignedStaffIds: assignedStaff.map((staff) => staff.id) },
    });
  },

  async updateStorePin(storeId: string, pin: string): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      if (!/^\d{4}$/.test(pin)) throw new Error('Admin PIN must contain exactly 4 digits.');
      const store = await getRemoteStore(storeId);
      if (!store) throw new Error('The store could not be found.');
      const { error } = await getSupabaseClient().rpc('set_store_admin_pin', { p_store_id: storeId, p_pin: pin });
      if (error) throw new Error(`Could not update Admin PIN: ${error.message}`, { cause: error });
      await activityService.log({
        storeId,
        action: 'store.pin_changed',
        summary: 'Changed the store Admin PIN.',
        entityType: 'store',
        entityId: store.id,
        meta: { before: { pinMustChange: store.pinMustChange }, after: { pinMustChange: false } },
      });
      return { ...store, pinMustChange: false };
    }
    if (!/^\d{4}$/.test(pin)) throw new Error('Admin PIN must contain exactly 4 digits.');
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    const updated = { ...store, adminPin: undefined, adminPinHash: await hashSecret(pin), pinMustChange: false };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      action: 'store.pin_changed',
      summary: 'Changed the store Admin PIN.',
      entityType: 'store',
      entityId: store.id,
      before: { pinMustChange: store.pinMustChange },
      after: { pinMustChange: false },
    });
    return updated;
  },

  async verifyStorePin(storeId: string, pin: string, purpose: 'credit_override' | 'void' | 'z_report' = 'credit_override'): Promise<boolean> {
    if (isSupabaseDriver()) {
      const { data, error } = await getSupabaseClient().rpc('verify_store_pin', {
        p_store_id: storeId,
        p_pin: pin,
        p_purpose: purpose,
      });
      if (error) {
        if (error.message.includes('temporarily locked')) throw new Error('PIN verification is temporarily locked.');
        throw new Error(`Could not verify the Admin PIN: ${error.message}`, { cause: error });
      }
      return data === true;
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) return false;
    const result = await verifySecret(store.adminPinHash ?? store.adminPin, pin);
    if (result.valid && result.needsRehash) {
      const updated = { ...store, adminPin: undefined, adminPinHash: await hashSecret(pin) };
      saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    }
    return result.valid;
  },

  async updateOwnerProfile(ownerId: string, changes: { name: string; phone: string }): Promise<UserSummary> {
    const name = changes.name.trim();
    const phone = changes.phone.trim();
    if (!name || name.length > 200) throw new Error('Owner name is required and must be 200 characters or fewer.');
    if (phone.length > 100) throw new Error('Phone must be 100 characters or fewer.');
    if (isSupabaseDriver()) {
      const client = getSupabaseClient();
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || authData.user?.id !== ownerId) {
        throw new Error('Only the signed-in store owner can update this profile.', { cause: authError });
      }
      const { error } = await client.rpc('update_owner_profile', {
        p_name: name,
        p_phone: phone || null,
      });
      if (error) throw new Error(`Could not update owner profile: ${error.message}`, { cause: error });
      const updatedOwner = await getProfile(ownerId);
      if (!updatedOwner || updatedOwner.role !== 'owner') throw new Error('The updated owner profile could not be loaded.');
      return updatedOwner;
    }
    const currentUser = await authService.getCurrentUser();
    if (!currentUser || currentUser.id !== ownerId || currentUser.role !== 'owner') {
      throw new Error('Only the signed-in store owner can update this profile.');
    }
    const users = getUsers();
    const owner = users.find((candidate) =>
      candidate.id === ownerId && candidate.role === 'owner' && candidate.storeId === currentUser.storeId,
    );
    if (!owner) throw new Error('The owner profile could not be found.');
    const updatedOwner = { ...owner, name, phone: phone || undefined };
    saveUsers(users.map((candidate) => candidate.id === ownerId ? updatedOwner : candidate));
    if (owner.storeId) {
      await logUserMutation({
        storeId: owner.storeId,
        actorId: owner.id,
        action: 'owner.profile_changed',
        summary: 'Updated owner profile details.',
        entityType: 'owner',
        entityId: owner.id,
        before: { name: owner.name, phone: owner.phone },
        after: { name, phone: phone || undefined },
      });
    }
    return withoutPassword(updatedOwner);
  },

  async updateProfileAvatar(userId: string, avatarId: ProfileAvatarId): Promise<UserSummary> {
    if (!isProfileAvatarId(avatarId)) throw new Error('Choose one of the available profile avatars.');
    const currentUser = await authService.getCurrentUser();
    if (!currentUser || currentUser.id !== userId) {
      throw new Error('Only the signed-in user can update this profile avatar.');
    }
    if (isSupabaseDriver()) {
      const { error } = await getSupabaseClient().rpc('update_profile_avatar', { p_avatar_id: avatarId });
      if (error) throw new Error(`Could not update profile avatar: ${error.message}`, { cause: error });
      const updatedUser = await getProfile(userId);
      if (!updatedUser) throw new Error('The updated profile could not be loaded.');
      return updatedUser;
    }
    const users = getUsers();
    const profile = users.find((candidate) => candidate.id === userId);
    if (!profile) throw new Error('The profile could not be found.');
    const updatedUser = { ...profile, avatarId };
    saveUsers(users.map((candidate) => candidate.id === userId ? updatedUser : candidate));
    return withoutPassword(updatedUser);
  },

  async updateStoreInfo(
    storeId: string,
    ownerId: string,
    changes: { name?: string; dailySalesTargetMillimes?: number; address?: string; phone?: string; taxId?: string },
  ): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      if (changes.name !== undefined && !changes.name.trim()) throw new Error('Store name is required.');
      if (changes.dailySalesTargetMillimes !== undefined &&
        (!Number.isSafeInteger(changes.dailySalesTargetMillimes) || changes.dailySalesTargetMillimes < 0)) {
        throw new Error('Daily sales target must be a non-negative amount in millimes.');
      }
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can update store information.');
      const { error } = await getSupabaseClient().from('stores').update({
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        ...(changes.dailySalesTargetMillimes !== undefined ? { daily_sales_target_millimes: changes.dailySalesTargetMillimes } : {}),
        ...(changes.address !== undefined ? { address: changes.address.trim() || null } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone.trim() || null } : {}),
        ...(changes.taxId !== undefined ? { tax_id: changes.taxId.trim() || null } : {}),
      }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update store information: ${error.message}`, { cause: error });
      const updated = { ...store, ...changes, name: changes.name?.trim() ?? store.name };
      await activityService.log({
        storeId,
        actorId: ownerId,
        action: 'store.settings_changed',
        summary: 'Updated store information.',
        entityType: 'store',
        entityId: storeId,
        meta: {
          before: { name: store.name, dailySalesTargetMillimes: store.dailySalesTargetMillimes },
          after: { name: updated.name, dailySalesTargetMillimes: updated.dailySalesTargetMillimes },
        },
      });
      return updated;
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error('Only this store owner can update store information.');
    }
    if (changes.name !== undefined && !changes.name.trim()) throw new Error('Store name is required.');
    if (changes.dailySalesTargetMillimes !== undefined &&
      (!Number.isSafeInteger(changes.dailySalesTargetMillimes) || changes.dailySalesTargetMillimes < 0)) {
      throw new Error('Daily sales target must be a non-negative amount in millimes.');
    }
    const updated = { ...store, ...changes, name: changes.name?.trim() ?? store.name };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary: 'Updated store information.',
      entityType: 'store',
      entityId: store.id,
      before: { name: store.name, dailySalesTargetMillimes: store.dailySalesTargetMillimes },
      after: { name: updated.name, dailySalesTargetMillimes: updated.dailySalesTargetMillimes },
    });
    return updated;
  },

  async updateCustomerCreditBalanceSetting(storeId: string, ownerId: string, allowed: boolean): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can change customer credit settings.');
      const { error } = await getSupabaseClient().from('stores').update({ allow_customer_credit_balance: allowed }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update customer credit settings: ${error.message}`, { cause: error });
      const updated = { ...store, allowCustomerCreditBalance: allowed };
      await activityService.log({
        storeId,
        actorId: ownerId,
        action: 'store.settings_changed',
        summary: 'Updated customer credit balance settings.',
        entityType: 'store',
        entityId: storeId,
        meta: { before: { allowCustomerCreditBalance: store.allowCustomerCreditBalance }, after: { allowCustomerCreditBalance: allowed } },
      });
      return updated;
    }
    const store = getStores().find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error('Only this store owner can change customer credit settings.');
    }
    const updated = { ...store, allowCustomerCreditBalance: allowed };
    saveStores(getStores().map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary: 'Updated customer credit balance settings.',
      entityType: 'store',
      entityId: store.id,
      before: { allowCustomerCreditBalance: store.allowCustomerCreditBalance },
      after: { allowCustomerCreditBalance: updated.allowCustomerCreditBalance },
    });
    return updated;
  },

  async updateStorePaymentSettings(
    storeId: string,
    ownerId: string,
    changes: Pick<StoreRecord, 'allowCardPayments' | 'allowOtherPayments'>,
  ): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can change POS payment methods.');
      const { error } = await getSupabaseClient().from('stores').update({
        ...(changes.allowCardPayments !== undefined ? { allow_card_payments: changes.allowCardPayments } : {}),
        ...(changes.allowOtherPayments !== undefined ? { allow_other_payments: changes.allowOtherPayments } : {}),
      }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update payment settings: ${error.message}`, { cause: error });
      const updated = { ...store, ...changes };
      await activityService.log({
        storeId,
        actorId: ownerId,
        action: 'store.settings_changed',
        summary: 'Updated accepted payment methods.',
        entityType: 'store',
        entityId: storeId,
        meta: {
          before: { allowCardPayments: store.allowCardPayments, allowOtherPayments: store.allowOtherPayments },
          after: { allowCardPayments: updated.allowCardPayments, allowOtherPayments: updated.allowOtherPayments },
        },
      });
      return updated;
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error('Only this store owner can change POS payment methods.');
    }
    const updated = { ...store, ...changes };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary: 'Updated accepted payment methods.',
      entityType: 'store',
      entityId: store.id,
      before: { allowCardPayments: store.allowCardPayments, allowOtherPayments: store.allowOtherPayments },
      after: { allowCardPayments: updated.allowCardPayments, allowOtherPayments: updated.allowOtherPayments },
    });
    return updated;
  },

  async updateStoreAutoLockMinutes(storeId: string, ownerId: string, minutes: number): Promise<StoreRecord> {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      throw new Error('Auto-lock timeout must be between 1 and 60 minutes.');
    }
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can change the staff auto-lock timeout.');
      const { error } = await getSupabaseClient().from('stores').update({ staff_auto_lock_minutes: minutes }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update auto-lock timeout: ${error.message}`, { cause: error });
      const updated = { ...store, staffAutoLockMinutes: minutes };
      await activityService.log({
        storeId,
        actorId: ownerId,
        action: 'store.settings_changed',
        summary: 'Updated staff auto-lock timeout.',
        entityType: 'store',
        entityId: storeId,
        meta: { before: { staffAutoLockMinutes: store.staffAutoLockMinutes }, after: { staffAutoLockMinutes: minutes } },
      });
      return updated;
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error('Only this store owner can change the staff auto-lock timeout.');
    }
    const updated = { ...store, staffAutoLockMinutes: minutes };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary: 'Updated staff auto-lock timeout.',
      entityType: 'store',
      entityId: store.id,
      before: { staffAutoLockMinutes: store.staffAutoLockMinutes },
      after: { staffAutoLockMinutes: updated.staffAutoLockMinutes },
    });
    return updated;
  },

  async updateCashOutAlertThreshold(storeId: string, ownerId: string, thresholdMillimes: number): Promise<StoreRecord> {
    if (!Number.isSafeInteger(thresholdMillimes) || thresholdMillimes < 0) {
      throw new Error('Cash-out alert threshold must be a non-negative amount in millimes.');
    }
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can change the cash-out alert threshold.');
      const { error } = await getSupabaseClient().from('stores').update({ cash_out_alert_threshold_millimes: thresholdMillimes }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update cash-out threshold: ${error.message}`, { cause: error });
      const updated = { ...store, cashOutAlertThresholdMillimes: thresholdMillimes };
      await activityService.log({
        storeId,
        actorId: ownerId,
        action: 'store.settings_changed',
        summary: 'Updated the cash-out alert threshold.',
        entityType: 'store',
        entityId: storeId,
        meta: {
          before: { cashOutAlertThresholdMillimes: store.cashOutAlertThresholdMillimes },
          after: { cashOutAlertThresholdMillimes: thresholdMillimes },
        },
      });
      return updated;
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error('Only this store owner can change the cash-out alert threshold.');
    }
    const updated = { ...store, cashOutAlertThresholdMillimes: thresholdMillimes };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary: 'Updated the cash-out alert threshold.',
      entityType: 'store',
      entityId: store.id,
      before: { cashOutAlertThresholdMillimes: store.cashOutAlertThresholdMillimes },
      after: { cashOutAlertThresholdMillimes: updated.cashOutAlertThresholdMillimes },
    });
    return updated;
  },

  async suspendStore(storeId: string, isActive: boolean): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store) throw new Error('The store could not be found.');
      const { error } = await getSupabaseClient().from('stores').update({ is_active: isActive }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update store status: ${error.message}`, { cause: error });
      await activityService.log({
        storeId,
        action: 'store.status_changed',
        summary: `${isActive ? 'Activated' : 'Suspended'} store "${store.name}".`,
        entityType: 'store',
        entityId: store.id,
        meta: { before: { isActive: store.isActive }, after: { isActive } },
      });
      return { ...store, isActive };
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    const updated = { ...store, isActive };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      action: 'store.status_changed',
      summary: `${isActive ? 'Activated' : 'Suspended'} store "${store.name}".`,
      entityType: 'store',
      entityId: store.id,
      before: { isActive: store.isActive },
      after: { isActive: updated.isActive },
    });
    return updated;
  },

  async suspendOwner(userId: string, isActive: boolean): Promise<UserSummary> {
    if (isSupabaseDriver()) {
      const { error } = await getSupabaseClient().from('profiles').update({ is_active: isActive }).eq('id', userId).eq('role', 'owner');
      if (error) throw new Error(`Could not update owner account: ${error.message}`, { cause: error });
      const updated = await getProfile(userId);
      if (!updated) throw new Error('Updated owner account could not be loaded.');
      if (updated.storeId) {
        await activityService.log({
          storeId: updated.storeId,
          action: 'owner.status_changed',
          summary: `${isActive ? 'Activated' : 'Suspended'} owner "${updated.name}".`,
          entityType: 'owner',
          entityId: updated.id,
          meta: { after: { isActive: updated.isActive } },
        });
      }
      return updated;
    }
    const users = getUsers();
    const owner = users.find((candidate) => candidate.id === userId && candidate.role === 'owner');
    if (!owner) throw new Error('Owner account could not be found.');
    const updated = { ...owner, isActive };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    if (owner.storeId) {
      await logUserMutation({
        storeId: owner.storeId,
        action: 'owner.status_changed',
        summary: `${isActive ? 'Activated' : 'Suspended'} owner "${owner.name}".`,
        entityType: 'owner',
        entityId: owner.id,
        before: { isActive: owner.isActive },
        after: { isActive: updated.isActive },
      });
    }
    const updatedUser = await this.getUser(userId);
    if (!updatedUser) throw new Error('Updated owner account could not be loaded.');
    return updatedUser;
  },
};
