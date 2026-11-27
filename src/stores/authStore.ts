import { create } from 'zustand';
import type { ProfileAvatarId, UserRole, UserSummary } from '../types/domain';
import { authService } from '../services/authService';
import { initializeMockData } from '../services/mockDataService';
import { useCartStore } from './cartStore';
import { getSupabaseClient } from '../data/supabaseClient';
import { isSupabaseDriver } from '../data/driver';
import { assertExpectedSchemaVersion } from '../services/schemaVersionService';
import { resetStoreAppearance } from '../lib/storeAppearance';
import { deviceService, type DeviceSessionSummary } from '../services/deviceService';

let authStateSubscription: { unsubscribe: () => void } | undefined;
let permissionRefreshGeneration = 0;
let authRefreshGeneration = 0;

interface AuthState {
  user: UserSummary | null;
  device: DeviceSessionSummary | null;
  cachedUserDisplay: { name: string } | null;
  permissions: string[];
  permissionsReady: boolean;
  locked: boolean;
  ready: boolean;
  initializationError: Error | null;
  hydrate: () => Promise<void>;
  refreshCurrentUser: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  login: (identifier: string, password: string, roles?: UserRole[], keepSignedIn?: boolean) => Promise<UserSummary>;
  loginDevice: (username: string, password: string) => Promise<DeviceSessionSummary>;
  loginWithDevicePin: (pin: string) => Promise<UserSummary>;
  changeDevicePassword: (password: string) => Promise<void>;
  setInitialPassword: (password: string) => Promise<UserSummary>;
  setInitialPin: (pin: string) => Promise<UserSummary>;
  updateOwnerProfile: (changes: { name: string; phone: string }) => Promise<UserSummary>;
  updateProfileAvatar: (avatarId: ProfileAvatarId) => Promise<UserSummary>;
  lock: () => Promise<void>;
  unlockWithPin: (pin: string) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutDevice: () => Promise<void>;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error('An unexpected error occurred.', { cause: error });
}

async function getEffectivePermissions(userId: string): Promise<string[]> {
  const { userService } = await import('../services/userService');
  return userService.getEffectivePermissions(userId);
}

