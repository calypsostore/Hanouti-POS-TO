import { isSubscriptionExpired, type AuthSession, type UserSummary } from '../../types/domain';
import { getStore } from './storeRepository';
import { getProfile, hasPersonalPin } from './profileRepository';
import { getSupabaseClient } from '../supabaseClient';

const SESSION_LOCK_KEY = '7anouti-pos:auth-locked-user';
const SESSION_VERSION_KEY = '7anouti-pos:supabase-session-version';
const PIN_LOCK_KEY = '7anouti-pos:supabase-pin-lock-until';

function clearSessionLock(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(SESSION_LOCK_KEY);
}

function staffEmail(identifier: string): string {
  const value = identifier.trim().toLocaleLowerCase();
  return value.includes('@') ? value : `${value}@staff.7anouti.app`;
}

function throwSupabaseError(error: { message: string; code?: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

async function writeActivity(user: UserSummary, action: string, summary: string): Promise<void> {
  if (!user.storeId) return;
  const { error } = await getSupabaseClient().rpc('log_activity', {
    p_action: action,
    p_summary: summary,
    p_entity_type: 'session',
    p_entity_id: user.id,
    p_meta: {},
  });
  if (error) throwSupabaseError(error, 'Could not record account activity');
}

async function currentUser(): Promise<UserSummary | null> {
  const client = getSupabaseClient();
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError && authError.name !== 'AuthSessionMissingError') throwSupabaseError(authError, 'Could not restore the sign-in session');
  if (!authData.user) return null;
  const profile = await getProfile(authData.user.id);
  if (!profile || !profile.isActive) {
    await client.auth.signOut();
    return null;
  }
  const storedVersion = typeof window === 'undefined' ? null : window.localStorage.getItem(SESSION_VERSION_KEY);
  if (storedVersion !== null && Number(storedVersion) !== (profile.sessionVersion ?? 0)) {
    await client.auth.signOut();
    clearSessionLock();
    return null;
  }
  if (profile.storeId) {
    const store = await getStore(profile.storeId);
    if (!store?.isActive || store.archivedAt) {
      await client.auth.signOut();
      clearSessionLock();
      return null;
    }
    if (isSubscriptionExpired(store)) throw new Error('Subscription expired, contact 7anouti');
  }
  return profile;
}

export const authRepository = {
  async login(identifier: string, password: string, acceptedRoles?: UserSummary['role'][]): Promise<UserSummary> {
    const client = getSupabaseClient();
    const email = staffEmail(identifier);
    if (typeof window !== 'undefined') window.localStorage.removeItem(SESSION_VERSION_KEY);
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        throw new Error('The username/email or password is incorrect.');
      }
      throwSupabaseError(error, 'Could not sign in');
    }
    const user = await currentUser();
    if (!user || (acceptedRoles && !acceptedRoles.includes(user.role))) {
      await client.auth.signOut();
      throw new Error('The username/email or password is incorrect.');
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SESSION_VERSION_KEY, String(user.sessionVersion ?? 0));
      window.sessionStorage.removeItem(PIN_LOCK_KEY);
    }
    clearSessionLock();
    await writeActivity(user, 'login', `${user.name} signed in.`);
    return user;
  },

  currentUser,

  async isSessionLocked(): Promise<boolean> {
    const user = await currentUser();
    return Boolean(user && typeof window !== 'undefined' && window.sessionStorage.getItem(SESSION_LOCK_KEY) === user.id);
  },

  async hasPersonalPin(userId: string): Promise<boolean> {
    return hasPersonalPin(userId);
  },

  async lockCurrentSession(): Promise<void> {
    const user = await currentUser();
    if (!user) throw new Error('You must sign in before locking the terminal.');
    if (user.role !== 'staff' || !user.storeId) throw new Error('Only staff sessions can be locked.');
    if (typeof window !== 'undefined') window.sessionStorage.setItem(SESSION_LOCK_KEY, user.id);
    await writeActivity(user, 'lock.locked', `${user.name}'s session was locked.`);
  },

  pinLockRemainingMs(): number {
    if (typeof window === 'undefined') return 0;
    const lockedUntil = Number(window.sessionStorage.getItem(PIN_LOCK_KEY) ?? 0);
    return Math.max(0, lockedUntil - Date.now());
  },

  async setPersonalPin(userId: string, pin: string): Promise<void> {
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain exactly 4 digits.');
    const user = await currentUser();
    if (!user || user.id !== userId) throw new Error('You must sign in as this staff member to set a PIN.');
    const { error } = await getSupabaseClient().rpc('set_personal_pin', { p_pin: pin });
    if (error) throwSupabaseError(error, 'Could not set the personal PIN');
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(PIN_LOCK_KEY);
    await writeActivity(user, 'staff.pin_set', `${user.name} set a personal PIN.`);
  },

  async unlockWithPin(pin: string): Promise<UserSummary> {
    if (!/^\d{4}$/.test(pin)) throw new Error('Enter your 4-digit PIN.');
    const user = await currentUser();
    if (!user || user.role !== 'staff' || !user.storeId) throw new Error('The staff account could not be found.');
    if (this.pinLockRemainingMs() > 0) throw new Error(`PIN locked. Try again in ${Math.ceil(this.pinLockRemainingMs() / 1000)} seconds.`);
    const { data, error } = await getSupabaseClient().rpc('verify_personal_pin', { p_pin: pin });
    if (error) {
      if (error.message.includes('temporarily locked')) {
        if (typeof window !== 'undefined') window.sessionStorage.setItem(PIN_LOCK_KEY, String(Date.now() + 60_000));
        throw new Error('Five incorrect PINs. Try again in 60 seconds.');
      }
      throwSupabaseError(error, 'Could not verify the personal PIN');
    }
    if (data !== true) throw new Error('Incorrect PIN.');
    clearSessionLock();
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(PIN_LOCK_KEY);
    await writeActivity(user, 'lock.unlocked', `${user.name}'s session was unlocked.`);
    return user;
  },

  async unlockWithPassword(password: string): Promise<UserSummary> {
    const user = await currentUser();
    if (!user || user.role !== 'staff' || !user.storeId) throw new Error('The staff account could not be found.');
    const client = getSupabaseClient();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.email) throw new Error('The staff sign-in could not be verified.');
    const { error } = await client.auth.signInWithPassword({ email: authData.user.email, password });
    if (error) throw new Error('Password is incorrect.');
    clearSessionLock();
    await writeActivity(user, 'lock.unlocked', `${user.name}'s session was unlocked.`);
    return user;
  },

  async setInitialPassword(userId: string, newPassword: string): Promise<UserSummary> {
    if (newPassword.length < 6) throw new Error('Password must contain at least 6 characters.');
    const user = await currentUser();
    if (!user || user.id !== userId) throw new Error('The signed-in account could not be found.');
    if (!user.mustChangePassword) throw new Error('The account is not awaiting a first password change.');
    const client = getSupabaseClient();
    const { error: passwordError } = await client.auth.updateUser({ password: newPassword });
    if (passwordError) throwSupabaseError(passwordError, 'Could not update the password');
    const { error } = await client.rpc('complete_initial_password');
    if (error) throwSupabaseError(error, 'Could not complete the initial password setup');
    await writeActivity(user, 'staff.password_changed', `${user.name} set an initial password.`);
    const updatedUser = await currentUser();
    if (!updatedUser) throw new Error('The account could not be loaded after changing the password.');
    return updatedUser;
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 6) throw new Error('Password must contain at least 6 characters.');
    const user = await currentUser();
    if (!user || user.id !== userId) throw new Error('The signed-in account could not be found.');
    const client = getSupabaseClient();
    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user?.email) throw new Error('The signed-in account could not be verified.');
    const { error: verifyError } = await client.auth.signInWithPassword({ email: authData.user.email, password: currentPassword });
    if (verifyError) throw new Error('Current password is incorrect.');
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) throwSupabaseError(error, 'Could not update the password');
    await writeActivity(user, 'staff.password_changed', `${user.name} changed their password.`);
  },

  async logout(): Promise<void> {
    const user = await currentUser();
    if (user?.storeId) await writeActivity(user, 'logout', `${user.name} signed out.`);
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throwSupabaseError(error, 'Could not sign out');
    clearSessionLock();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_VERSION_KEY);
      window.sessionStorage.removeItem(PIN_LOCK_KEY);
    }
  },

  async unlockSession(session: AuthSession, user: UserSummary): Promise<void> {
    if (session.userId !== user.id) throw new Error('The lock session does not match the signed-in user.');
    clearSessionLock();
    await writeActivity(user, 'lock.unlocked', `${user.name}'s session was unlocked.`);
  },
};
