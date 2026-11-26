import { isSubscriptionExpired, type AuthSession, type UserRecord, type UserSummary } from '../types/domain';
import { readData, removeData, writeData } from './storage';
import { seedStores, seedUsers } from './seedData';
import { hashSecret, verifySecret } from './secretService';
import { activityService } from './activityService';
import { authRepository } from '../data/repositories/authRepository';
import { isSupabaseDriver } from '../data/driver';
import { migrateLegacyDemoStoreIdentity } from './accountIdentity';

const USERS_KEY = 'users';
const SESSION_KEY = 'auth-session';
const SESSION_LOCK_KEY = '7anouti-pos:auth-locked-user';
const PIN_ATTEMPTS_PREFIX = 'staff-pin-attempts:';
const PIN_LOCKOUT_MS = 60_000;

interface PinAttemptState {
  count: number;
  lockedUntil?: number;
}

function getPinAttempts(userId: string): PinAttemptState {
  return readData(PIN_ATTEMPTS_PREFIX + userId, { count: 0 });
}

function getSessionStorageLock(userId: string): boolean {
  return typeof window !== 'undefined' && window.sessionStorage.getItem(SESSION_LOCK_KEY) === userId;
}

function clearSessionStorageLock(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(SESSION_LOCK_KEY);
}

function getUsers(): UserRecord[] {
  migrateLegacyDemoStoreIdentity();
  return readData(USERS_KEY, seedUsers);
}

function saveUsers(users: UserRecord[]): void {
  writeData(USERS_KEY, users);
}

function isAccountActive(user: UserRecord): boolean {
  if (!user.isActive) return false;
  if (!user.storeId) return true;
  return readData('stores', seedStores).some((store) =>
    store.id === user.storeId && store.isActive && !store.archivedAt && !isSubscriptionExpired(store),
  );
}

function withoutPassword(user: UserRecord): UserSummary {
  const { password: _password, passwordHash: _passwordHash, pinHash: _pinHash, ...safeUser } = user;
  const store = user.role === 'owner' && user.storeId
    ? readData('stores', seedStores).find((candidate) => candidate.id === user.storeId)
    : undefined;
  return {
    ...safeUser,
    mustSetPin: (user.role === 'staff' || user.role === 'owner')
      ? user.mustSetPin ?? (user.mustChangePassword || !user.pinHash)
      : false,
    mustSetVoidPin: user.role === 'owner' && Boolean(store?.pinMustChange),
  };
}

async function verifyPersonalPin(user: UserRecord, pin: string): Promise<void> {
  const attempts = getPinAttempts(user.id);
  const remaining = Math.max(0, (attempts.lockedUntil ?? 0) - Date.now());
  if (remaining > 0) throw new Error(`PIN locked. Try again in ${Math.ceil(remaining / 1000)} seconds.`);
  if (!user.pinHash) throw new Error('No PIN is set for this account. Use your password instead.');
  const result = await verifySecret(user.pinHash, pin);
  if (!result.valid) {
    const count = attempts.count + 1;
    const lockedUntil = count >= 5 ? Date.now() + PIN_LOCKOUT_MS : undefined;
    writeData<PinAttemptState>(PIN_ATTEMPTS_PREFIX + user.id, { count: lockedUntil ? 0 : count, lockedUntil });
    if (lockedUntil) throw new Error('Five incorrect PINs. Try again in 60 seconds.');
    throw new Error('Incorrect PIN.');
  }
  removeData(PIN_ATTEMPTS_PREFIX + user.id);
}

