import { isSubscriptionExpired, type AuthSession, type UserSummary } from '../../types/domain';
import { getStore } from './storeRepository';
import { getProfile, hasPersonalPin } from './profileRepository';
import { getKeepSignedInPreference, getSupabaseClient, setKeepSignedInPreference } from '../supabaseClient';

const SESSION_LOCK_KEY = '7anouti-pos:auth-locked-user';
const SESSION_VERSION_KEY = '7anouti-pos:supabase-session-version';
const PIN_LOCK_KEY = '7anouti-pos:supabase-pin-lock-until';
const CACHED_USER_DISPLAY_KEY = '7anouti-pos:cached-user-display';
const CACHED_AUTH_USER_KEY = '7anouti-pos:cached-auth-user';
const CACHED_AUTH_AT_KEY = '7anouti-pos:cached-auth-at';
const OFFLINE_AUTH_MAX_MS = 7 * 24 * 60 * 60 * 1000;

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (/fetcherror|networkerror/i.test(error.name)) return true;
  return /failed to fetch|network request failed|networkerror|load failed|connection|offline|timed out|timeout/i.test(error.message) ||
    isNetworkFailure(error.cause);
}

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

function cacheAuthUser(user: UserSummary): void {
  if (typeof window === 'undefined') return;
  if (!getKeepSignedInPreference()) {
    clearCachedAuthUser();
    return;
  }
  try {
    window.localStorage.setItem(CACHED_AUTH_USER_KEY, JSON.stringify(user));
    window.localStorage.setItem(CACHED_AUTH_AT_KEY, new Date().toISOString());
  } catch (error) {
    console.warn('[startup] Could not cache the signed-in account.', error);
  }
}

function clearCachedAuthUser(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CACHED_AUTH_USER_KEY);
  window.localStorage.removeItem(CACHED_AUTH_AT_KEY);
}

