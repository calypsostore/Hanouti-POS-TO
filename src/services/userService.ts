import { resolveStoreSettings, type PermissionDefinition, type PermissionOverrides, type PositionRecord, type StoreRecord, type StoreSettings, type StoreSubscription, type UserRecord, type UserSummary } from '../types/domain';
import { readData, removeData, writeData } from './storage';
import { seedPositions, seedStores, seedUsers } from './seedData';
import { hashSecret, verifySecret } from './secretService';
import { activityService } from './activityService';

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
  { id: 'view_schedule', group: 'Other', label: 'View schedule' },
  { id: 'view_own_hours', group: 'Other', label: 'View own hours' },
];

const getUsers = () => readData('users', seedUsers);
const getStores = () => readData('stores', seedStores);
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

function randomDigits(length: number): string {
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => (value % 10).toString()).join('');
}

const STAFF_TEMPORARY_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function makeStaffTemporaryPassword(): string {
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => STAFF_TEMPORARY_PASSWORD_ALPHABET[value % STAFF_TEMPORARY_PASSWORD_ALPHABET.length]).join('');
}

function slugify(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}

function formatStaffUsername(storeCode: string, name: string, suffix: string): string {
  const firstName = name.trim().split(/\s+/)[0] ?? '';
  return `${storeCode}.${slugify(firstName)}${suffix}`;
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

function withoutPassword(user: UserRecord): UserSummary {
  const { password: _password, passwordHash: _passwordHash, pinHash: _pinHash, ...safeUser } = user;
  return safeUser;
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
    return getUsers().filter((user) => !storeId || user.storeId === storeId).map(withoutPassword);
  },

  async getUser(userId: string): Promise<UserSummary | undefined> {
    const user = getUsers().find((candidate) => candidate.id === userId);
    if (!user) return undefined;
    return withoutPassword(user);
  },

  async getStore(storeId: string): Promise<StoreRecord | undefined> {
    return getStores().find((store) => store.id === storeId);
  },

  async updateStoreSettings(
    storeId: string,
    ownerId: string,
    changes: {
      defaultSettlementTerms?: StoreSettings['defaultSettlementTerms'];
      notificationPreferences?: Partial<StoreSettings['notificationPreferences']>;
    },
  ): Promise<StoreRecord> {
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
    const currentSettings = resolveStoreSettings(store.settings);
    const settings: StoreSettings = {
      ...currentSettings,
      ...changes,
      notificationPreferences: {
        ...currentSettings.notificationPreferences,
        ...changes.notificationPreferences,
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
    return getStores();
  },

  async updateStoreNameAsAdmin(storeId: string, actorId: string, name: string): Promise<StoreRecord> {
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

  async createOwnerAccount(input: { name: string; email: string; storeName: string; storeCode: string }): Promise<{ owner: UserSummary; store: StoreRecord; temporaryPassword: string }> {
    const users = getUsers();
    if (users.some((user) => user.email?.toLocaleLowerCase() === input.email.toLocaleLowerCase())) {
      throw new Error('An account already uses this email address.');
    }
    const code = input.storeCode.trim().toLocaleLowerCase();
    if (!code || getStores().some((store) => store.code === code)) throw new Error('Store code is empty or already in use.');

    const temporaryPassword = makeTemporaryPassword();
    const ownerId = createId('owner');
    const defaultPinHash = await hashSecret('1234');
    const store: StoreRecord = {
      id: createId('store'),
      ownerId,
      code,
      name: input.storeName.trim(),
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

  generateStaffUsernameSuffix(): string {
    return randomDigits(3);
  },

  formatStaffUsername(storeCode: string, name: string, suffix: string): string {
    return formatStaffUsername(storeCode, name, suffix);
  },

  generateStaffTemporaryPassword(): string {
    return makeStaffTemporaryPassword();
  },

  async createStaff(input: {
    storeId: string;
    name: string;
    phone?: string;
    notes?: string;
    positionId: string;
    temporaryPassword?: string;
    permissionOverrides?: PermissionOverrides;
    usernameSuffix?: string;
  }): Promise<{ staff: UserSummary; temporaryPassword: string }> {
    const name = input.name.trim();
    const store = await this.getStore(input.storeId);
    if (!store) throw new Error('The store could not be found.');
    if (!getPositions().some((position) => position.id === input.positionId && position.storeId === input.storeId)) {
      throw new Error('Select a position from this store.');
    }
    if (!name) throw new Error('Staff name is required.');
    const users = getUsers();
    let username: string;
    if (input.usernameSuffix !== undefined && !/^\d{3}$/.test(input.usernameSuffix)) {
      throw new Error('Username suffix must contain exactly 3 digits.');
    }
    username = input.usernameSuffix === undefined ? '' : formatStaffUsername(store.code, name, input.usernameSuffix);
    if (!username || users.some((user) => user.username === username)) {
      do {
        username = formatStaffUsername(store.code, name, randomDigits(3));
      } while (users.some((user) => user.username === username));
    }
    const temporaryPassword = input.temporaryPassword ?? makeStaffTemporaryPassword();
    if (temporaryPassword.length !== 6 || [...temporaryPassword].some((character) => !STAFF_TEMPORARY_PASSWORD_ALPHABET.includes(character))) {
      throw new Error('Temporary password must contain 6 readable characters.');
    }
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
    const users = getUsers();
    const staff = users.find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!staff) throw new Error('Staff account could not be found.');
    const temporaryPassword = makeStaffTemporaryPassword();
    const updated = {
      ...staff,
      passwordHash: await hashSecret(temporaryPassword),
      password: undefined,
      mustChangePassword: true,
    };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    await logUserMutation({
      storeId: staff.storeId ?? '',
      action: 'staff.password_reset',
      summary: `Reset the password for "${staff.name}".`,
      entityType: 'staff',
      entityId: staff.id,
      before: { mustChangePassword: staff.mustChangePassword },
      after: { mustChangePassword: true },
    });
    return temporaryPassword;
  },

  async resetOwnerPassword(ownerId: string, actorId: string): Promise<string> {
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
      after: { mustChangePassword: true },
    });
    return temporaryPassword;
  },

  async resetStaffPin(ownerId: string, staffId: string, pin: string): Promise<void> {
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain exactly 4 digits.');
    const users = getUsers();
    const owner = users.find((candidate) => candidate.id === ownerId && candidate.role === 'owner');
    const staff = users.find((candidate) => candidate.id === staffId && candidate.role === 'staff');
    const store = owner?.storeId ? getStores().find((candidate) => candidate.id === owner.storeId) : undefined;
    if (!owner || !staff || !store || store.ownerId !== owner.id || owner.storeId !== staff.storeId) {
      throw new Error('Only this store owner can reset this staff PIN.');
    }
    const pinHash = await hashSecret(pin);
    saveUsers(users.map((candidate) => candidate.id === staffId ? { ...candidate, pinHash } : candidate));
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
    return getPositions().filter((position) => position.storeId === storeId);
  },

  async listPermissionDefinitions(): Promise<PermissionDefinition[]> {
    return PERMISSIONS;
  },

  async getEffectivePermissions(userId: string): Promise<string[]> {
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
    return (await this.getEffectivePermissions(userId)).includes(permissionId);
  },

  async setPermissionOverrides(userId: string, overrides: { granted: string[]; revoked: string[] }): Promise<UserSummary> {
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

  async verifyStorePin(storeId: string, pin: string): Promise<boolean> {
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

  async updateStoreInfo(
    storeId: string,
    ownerId: string,
    changes: { name?: string; dailySalesTargetMillimes?: number },
  ): Promise<StoreRecord> {
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