function matchesDeviceStore(user: UserSummary, device: DeviceSessionSummary): boolean {
  return (user.role === 'staff' || user.role === 'owner') && user.storeId === device.storeId;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  device: null,
  cachedUserDisplay: authService.getCachedUserDisplay(),
  permissions: [],
  permissionsReady: false,
  locked: false,
  ready: false,
  initializationError: null,
  hydrate: async () => {
    set({ ready: false, initializationError: null });
    try {
      await Promise.all([assertExpectedSchemaVersion(), initializeMockData()]);
      let user = await authService.getCurrentUser();
      const device = await deviceService.getCurrentDevice();
      if (device && user && !matchesDeviceStore(user, device)) {
        const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
        if (error) throw new Error(`Could not clear the session that does not match this device: ${error.message}`, { cause: error });
        user = null;
      }
      const requestGeneration = ++permissionRefreshGeneration;
      const [locked, permissions] = await Promise.all([
        user ? authService.isSessionLocked(user.id) : Promise.resolve(Boolean(device)),
        user?.role === 'staff' ? getEffectivePermissions(user.id) : Promise.resolve([]),
      ]);
      if (requestGeneration !== permissionRefreshGeneration) return;
      set({
        user,
        device,
        cachedUserDisplay: user ? { name: user.name } : null,
        locked,
        permissions,
        permissionsReady: true,
        ready: true,
        initializationError: null,
      });
      if (!user) resetStoreAppearance();
      if (isSupabaseDriver() && !authStateSubscription) {
        const { data } = getSupabaseClient().auth.onAuthStateChange((event, session) => {
          if (event === 'INITIAL_SESSION') return;
          window.setTimeout(() => {
            if (!session) {
              useCartStore.getState().clearOrder();
              resetStoreAppearance();
              set({ user: null, cachedUserDisplay: null, permissions: [], permissionsReady: true, locked: false });
              return;
            }
            void get().refreshCurrentUser();
          }, 0);
        });
        authStateSubscription = data.subscription;
      }
    } catch (error) {
      console.error('[startup] Could not initialize the application.', error);
      set({ permissions: [], permissionsReady: true, ready: true, initializationError: normalizeError(error) });
    }
  },
  refreshCurrentUser: async () => {
    const requestGeneration = ++authRefreshGeneration;
    try {
      let user = await authService.getCurrentUser();
      let device = get().device;
      try {
        device = await deviceService.getCurrentDevice();
      } catch (error) {
        if (!device) throw error;
        console.warn('[devices] Could not refresh the shared device session; retaining its current screen state.', error);
      }
      if (device && user && !matchesDeviceStore(user, device)) {
        const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
        if (error) throw new Error(`Could not clear the session that does not match this device: ${error.message}`, { cause: error });
        user = null;
      }
      if (requestGeneration !== authRefreshGeneration) return;
      const permissionGeneration = ++permissionRefreshGeneration;
      const [locked, permissions] = await Promise.all([
        user ? authService.isSessionLocked(user.id) : Promise.resolve(Boolean(device)),
        user?.role === 'staff' ? getEffectivePermissions(user.id) : Promise.resolve([]),
      ]);
      if (permissionGeneration !== permissionRefreshGeneration || requestGeneration !== authRefreshGeneration) return;
      set({ user, device, cachedUserDisplay: user ? { name: user.name } : null, locked, permissions, permissionsReady: true, initializationError: null });
      if (!user) resetStoreAppearance();
    } catch (error) {
      console.error('[startup] Could not refresh the signed-in user.', error);
      if (requestGeneration === authRefreshGeneration) {
        set({ initializationError: normalizeError(error) });
      }
    }
  },
  refreshPermissions: async () => {
    const user = get().user;
    const requestGeneration = ++permissionRefreshGeneration;
    if (!user || user.role !== 'staff') {
      set({ permissions: [], permissionsReady: true });
      return;
    }
    try {
      const permissions = await getEffectivePermissions(user.id);
      if (requestGeneration === permissionRefreshGeneration && get().user?.id === user.id) {
        set({ permissions, permissionsReady: true });
      }
    } catch (error) {
      console.error('[permissions] Could not refresh effective permissions.', error);
      if (requestGeneration === permissionRefreshGeneration && get().user?.id === user.id) {
        set({ permissions: [], permissionsReady: true });
      }
    }
  },
  login: async (identifier, password, roles, keepSignedIn = true) => {
    const user = await authService.login(identifier, password, roles, keepSignedIn);
    authRefreshGeneration += 1;
    permissionRefreshGeneration += 1;
    set({ user, device: null, cachedUserDisplay: { name: user.name }, permissions: [], permissionsReady: user.role !== 'staff', locked: false });
    resetStoreAppearance();
    if (user.role === 'staff') await get().refreshPermissions();
    return user;
  },
  loginDevice: async (username, password) => {
  if (get().user) throw new Error('Sign out of the employee account before signing in to a device.');
  const device = await deviceService.loginDevice(username, password);
  authRefreshGeneration += 1;
  permissionRefreshGeneration += 1;
  useCartStore.getState().clearOrder();
  set({
    user: null,
    device,
    cachedUserDisplay: null,
    permissions: [],
    permissionsReady: true,
    locked: true,
    initializationError: null,
  });
  return device;
  },
  loginWithDevicePin: async (pin) => {
  const device = get().device;
  if (!device) throw new Error('Sign in to the device before entering an account PIN.');
  await deviceService.loginWithPin(pin);
  const user = await authService.getCurrentUser();
  if (!user || !matchesDeviceStore(user, device)) {
    const { error } = await getSupabaseClient().auth.signOut({ scope: 'local' });
    if (error) console.error('[devices] Could not clear an account session that did not match the device.', error);
    throw new Error('The account could not be matched to this store device.');
  }
  authRefreshGeneration += 1;
  permissionRefreshGeneration += 1;
  set({
    user,
    cachedUserDisplay: { name: user.name },
    permissions: [],
    permissionsReady: user.role !== 'staff',
    locked: false,
    initializationError: null,
  });
  if (user.role === 'staff') await get().refreshPermissions();
  return user;
  },
  changeDevicePassword: async (password) => {
  const device = get().device;
  if (!device) throw new Error('Sign in to the device before changing its password.');
  await deviceService.changeDevicePassword(password);
  set({ device: { ...device, mustChangePassword: false } });
  },
  setInitialPassword: async (password) => {
    const user = get().user;
    if (!user) throw new Error('You must sign in before setting a password.');
    const updatedUser = await authService.setInitialPassword(user.id, password);
    set({ user: updatedUser, cachedUserDisplay: { name: updatedUser.name } });
    return updatedUser;
  },
  setInitialPin: async (pin) => {
    const user = get().user;
    if (!user) throw new Error('You must sign in before setting a PIN.');
    if (user.role !== 'owner') throw new Error('Only a store owner can set a personal PIN.');
    const updatedUser = await authService.setPersonalPin(user.id, pin);
    set({ user: updatedUser, cachedUserDisplay: { name: updatedUser.name } });
    return updatedUser;
  },
  updateOwnerProfile: async (changes) => {
    const user = get().user;
    if (!user || user.role !== 'owner') throw new Error('Only a signed-in store owner can update this profile.');
    const { userService } = await import('../services/userService');
    const updatedUser = await userService.updateOwnerProfile(user.id, changes);
    set({ user: updatedUser, cachedUserDisplay: { name: updatedUser.name } });
    return updatedUser;
  },
  updateProfileAvatar: async (avatarId) => {
    const user = get().user;
    if (!user) throw new Error('You must sign in before choosing an avatar.');
    const { userService } = await import('../services/userService');
    const updatedUser = await userService.updateProfileAvatar(user.id, avatarId);
    set({ user: updatedUser, cachedUserDisplay: { name: updatedUser.name } });
    return updatedUser;
  },
  lock: async () => {
    const { device, user } = get();
    if (device && user && (user.role === 'staff' || user.role === 'owner')) {
      await authService.lockDeviceSession();
      authRefreshGeneration += 1;
      permissionRefreshGeneration += 1;
      useCartStore.getState().clearOrder();
      set({ user: null, cachedUserDisplay: null, permissions: [], permissionsReady: true, locked: true });
      return;
    }
    await authService.lockCurrentSession();
    set({ locked: true });
  },
  unlockWithPin: async (pin) => {
    const user = await authService.unlockCurrentSessionWithPin(pin);
    set({ user, locked: false });
  },
  unlockWithPassword: async (password) => {
    const user = await authService.unlockCurrentSessionWithPassword(password);
    set({ user, locked: false });
  },
  logout: async () => {
    const { user, device } = get();
    if (device && user) {
      throw new Error('Lock the account session before signing out of a shared device.');
    }
    authRefreshGeneration += 1;
    if (isSupabaseDriver()) {
      try {
        if (user) {
          await getSupabaseClient().from('device_tokens').delete().eq('user_id', user.id);
        }
      } catch (error) {
        console.error('[push] Could not remove device tokens during logout.', error);
      }
    }
    let logoutError: unknown;
    try {
      await authService.logout();
    } catch (error) {
      logoutError = error;
    }
    if (device) {
      try {
        await deviceService.logoutDevice();
      } catch (error) {
        if (!logoutError) logoutError = error;
        else console.error('[devices] Device sign-out also failed after account sign-out failed.', error);
      }
    }
    resetStoreAppearance();
    permissionRefreshGeneration += 1;
    useCartStore.getState().clearOrder();
    set({ user: null, device: null, cachedUserDisplay: null, permissions: [], permissionsReady: true, locked: false });
    if (logoutError) throw normalizeError(logoutError);
  },
  logoutDevice: async () => {
    if (!get().device) return;
    await get().logout();
  },
}));
