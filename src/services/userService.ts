import type { PermissionDefinition, PositionRecord, StoreRecord, UserRecord, UserSummary } from '../types/domain';
import { readData, writeData } from './storage';
import { seedPositions, seedStores, seedUsers } from './seedData';

const PERMISSIONS: PermissionDefinition[] = [
  { id: 'take_orders', label: 'Take orders' },
  { id: 'request_void', label: 'Request void' },
  { id: '86_items', label: '86 items' },
  { id: 'open_close_shift', label: 'Open / close shift' },
  { id: 'view_order_history', label: 'View order history' },
];

const getUsers = () => readData('users', seedUsers);
const getStores = () => readData('stores', seedStores);
const getPositions = () => readData('positions', seedPositions);
const saveUsers = (value: UserRecord[]) => writeData('users', value);
const saveStores = (value: StoreRecord[]) => writeData('stores', value);
const savePositions = (value: PositionRecord[]) => writeData('positions', value);

function makeTemporaryPassword(): string {
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => (value % 10).toString()).join('');
}

function slugify(name: string): string {
  return name.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function withoutPassword(user: UserRecord): UserSummary {
  const { password: _password, ...safeUser } = user;
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

  async createOwnerAccount(input: { name: string; email: string; storeName: string; storeCode: string }): Promise<{ owner: UserSummary; store: StoreRecord; temporaryPassword: string }> {
    const users = getUsers();
    if (users.some((user) => user.email?.toLocaleLowerCase() === input.email.toLocaleLowerCase())) {
      throw new Error('An account already uses this email address.');
    }
    const code = input.storeCode.trim().toLocaleLowerCase();
    if (!code || getStores().some((store) => store.code === code)) throw new Error('Store code is empty or already in use.');

    const temporaryPassword = makeTemporaryPassword();
    const ownerId = createId('owner');
    const store: StoreRecord = {
      id: createId('store'),
      ownerId,
      code,
      name: input.storeName.trim(),
      adminPin: '1234',
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    const owner: UserRecord = {
      id: ownerId,
      role: 'owner',
      name: input.name.trim(),
      email: input.email.trim(),
      password: temporaryPassword,
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

  async createStaff(input: { storeId: string; name: string; positionId: string }): Promise<{ staff: UserSummary; temporaryPassword: string }> {
    const name = input.name.trim();
    const store = await this.getStore(input.storeId);
    if (!store) throw new Error('The store could not be found.');
    if (!getPositions().some((position) => position.id === input.positionId && position.storeId === input.storeId)) {
      throw new Error('Select a position from this store.');
    }
    const username = `${store.code}.${slugify(name)}`;
    if (!name || getUsers().some((user) => user.username === username)) throw new Error('Name is empty or this generated username already exists.');
    const temporaryPassword = makeTemporaryPassword();
    const staff: UserRecord = {
      id: createId('staff'),
      role: 'staff',
      name,
      username,
      password: temporaryPassword,
      mustChangePassword: true,
      isActive: true,
      storeId: input.storeId,
      positionId: input.positionId,
      createdAt: new Date().toISOString(),
    };
    saveUsers([...getUsers(), staff]);
    const staffSummary = await this.getUser(staff.id);
    if (!staffSummary) throw new Error('The new staff account could not be loaded.');
    return { staff: staffSummary, temporaryPassword };
  },

  async updateStaff(userId: string, changes: { name?: string; positionId?: string; isActive?: boolean }): Promise<UserSummary> {
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!user) throw new Error('Staff account could not be found.');
    if (changes.positionId && !getPositions().some((position) => position.id === changes.positionId && position.storeId === user.storeId)) {
      throw new Error('Select a position from this store.');
    }
    const updated = { ...user, ...changes };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
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

  async hasPermission(userId: string, permissionId: string): Promise<boolean> {
    const user = getUsers().find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!user?.storeId || !user.positionId) return false;
    return getPositions().some((position) =>
      position.id === user.positionId &&
      position.storeId === user.storeId &&
      position.permissionIds.includes(permissionId),
    );
  },

  async createPosition(storeId: string, name: string, permissionIds: string[]): Promise<PositionRecord> {
    if (!await this.getStore(storeId)) throw new Error('The store could not be found.');
    if (!name.trim()) throw new Error('Position name is required.');
    const position: PositionRecord = { id: createId('position'), storeId, name: name.trim(), permissionIds: [...new Set(permissionIds)] };
    savePositions([...getPositions(), position]);
    return position;
  },

  async updatePosition(positionId: string, changes: { name?: string; permissionIds?: string[] }): Promise<PositionRecord> {
    const positions = getPositions();
    const position = positions.find((candidate) => candidate.id === positionId);
    if (!position) throw new Error('Position could not be found.');
    const updated = { ...position, ...changes };
    savePositions(positions.map((candidate) => candidate.id === positionId ? updated : candidate));
    return updated;
  },

  async updateStorePin(storeId: string, pin: string): Promise<StoreRecord> {
    if (!/^\d{4}$/.test(pin)) throw new Error('Admin PIN must contain exactly 4 digits.');
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    const updated = { ...store, adminPin: pin };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    return updated;
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