function getCachedAuthUser(): UserSummary | null {
  if (typeof window === 'undefined' || !getKeepSignedInPreference()) return null;
  try {
    const raw = window.localStorage.getItem(CACHED_AUTH_USER_KEY);
    if (!raw) return null;
    const cachedAt = Date.parse(window.localStorage.getItem(CACHED_AUTH_AT_KEY) ?? '');
    if (!Number.isFinite(cachedAt) || Date.now() - cachedAt > OFFLINE_AUTH_MAX_MS) return null;
    const user: unknown = JSON.parse(raw);
    if (typeof user !== 'object' || user === null || !('id' in user) || typeof user.id !== 'string' ||
      !('role' in user) || !['staff', 'owner', 'super_admin'].includes(String(user.role)) ||
      !('isActive' in user) || user.isActive !== true) return null;
    return user as UserSummary;
  } catch {
    return null;
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
  const { data: sessionData } = await client.auth.getSession();
  const localSession = sessionData.session;
  if (!localSession) {
    clearCachedUserDisplay();
    clearCachedAuthUser();
    return null;
  }
  const expiresAtSeconds = localSession.expires_at;
  if (typeof expiresAtSeconds !== 'number' || !Number.isFinite(expiresAtSeconds) || expiresAtSeconds * 1000 <= Date.now()) {
    try {
      await client.auth.signOut({ scope: 'local' });
    } finally {
      clearSessionLock();
      clearCachedUserDisplay();
      clearCachedAuthUser();
    }
    return null;
  }
  let authData: Awaited<ReturnType<typeof client.auth.getUser>>['data'];
  let authError: Awaited<ReturnType<typeof client.auth.getUser>>['error'];
  try {
    ({ data: authData, error: authError } = await client.auth.getUser());
  } catch (error) {
    if (isNetworkFailure(error)) {
      const cached = getCachedAuthUser();
      if (cached && cached.id === localSession.user.id) {
        cacheUserDisplay(cached);
        return cached;
      }
    }
    throw error;
  }
  if (authError && isNetworkFailure(authError)) {
    const cached = getCachedAuthUser();
    if (cached && cached.id === localSession.user.id) {
      cacheUserDisplay(cached);
      return cached;
    }
  }
  if (authError) {
    if (isNetworkFailure(authError)) throwSupabaseError(authError, 'Could not restore the sign-in session');
    try {
      await client.auth.signOut({ scope: 'local' });
    } finally {
      clearSessionLock();
      clearCachedUserDisplay();
      clearCachedAuthUser();
    }
    return null;
  }
  if (!authData.user) {
    clearCachedUserDisplay();
    clearCachedAuthUser();
    return null;
  }
  let profile: UserSummary | undefined;
  try {
    profile = await getProfile(authData.user.id);
  } catch (error) {
    if (isNetworkFailure(error)) {
      const cached = getCachedAuthUser();
      if (cached && cached.id === authData.user.id) {
        cacheUserDisplay(cached);
        return cached;
      }
    }
    try {
      await client.auth.signOut({ scope: 'local' });
    } finally {
      clearSessionLock();
      clearCachedUserDisplay();
      clearCachedAuthUser();
    }
    return null;
  }
  if (!profile || !profile.isActive) {
    try {
      await client.auth.signOut({ scope: 'local' });
    } finally {
      clearCachedUserDisplay();
      clearCachedAuthUser();
    }
    return null;
  }
  const storedVersion = typeof window === 'undefined' ? null : window.localStorage.getItem(SESSION_VERSION_KEY);
  if (storedVersion !== null && Number(storedVersion) !== (profile.sessionVersion ?? 0)) {
    try {
      await client.auth.signOut({ scope: 'local' });
    } finally {
      clearSessionLock();
      clearCachedUserDisplay();
      clearCachedAuthUser();
    }
    return null;
  }
  if (profile.storeId) {
    let store: Awaited<ReturnType<typeof getStore>>;
    try {
      store = await getStore(profile.storeId);
    } catch (error) {
      if (isNetworkFailure(error)) {
        const cached = getCachedAuthUser();
        if (cached && cached.id === authData.user.id) {
          cacheUserDisplay(cached);
          return cached;
        }
      }
      throw error;
    }
    if (!store?.isActive || store.archivedAt) {
      try {
        await client.auth.signOut({ scope: 'local' });
      } finally {
        clearSessionLock();
        clearCachedUserDisplay();
        clearCachedAuthUser();
      }
      return null;
    }
    if (isSubscriptionExpired(store)) throw new Error('Subscription expired, contact 7anouti');
    profile = {
      ...profile,
      mustSetVoidPin: profile.role === 'owner' && Boolean(store.pinMustChange),
    };
  }
  cacheUserDisplay(profile);
  cacheAuthUser(profile);
  return profile;
}

export const authRepository = {
  async login(identifier: string, password: string, acceptedRoles?: UserSummary['role'][], keepSignedIn = true): Promise<UserSummary> {
    setKeepSignedInPreference(keepSignedIn);
    if (!keepSignedIn) clearCachedAuthUser();
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
      await client.auth.signOut({ scope: 'local' });
      clearCachedUserDisplay();
      clearCachedAuthUser();
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

  async lockDeviceSession(): Promise<void> {
    const user = await currentUser();
    if (!user || (user.role !== 'staff' && user.role !== 'owner') || !user.storeId) {
      throw new Error('Only a signed-in store account can lock a shared device session.');
    }
    const client = getSupabaseClient();
    await writeActivity(user, 'lock.locked', `${user.name}'s shared device session was locked.`);
    const { error: revokeError } = await client.rpc('revoke_current_auth_session');
    if (revokeError) throwSupabaseError(revokeError, 'Could not revoke the account session');
    const { error: signOutError } = await client.auth.signOut({ scope: 'local' });
    clearSessionLock();
    clearCachedUserDisplay();
    clearCachedAuthUser();
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_VERSION_KEY);
      window.sessionStorage.removeItem(PIN_LOCK_KEY);
    }
    if (signOutError) throwSupabaseError(signOutError, 'Could not clear the account session');
  },

  pinLockRemainingMs(): number {
    if (typeof window === 'undefined') return 0;
    const lockedUntil = Number(window.sessionStorage.getItem(PIN_LOCK_KEY) ?? 0);
    return Math.max(0, lockedUntil - Date.now());
  },

  async setPersonalPin(userId: string, pin: string): Promise<UserSummary> {
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain exactly 4 digits.');
    const user = await currentUser();
    if (!user || user.id !== userId || user.role !== 'owner') throw new Error('Only a signed-in store owner can set a personal PIN.');
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
    if (!user || user.id !== userId || user.role !== 'owner') throw new Error('Only a signed-in store owner can change a personal PIN.');
    if (user.mustChangePassword || user.mustSetPin) throw new Error('Complete the initial password and PIN setup first.');
    const { data, error } = await getSupabaseClient().rpc('change_personal_pin', {
      p_current_pin: currentPin,
      p_new_pin: newPin,
    });
    if (error) throwSupabaseError(error, 'Could not change the personal PIN');
    if (data !== true) throw new Error('Incorrect PIN.');
    if (typeof window !== 'undefined') window.sessionStorage.removeItem(PIN_LOCK_KEY);
  },

  async verifyFiscalProfileOwnerCredential(
    storeId: string,
    method: 'pin' | 'password',
    credential: string,
  ): Promise<void> {
    const user = await currentUser();
    if (!user || user.role !== 'owner' || user.storeId !== storeId) {
      throw new Error('Only the active owner of this store can unlock its fiscal information.');
    }
    const store = await getStore(storeId);
    if (!store || store.ownerId !== user.id) {
      throw new Error('Only the active owner of this store can unlock its fiscal information.');
    }

    if (method === 'password') {
      if (!credential) throw new Error('Enter your password.');
      await verifyCurrentPassword(credential);
      return;
    }

    if (!/^\d{4}$/.test(credential)) throw new Error('Enter your 4-digit personal PIN.');
    const remaining = this.pinLockRemainingMs();
    if (remaining > 0) throw new Error(`PIN locked. Try again in ${Math.ceil(remaining / 1000)} seconds.`);
    const { data, error } = await getSupabaseClient().rpc('verify_personal_pin', { p_pin: credential });
    if (error) {
      if (error.message.includes('temporarily locked')) {
        if (typeof window !== 'undefined') window.sessionStorage.setItem(PIN_LOCK_KEY, String(Date.now() + 60_000));
        throw new Error('Five incorrect PINs. Try again in 60 seconds.');
      }
      throwSupabaseError(error, 'Could not verify the personal PIN');
    }
    if (data !== true) throw new Error('Incorrect PIN.');
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
    const client = getSupabaseClient();
    let user: UserSummary | null = null;
    const remoteErrors: unknown[] = [];
    try {
      user = await currentUser();
    } catch (error) {
      remoteErrors.push(error);
    }
    if (user && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        if (user.storeId) await writeActivity(user, 'logout', `${user.name} signed out.`);
      } catch (error) {
        remoteErrors.push(error);
      }
      try {
        const { error } = await client.rpc('revoke_current_auth_session');
        if (error) throw error;
      } catch (error) {
        remoteErrors.push(error);
      }
    }
    let signOutError: { message: string; code?: string } | null | undefined;
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      signOutError = error;
    } finally {
      clearSessionLock();
      clearCachedAuthUser();
      clearCachedUserDisplay();
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(SESSION_VERSION_KEY);
        window.sessionStorage.removeItem(PIN_LOCK_KEY);
      }
    }
    for (const error of remoteErrors) {
      console.warn('[auth] Remote logout audit/revocation failed; local sign-out completed.', error);
    }
    if (signOutError) throwSupabaseError(signOutError, 'Could not sign out locally');
  },

  async unlockSession(session: AuthSession, user: UserSummary): Promise<void> {
    if (session.userId !== user.id) throw new Error('The lock session does not match the signed-in user.');
    clearSessionLock();
    await writeActivity(user, 'lock.unlocked', `${user.name}'s session was unlocked.`);
  },
};
