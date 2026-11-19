import type { PermissionDefinition, PermissionOverrides, PositionRecord, StoreRecord, UserRecord, UserSummary } from '../types/domain';
import { readData, removeData, writeData } from './storage';
import { seedPositions, seedStores, seedUsers } from './seedData';
import { hashSecret, verifySecret } from './secretService';

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

function withoutPassword(user: UserRecord): UserSummary {
  const { password: _password, passwordHash: _passwordHash, pinHash: _pinHash, ...safeUser } = user;
  return safeUser;
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

  async listStores(): Promise<StoreRecord[]> {
    return getStores();
  },

  async clearDayClosed(storeId: string): Promise<void> {
    const stores = getStores();
    if (!stores.some((store) => store.id === storeId)) throw new Error('The store could not be found.');
    saveStores(stores.map((store) => store.id === storeId ? { ...store, dayClosedOn: undefined } : store));
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
  },

  async forceLogoutStaff(userId: string): Promise<void> {
    const users = getUsers();
    const staff = users.find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!staff) throw new Error('Staff account could not be found.');
    const updated = { ...staff, sessionVersion: (staff.sessionVersion ?? 0) + 1 };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
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
  },

  async updateStorePin(storeId: string, pin: string): Promise<StoreRecord> {
    if (!/^\d{4}$/.test(pin)) throw new Error('Admin PIN must contain exactly 4 digits.');
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    const updated = { ...store, adminPin: undefined, adminPinHash: await hashSecret(pin), pinMustChange: false };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
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

  async updateStoreInfo(storeId: string, changes: { name?: string }): Promise<StoreRecord> {
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    if (changes.name !== undefined && !changes.name.trim()) throw new Error('Store name is required.');
    const updated = { ...store, ...changes, name: changes.name?.trim() ?? store.name };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
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
    return updated;
  },

  async suspendStore(storeId: string, isActive: boolean): Promise<StoreRecord> {
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    const updated = { ...store, isActive };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    return updated;
  },

  async suspendOwner(userId: string, isActive: boolean): Promise<UserSummary> {
    const users = getUsers();
    const owner = users.find((candidate) => candidate.id === userId && candidate.role === 'owner');
    if (!owner) throw new Error('Owner account could not be found.');
    const updated = { ...owner, isActive };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    const updatedUser = await this.getUser(userId);
    if (!updatedUser) throw new Error('Updated owner account could not be loaded.');
    return updatedUser;
  },
};
