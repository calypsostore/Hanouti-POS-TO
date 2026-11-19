import type { AuthSession, UserRecord, UserSummary } from '../types/domain';
import { readData, removeData, writeData } from './storage';
import { seedStores, seedUsers } from './seedData';
import { hashSecret, verifySecret } from './secretService';
import { activityLogService } from './activityLogService';

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
  return readData(USERS_KEY, seedUsers);
}

function saveUsers(users: UserRecord[]): void {
  writeData(USERS_KEY, users);
}

function isAccountActive(user: UserRecord): boolean {
  if (!user.isActive) return false;
  if (!user.storeId) return true;
  return readData('stores', seedStores).some((store) => store.id === user.storeId && store.isActive);
}

function withoutPassword(user: UserRecord): UserSummary {
  const { password: _password, passwordHash: _passwordHash, pinHash: _pinHash, ...safeUser } = user;
  return safeUser;
}

export const authService = {
  async login(identifier: string, password: string, acceptedRoles?: UserRecord['role'][]): Promise<UserSummary> {
    const users = getUsers();
    const candidates = users.filter((candidate) =>
      (candidate.username?.toLocaleLowerCase() === identifier.toLocaleLowerCase() ||
        candidate.email?.toLocaleLowerCase() === identifier.toLocaleLowerCase()) &&
      isAccountActive(candidate) &&
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

    const session: AuthSession = { userId: user.id, sessionVersion: user.sessionVersion ?? 0 };
    writeData(SESSION_KEY, session);
    clearSessionStorageLock();
    removeData(PIN_ATTEMPTS_PREFIX + user.id);
    return withoutPassword(user);
  },

  async getCurrentUser(): Promise<UserSummary | null> {
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session) return null;
    const user = getUsers().find((candidate) => candidate.id === session.userId);
    if (!user || !isAccountActive(user) || (session.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
      writeData<AuthSession | null>(SESSION_KEY, null);
      return null;
    }
    return withoutPassword(user);
  },

  async isSessionLocked(): Promise<boolean> {
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    return session ? session.locked === true || getSessionStorageLock(session.userId) : false;
  },

  async hasPersonalPin(userId: string): Promise<boolean> {
    return Boolean(getUsers().find((candidate) => candidate.id === userId && candidate.role === 'staff')?.pinHash);
  },

  async lockCurrentSession(): Promise<void> {
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session) throw new Error('You must sign in before locking the terminal.');
    const user = getUsers().find((candidate) => candidate.id === session.userId);
    if (!user || user.role !== 'staff' || !user.storeId) throw new Error('Only staff sessions can be locked.');
    if (await this.isSessionLocked()) return;
    if (typeof window !== 'undefined') window.sessionStorage.setItem(SESSION_LOCK_KEY, user.id);
    writeData(SESSION_KEY, { ...session, locked: true });
    await activityLogService.recordStaffSessionChange({
      action: 'staff_session_locked',
      targetType: 'staff_session',
      targetId: user.id,
      actorId: user.id,
      storeId: user.storeId,
    });
  },

  getPinLockRemainingMs(userId: string): number {
    const attempts = getPinAttempts(userId);
    return Math.max(0, (attempts.lockedUntil ?? 0) - Date.now());
  },

  async setPersonalPin(userId: string, pin: string): Promise<void> {
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain exactly 4 digits.');
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session || session.userId !== userId) throw new Error('You must sign in as this staff member to set a PIN.');
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId);
    if (!user || user.role !== 'staff' || user.mustChangePassword) throw new Error('The staff account is not ready to set a PIN.');
    const pinHash = await hashSecret(pin);
    saveUsers(users.map((candidate) => candidate.id === userId ? { ...candidate, pinHash } : candidate));
    removeData(PIN_ATTEMPTS_PREFIX + userId);
  },

  async unlockCurrentSessionWithPin(pin: string): Promise<UserSummary> {
    if (!/^\d{4}$/.test(pin)) throw new Error('Enter your 4-digit PIN.');
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session) throw new Error('The staff session could not be found.');
    const user = getUsers().find((candidate) => candidate.id === session.userId);
    if (!user || user.role !== 'staff' || !user.storeId) throw new Error('The staff account could not be found.');
    const remaining = this.getPinLockRemainingMs(user.id);
    if (remaining > 0) throw new Error(`PIN locked. Try again in ${Math.ceil(remaining / 1000)} seconds.`);
    if (!user.pinHash) throw new Error('No PIN is set for this account. Use your password instead.');
    const result = await verifySecret(user.pinHash, pin);
    if (!result.valid) {
      const attempts = getPinAttempts(user.id);
      const count = attempts.count + 1;
      const lockedUntil = count >= 5 ? Date.now() + PIN_LOCKOUT_MS : undefined;
      writeData<PinAttemptState>(PIN_ATTEMPTS_PREFIX + user.id, { count: lockedUntil ? 0 : count, lockedUntil });
      if (lockedUntil) throw new Error('Five incorrect PINs. Try again in 60 seconds.');
      throw new Error('Incorrect PIN.');
    }
    await this.unlockSession(session, user);
    removeData(PIN_ATTEMPTS_PREFIX + user.id);
    return withoutPassword(user);
  },

  async unlockCurrentSessionWithPassword(password: string): Promise<UserSummary> {
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session) throw new Error('The staff session could not be found.');
    const user = getUsers().find((candidate) => candidate.id === session.userId);
    if (!user || user.role !== 'staff' || !user.storeId) throw new Error('The staff account could not be found.');
    if (!(await verifySecret(user.passwordHash ?? user.password, password)).valid) {
      throw new Error('Password is incorrect.');
    }
    await this.unlockSession(session, user);
    removeData(PIN_ATTEMPTS_PREFIX + user.id);
    return withoutPassword(user);
  },

  async setInitialPassword(userId: string, newPassword: string): Promise<UserSummary> {
    if (newPassword.length < 6) throw new Error('Password must contain at least 6 characters.');
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId);
    if (!user) throw new Error('The signed-in account could not be found.');
    if (!user.mustChangePassword) throw new Error('The account is not awaiting a first password change.');
    const updatedUser = { ...user, password: undefined, passwordHash: await hashSecret(newPassword), mustChangePassword: false };
    saveUsers(users.map((candidate) => candidate.id === userId ? updatedUser : candidate));
    return withoutPassword(updatedUser);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 6) throw new Error('Password must contain at least 6 characters.');
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId);
    if (!user || !(await verifySecret(user.passwordHash ?? user.password, currentPassword)).valid) throw new Error('Current password is incorrect.');
    const passwordHash = await hashSecret(newPassword);
    saveUsers(users.map((candidate) => candidate.id === userId ? { ...candidate, password: undefined, passwordHash } : candidate));
  },

  async logout(): Promise<void> {
    writeData<AuthSession | null>(SESSION_KEY, null);
    clearSessionStorageLock();
  },

  async unlockSession(session: AuthSession, user: UserRecord): Promise<void> {
    await activityLogService.recordStaffSessionChange({
      action: 'staff_session_unlocked',
      targetType: 'staff_session',
      targetId: user.id,
      actorId: user.id,
      storeId: user.storeId ?? '',
    });
    clearSessionStorageLock();
    writeData(SESSION_KEY, { ...session, locked: false });
  },
};