export const authService = {
  async login(identifier: string, password: string, acceptedRoles?: UserRecord['role'][] , keepSignedIn = true): Promise<UserSummary> {
    if (isSupabaseDriver()) return authRepository.login(identifier, password, acceptedRoles, keepSignedIn);
    const users = getUsers();
    const candidates = users.filter((candidate) =>
      (candidate.username?.toLocaleLowerCase() === identifier.toLocaleLowerCase() ||
        candidate.email?.toLocaleLowerCase() === identifier.toLocaleLowerCase()) &&
      (!acceptedRoles || acceptedRoles.includes(candidate.role)),
    );
    let user: UserRecord | undefined;
    for (const candidate of candidates) {
      const result = await verifySecret(candidate.passwordHash ?? candidate.password, password);
      if (!result.valid) continue;
      user = candidate;
      if (result.needsRehash) {
        const migratedUser: UserRecord = { ...candidate, passwordHash: await hashSecret(password), password: undefined };
        user = migratedUser;
        saveUsers(users.map((entry) => entry.id === candidate.id ? migratedUser : entry));
      }
      break;
    }
    if (!user) throw new Error('The username/email or password is incorrect.');
    if (user.storeId) {
      const store = readData('stores', seedStores).find((candidate) => candidate.id === user.storeId);
      if (store && isSubscriptionExpired(store)) throw new Error('Subscription expired, contact 7anouti');
    }
    if (!isAccountActive(user)) throw new Error('The username/email or password is incorrect.');

    const session: AuthSession = {
      userId: user.id,
      sessionVersion: user.sessionVersion ?? 0,
      expiresAt: Date.now() + 8 * 60 * 60_000,
    };
    writeData(SESSION_KEY, session);
    clearSessionStorageLock();
    removeData(PIN_ATTEMPTS_PREFIX + user.id);
    if (user.storeId) {
      await activityService.log({
        storeId: user.storeId,
        actorId: user.id,
        action: 'login',
        summary: `${user.name} signed in.`,
        entityType: 'session',
        entityId: user.id,
      });
    }
    return withoutPassword(user);
  },

  async getCurrentUser(): Promise<UserSummary | null> {
    if (isSupabaseDriver()) return authRepository.currentUser();
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session) return null;
    if (session.expiresAt === undefined || session.expiresAt <= Date.now()) {
      writeData<AuthSession | null>(SESSION_KEY, null);
      clearSessionStorageLock();
      return null;
    }
    const user = getUsers().find((candidate) => candidate.id === session.userId);
    if (!user || !isAccountActive(user) || (session.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
      writeData<AuthSession | null>(SESSION_KEY, null);
      return null;
    }
    return withoutPassword(user);
  },

  getCachedUserDisplay() {
    if (isSupabaseDriver()) return authRepository.getCachedUserDisplay();
    return null;
  },

  async isSessionLocked(userId: string): Promise<boolean> {
    if (isSupabaseDriver()) return authRepository.isSessionLocked(userId);
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    return session?.userId === userId && (session.locked === true || getSessionStorageLock(userId));
  },

  async hasPersonalPin(userId: string): Promise<boolean> {
    if (isSupabaseDriver()) return authRepository.hasPersonalPin(userId);
    return Boolean(getUsers().find((candidate) =>
      candidate.id === userId && (candidate.role === 'staff' || candidate.role === 'owner'),
    )?.pinHash);
  },

  async lockCurrentSession(): Promise<void> {
    if (isSupabaseDriver()) return authRepository.lockCurrentSession();
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session) throw new Error('You must sign in before locking the terminal.');
    const user = getUsers().find((candidate) => candidate.id === session.userId);
    if (!user || (user.role !== 'staff' && user.role !== 'owner') || !user.storeId) throw new Error('Only store sessions can be locked.');
    if (await this.isSessionLocked(user.id)) return;
    if (typeof window !== 'undefined') window.sessionStorage.setItem(SESSION_LOCK_KEY, user.id);
    writeData(SESSION_KEY, { ...session, locked: true });
    await activityService.log({
      actorId: user.id,
      storeId: user.storeId,
      action: 'lock.locked',
      summary: `${user.name}'s session was locked.`,
      entityType: 'session',
      entityId: user.id,
      meta: { before: { locked: false }, after: { locked: true } },
    });
  },

  async lockDeviceStaffSession(): Promise<void> {
    if (isSupabaseDriver()) return authRepository.lockDeviceStaffSession();
    throw new Error('Shared device sessions require the connected Supabase service.');
  },

  getPinLockRemainingMs(userId: string): number {
    if (isSupabaseDriver()) return authRepository.pinLockRemainingMs();
    const attempts = getPinAttempts(userId);
    return Math.max(0, (attempts.lockedUntil ?? 0) - Date.now());
  },

  async setPersonalPin(userId: string, pin: string): Promise<UserSummary> {
    if (isSupabaseDriver()) return authRepository.setPersonalPin(userId, pin);
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain exactly 4 digits.');
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session || session.userId !== userId) throw new Error('You must sign in as this account to set a PIN.');
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId);
    if (!user || user.role !== 'owner' || user.mustChangePassword) throw new Error('Only a signed-in store owner can set a personal PIN.');
    if (user.pinHash || user.mustSetPin === false) throw new Error('A personal PIN is already set for this account.');
    const pinHash = await hashSecret(pin);
    const updatedUser = { ...user, pinHash, mustSetPin: false };
    saveUsers(users.map((candidate) => candidate.id === userId ? updatedUser : candidate));
    removeData(PIN_ATTEMPTS_PREFIX + userId);
    if (user.storeId) {
      await activityService.log({
        storeId: user.storeId,
        actorId: user.id,
        action: `${user.role}.pin_set`,
        summary: `${user.name} set a personal PIN.`,
        entityType: user.role,
        entityId: user.id,
        meta: { before: { hasPin: Boolean(user.pinHash) }, after: { hasPin: true } },
      });
    }
    return withoutPassword(updatedUser);
  },

  async changePersonalPin(userId: string, currentPin: string, newPin: string): Promise<void> {
    if (isSupabaseDriver()) return authRepository.changePersonalPin(userId, currentPin, newPin);
    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) throw new Error('PIN must contain exactly 4 digits.');
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session || session.userId !== userId) throw new Error('You must sign in as this account to change a PIN.');
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId);
    if (!user || user.role !== 'owner' || !user.storeId || user.mustChangePassword || !user.pinHash) {
      throw new Error('Only a signed-in store owner can change a personal PIN.');
    }
    await verifyPersonalPin(user, currentPin);
    const pinHash = await hashSecret(newPin);
    saveUsers(users.map((candidate) => candidate.id === userId ? { ...candidate, pinHash, mustSetPin: false } : candidate));
    await activityService.log({
      storeId: user.storeId,
      actorId: user.id,
      action: `${user.role}.pin_changed`,
      summary: `${user.name} changed their personal PIN.`,
      entityType: user.role,
      entityId: user.id,
    });
  },

  async verifyFiscalProfileOwnerCredential(
    storeId: string,
    method: 'pin' | 'password',
    credential: string,
  ): Promise<void> {
    if (isSupabaseDriver()) {
      return authRepository.verifyFiscalProfileOwnerCredential(storeId, method, credential);
    }

    const session = readData<AuthSession | null>(SESSION_KEY, null);
    const user = session ? getUsers().find((candidate) => candidate.id === session.userId) : undefined;
    const store = readData('stores', seedStores).find((candidate) => candidate.id === storeId);
    if (!user || user.role !== 'owner' || user.storeId !== storeId || store?.ownerId !== user.id) {
      throw new Error('Only the active owner of this store can unlock its fiscal information.');
    }

    if (method === 'pin') {
      if (!/^\d{4}$/.test(credential)) throw new Error('Enter your 4-digit personal PIN.');
      await verifyPersonalPin(user, credential);
      return;
    }

    if (!credential || !(await verifySecret(user.passwordHash ?? user.password, credential)).valid) {
      throw new Error('Password is incorrect.');
    }
    removeData(PIN_ATTEMPTS_PREFIX + user.id);
  },

  async unlockCurrentSessionWithPin(pin: string): Promise<UserSummary> {
    if (isSupabaseDriver()) return authRepository.unlockWithPin(pin);
    if (!/^\d{4}$/.test(pin)) throw new Error('Enter your 4-digit PIN.');
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session) throw new Error('The staff session could not be found.');
    const user = getUsers().find((candidate) => candidate.id === session.userId);
    if (!user || (user.role !== 'staff' && user.role !== 'owner') || !user.storeId) throw new Error('The account could not be found.');
    await verifyPersonalPin(user, pin);
    await this.unlockSession(session, user);
    return withoutPassword(user);
  },

  async unlockCurrentSessionWithPassword(password: string): Promise<UserSummary> {
    if (isSupabaseDriver()) return authRepository.unlockWithPassword(password);
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session) throw new Error('The staff session could not be found.');
    const user = getUsers().find((candidate) => candidate.id === session.userId);
    if (!user || (user.role !== 'staff' && user.role !== 'owner') || !user.storeId) throw new Error('The account could not be found.');
    if (!(await verifySecret(user.passwordHash ?? user.password, password)).valid) {
      throw new Error('Password is incorrect.');
    }
    await this.unlockSession(session, user);
    removeData(PIN_ATTEMPTS_PREFIX + user.id);
    return withoutPassword(user);
  },

  async setInitialPassword(userId: string, newPassword: string): Promise<UserSummary> {
    if (isSupabaseDriver()) return authRepository.setInitialPassword(userId, newPassword);
    if (newPassword.length < 6) throw new Error('Password must contain at least 6 characters.');
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) throw new Error('The signed-in account could not be found.');
    if (!user.mustChangePassword) throw new Error('The account is not awaiting a first password change.');
    const updatedUser = {
      ...user,
      password: undefined,
      passwordHash: await hashSecret(newPassword),
      mustChangePassword: false,
      mustSetPin: (user.role === 'staff' || user.role === 'owner') && user.mustChangePassword
        ? !user.pinHash
        : user.mustSetPin,
    };
    saveUsers(users.map((candidate) => candidate.id === userId ? updatedUser : candidate));
    if (user.storeId) {
      await activityService.log({
        storeId: user.storeId,
        actorId: user.id,
        action: `${user.role}.password_changed`,
        summary: `${user.name} set an initial password.`,
        entityType: 'staff',
        entityId: user.id,
        meta: { before: { mustChangePassword: user.mustChangePassword }, after: { mustChangePassword: false } },
      });
    }
    return withoutPassword(updatedUser);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (isSupabaseDriver()) return authRepository.changePassword(userId, currentPassword, newPassword);
    if (newPassword.length < 6) throw new Error('Password must contain at least 6 characters.');
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId);
    if (!user || !(await verifySecret(user.passwordHash ?? user.password, currentPassword)).valid) throw new Error('Current password is incorrect.');
    const passwordHash = await hashSecret(newPassword);
    saveUsers(users.map((candidate) => candidate.id === userId ? { ...candidate, password: undefined, passwordHash } : candidate));
    if (user.storeId) {
      await activityService.log({
        storeId: user.storeId,
        actorId: user.id,
        action: `${user.role}.password_changed`,
        summary: `${user.name} changed their password.`,
        entityType: user.role,
        entityId: user.id,
      });
    }
  },

  async logout(): Promise<void> {
    if (isSupabaseDriver()) return authRepository.logout();
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    const user = session ? getUsers().find((candidate) => candidate.id === session.userId) : undefined;
    if (user?.storeId) {
      await activityService.log({
        storeId: user.storeId,
        actorId: user.id,
        action: 'logout',
        summary: `${user.name} signed out.`,
        entityType: 'session',
        entityId: user.id,
      });
    }
    writeData<AuthSession | null>(SESSION_KEY, null);
    clearSessionStorageLock();
  },

  async unlockSession(session: AuthSession, user: UserRecord): Promise<void> {
    if (isSupabaseDriver()) return authRepository.unlockSession(session, user);
    clearSessionStorageLock();
    writeData(SESSION_KEY, { ...session, locked: false });
    if (user.storeId) {
      await activityService.log({
        actorId: user.id,
        storeId: user.storeId,
        action: 'lock.unlocked',
        summary: `${user.name}'s session was unlocked.`,
        entityType: 'session',
        entityId: user.id,
        meta: { before: { locked: true }, after: { locked: false } },
      });
    }
  },
};
