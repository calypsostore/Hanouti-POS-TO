import type { AuthSession, UserRecord, UserSummary } from '../types/domain';
import { readData, writeData } from './storage';
import { seedStores, seedUsers } from './seedData';
import { hashSecret, verifySecret } from './secretService';

const USERS_KEY = 'users';
const SESSION_KEY = 'auth-session';

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
  const { password: _password, passwordHash: _passwordHash, ...safeUser } = user;
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

    const session: AuthSession = { userId: user.id };
    writeData(SESSION_KEY, session);
    return withoutPassword(user);
  },

  async getCurrentUser(): Promise<UserSummary | null> {
    const session = readData<AuthSession | null>(SESSION_KEY, null);
    if (!session) return null;
    const user = getUsers().find((candidate) => candidate.id === session.userId);
    if (!user || !isAccountActive(user)) {
      writeData<AuthSession | null>(SESSION_KEY, null);
      return null;
    }
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
  },
};
