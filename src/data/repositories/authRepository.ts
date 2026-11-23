import { isSubscriptionExpired, type AuthSession, type UserSummary } from '../../types/domain';
import { getStore } from './storeRepository';
import { getProfile, hasPersonalPin } from './profileRepository';
import { getSupabaseClient } from '../supabaseClient';

const SESSION_LOCK_KEY = '7anouti-pos:auth-locked-user';
const SESSION_VERSION_KEY = '7anouti-pos:supabase-session-version';
const PIN_LOCK_KEY = '7anouti-pos:supabase-pin-lock-until';
const CACHED_USER_DISPLAY_KEY = '7anouti-pos:cached-user-display';

export interface CachedUserDisplay {
  name: string;
}

function cacheUserDisplay(user: UserSummary): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(CACHED_USER_DISPLAY_KEY, JSON.stringify({ name: user.name }));
  } catch (error) {
    console.warn('[startup] Could not cache the user display.', error);
  }
}

function clearCachedUserDisplay(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(CACHED_USER_DISPLAY_KEY);
  } catch (error) {
    console.warn('[startup] Could not clear the cached user display.', error);
  }
}

function clearSessionLock(): void {
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(SESSION_LOCK_KEY);
}

function throwSupabaseError(error: { message: string; code?: string }, context: string): never {
  throw new Error(`${context}: ${error.message}`, { cause: error });
}

async function throwFunctionError(error: { message: string }, context: string): Promise<never> {
  const responseContext = 'context' in error ? error.context : undefined;
  if (responseContext instanceof Response) {
    const responseBody: unknown = await responseContext.json();
    if (typeof responseBody === 'object' && responseBody !== null &&
      'error' in responseBody && typeof responseBody.error === 'string') {
      throw new Error(responseBody.error);
    }
  }
  return throwSupabaseError(error, context);
}

async function verifyCurrentPassword(password: string): Promise<void> {
  const { data, error } = await getSupabaseClient().functions.invoke<{ verified: boolean }>('verify-password', {
    body: { password },
  });
  if (error) await throwFunctionError(error, 'Could not verify the current password');
  if (data?.verified !== true) throw new Error('The current password could not be verified.');
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
  if (!authData.user) {
    clearCachedUserDisplay();
    return null;
  }
  let profile: UserSummary | undefined;
  try {
    profile = await getProfile(authData.user.id);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('The sign-in session has expired or is no longer active.')) {
      throw error;
    }
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) throwSupabaseError(signOutError, 'Could not clear the expired sign-in session');
    clearSessionLock();
    clearCachedUserDisplay();
    return null;
  }
  if (!profile || !profile.isActive) {
    await client.auth.signOut();
    clearCachedUserDisplay();
    return null;
  }
  const storedVersion = typeof window === 'undefined' ? null : window.localStorage.getItem(SESSION_VERSION_KEY);
  if (storedVersion !== null && Number(storedVersion) !== (profile.sessionVersion ?? 0)) {
    await client.auth.signOut();
    clearSessionLock();
    clearCachedUserDisplay();
    return null;
  }
  if (profile.storeId) {
    const store = await getStore(profile.storeId);
    if (!store?.isActive || store.archivedAt) {
      await client.auth.signOut();
      clearSessionLock();
      clearCachedUserDisplay();
      return null;
    }
    if (isSubscriptionExpired(store)) throw new Error('Subscription expired, contact 7anouti');
  }
  cacheUserDisplay(profile);
  return profile;
}

export const authRepository = {
  async login(identifier: string, password: string, acceptedRoles?: UserSummary['role'][]): Promise<UserSummary> {
    const client = getSupabaseClient();
    if (typeof window !== 'undefined') window.localStorage.removeItem(SESSION_VERSION_KEY);
    const { data, error } = await client.functions.invoke<{ access_token: string; refresh_token: string }>('login', {
      body: { identifier, password, acceptedRoles },
    });
    if (error) await throwFunctionError(error, 'Could not sign in');
    if (!data?.access_token || !data.refresh_token) throw new Error('The sign-in service returned an invalid session.');
    const { error: sessionError } = await client.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    });
    if (sessionError) throwSupabaseError(sessionError, 'Could not establish the sign-in session');
    const user = await currentUser();
    if (!user || (acceptedRoles && !acceptedRoles.includes(user.role))) {
      await client.auth.signOut();
      clearCachedUserDisplay();
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

  getCachedUserDisplay(): CachedUserDisplay | null {
    if (typeof window === 'undefined') return null;
    try {
      const cached: unknown = JSON.parse(window.sessionStorage.getItem(CACHED_USER_DISPLAY_KEY) ?? 'null');
      if (typeof cached === 'object' && cached !== null && 'name' in cached && typeof cached.name === 'string') {
        return { name: cached.name };
      }
      clearCachedUserDisplay();
      return null;
    } catch (error) {
      clearCachedUserDisplay();
      console.error('[startup] Could not read the cached user display.', error);
      return null;
    }
  },

  async isSessionLocked(userId: string): Promise<boolean> {
    return typeof window !== 'undefined' && window.sessionStorage.getItem(SESSION_LOCK_KEY) === userId;
  },

  async hasPersonalPin(userId: string): Promise<boolean> {
    return hasPersonalPin(userId);
  },

  async lockCurrentSession(): Promise<void> {
    const user = await currentUser();
    if (!user) throw new Error('You must sign in before locking the terminal.');
    if ((user.role !== 'staff' && user.role !== 'owner') || !user.storeId) throw new Error('Only store sessions can be locked.');
    if (typeof window !== 'undefined') window.sessionStorage.setItem(SESSION_LOCK_KEY, user.id);
    await writeActivity(user, 'lock.locked', `${user.name}'s session was locked.`);
  },

  pinLockRemainingMs(): number {
    if (typeof window === 'undefined') return 0;
    const lockedUntil = Number(window.sessionStorage.getItem(PIN_LOCK_KEY) ?? 0);
    return Math.max(0, lockedUntil - Date.now());
  },

  async setPersonalPin(userId: string, pin: string): Promise<UserSummary> {
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain exactly 4 digits.');
    const user = await currentUser();
    if (!user || user.id !== userId || (user.role !== 'staff' && user.role !== 'owner')) throw new Error('You must sign in as this account to set a PIN.');
    const { error } = await getSupabaseClient().rpc('set_personal_pin', { p_pin: pin });
    if (error) throwSupabaseError(error, 'Could not set the personal PIN');
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(PIN_LOCK_KEY);
    const updatedUser = await currentUser();
    if (!updatedUser || updatedUser.mustSetPin) throw new Error('The PIN setup could not be confirmed.');
    return updatedUser;
  },

  async changePersonalPin(userId: string, currentPin: string, newPin: string): Promise<void> {
    if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)) throw new Error('PIN must contain exactly 4 digits.');
    const user = await currentUser();
    if (!user || user.id !== userId || (user.role !== 'staff' && user.role !== 'owner')) throw new Error('You must sign in as this account to change a PIN.');
    if (user.mustChangePassword || user.mustSetPin) throw new Error('Complete the initial password and PIN setup first.');
    const { error } = await getSupabaseClient().rpc('change_personal_pin', {
      p_current_pin: currentPin,
      p_new_pin: newPin,
    });
    if (error) throwSupabaseError(error, 'Could not change the personal PIN');
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(PIN_LOCK_KEY);
  },

  async unlockWithPin(pin: string): Promise<UserSummary> {
    if (!/^\d{4}$/.test(pin)) throw new Error('Enter your 4-digit PIN.');
    const user = await currentUser();
    if (!user || (user.role !== 'staff' && user.role !== 'owner') || !user.storeId) throw new Error('The account could not be found.');
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
    if (!user || (user.role !== 'staff' && user.role !== 'owner') || !user.storeId) throw new Error('The account could not be found.');
    await verifyCurrentPassword(password);
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
    await writeActivity(user, `${user.role}.password_changed`, `${user.name} set an initial password.`);
    const updatedUser = await currentUser();
    if (!updatedUser) throw new Error('The account could not be loaded after changing the password.');
    return updatedUser;
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (newPassword.length < 6) throw new Error('Password must contain at least 6 characters.');
    const user = await currentUser();
    if (!user || user.id !== userId) throw new Error('The signed-in account could not be found.');
    const client = getSupabaseClient();
    await verifyCurrentPassword(currentPassword);
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) throwSupabaseError(error, 'Could not update the password');
    await writeActivity(user, `${user.role}.password_changed`, `${user.name} changed their password.`);
  },

  async logout(): Promise<void> {
    const user = await currentUser();
    if (user?.storeId) await writeActivity(user, 'logout', `${user.name} signed out.`);
    const client = getSupabaseClient();
    let revokeError: { message: string; code?: string } | null = null;
    if (user) {
      const { error } = await client.rpc('revoke_current_auth_session');
      revokeError = error;
    }
    const { error } = await client.auth.signOut();
    if (error) throwSupabaseError(error, 'Could not sign out');
    clearSessionLock();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_VERSION_KEY);
      window.sessionStorage.removeItem(PIN_LOCK_KEY);
    }
    clearCachedUserDisplay();
    if (revokeError) throwSupabaseError(revokeError, 'Could not revoke the sign-in session');
  },

  async unlockSession(session: AuthSession, user: UserSummary): Promise<void> {
    if (session.userId !== user.id) throw new Error('The lock session does not match the signed-in user.');
    clearSessionLock();
    await writeActivity(user, 'lock.unlocked', `${user.name}'s session was unlocked.`);
  },
};
