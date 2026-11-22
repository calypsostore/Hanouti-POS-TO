import { create } from 'zustand';
import type { ProfileAvatarId, UserRole, UserSummary } from '../types/domain';
import { authService } from '../services/authService';
import { initializeMockData } from '../services/mockDataService';
import { useCartStore } from './cartStore';
import { getSupabaseClient } from '../data/supabaseClient';
import { isSupabaseDriver } from '../data/driver';
import { assertExpectedSchemaVersion } from '../services/schemaVersionService';
import { userService } from '../services/userService';

let authStateSubscription: { unsubscribe: () => void } | undefined;
let permissionRefreshGeneration = 0;
let authRefreshGeneration = 0;

interface AuthState {
  user: UserSummary | null;
  cachedUserDisplay: { name: string } | null;
  permissions: string[];
  permissionsReady: boolean;
  locked: boolean;
  ready: boolean;
  initializationError: Error | null;
  hydrate: () => Promise<void>;
  refreshCurrentUser: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  login: (identifier: string, password: string, roles?: UserRole[]) => Promise<UserSummary>;
  setInitialPassword: (password: string) => Promise<UserSummary>;
  setInitialPin: (pin: string) => Promise<void>;
  updateOwnerProfile: (changes: { name: string; phone: string }) => Promise<UserSummary>;
  updateProfileAvatar: (avatarId: ProfileAvatarId) => Promise<UserSummary>;
  lock: () => Promise<void>;
  unlockWithPin: (pin: string) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error('An unexpected error occurred.', { cause: error });
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
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
      const user = await authService.getCurrentUser();
      const requestGeneration = ++permissionRefreshGeneration;
      const [locked, permissions] = await Promise.all([
        user ? authService.isSessionLocked(user.id) : Promise.resolve(false),
        user?.role === 'staff' ? userService.getEffectivePermissions(user.id) : Promise.resolve([]),
      ]);
      if (requestGeneration !== permissionRefreshGeneration) return;
      set({
        user,
        cachedUserDisplay: user ? { name: user.name } : null,
        locked,
        permissions,
        permissionsReady: true,
        ready: true,
        initializationError: null,
      });
      if (isSupabaseDriver() && !authStateSubscription) {
        const { data } = getSupabaseClient().auth.onAuthStateChange((event, session) => {
          if (event === 'INITIAL_SESSION') return;
          window.setTimeout(() => {
            if (!session) {
              useCartStore.getState().clearOrder();
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
      const user = await authService.getCurrentUser();
      if (requestGeneration !== authRefreshGeneration) return;
      const permissionGeneration = ++permissionRefreshGeneration;
      const [locked, permissions] = await Promise.all([
        user ? authService.isSessionLocked(user.id) : Promise.resolve(false),
        user?.role === 'staff' ? userService.getEffectivePermissions(user.id) : Promise.resolve([]),
      ]);
      if (permissionGeneration !== permissionRefreshGeneration || requestGeneration !== authRefreshGeneration) return;
      set({ user, cachedUserDisplay: user ? { name: user.name } : null, locked, permissions, permissionsReady: true, initializationError: null });
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
      const permissions = await userService.getEffectivePermissions(user.id);
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
  login: async (identifier, password, roles) => {
    const user = await authService.login(identifier, password, roles);
    authRefreshGeneration += 1;
    permissionRefreshGeneration += 1;
    set({ user, cachedUserDisplay: { name: user.name }, permissions: [], permissionsReady: user.role !== 'staff', locked: false });
    if (user.role === 'staff') await get().refreshPermissions();
    return user;
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
    const updatedUser = await authService.setPersonalPin(user.id, pin);
    set({ user: updatedUser, cachedUserDisplay: { name: updatedUser.name } });
  },
  updateOwnerProfile: async (changes) => {
    const user = get().user;
    if (!user || user.role !== 'owner') throw new Error('Only a signed-in store owner can update this profile.');
    const updatedUser = await userService.updateOwnerProfile(user.id, changes);
    set({ user: updatedUser, cachedUserDisplay: { name: updatedUser.name } });
    return updatedUser;
  },
  updateProfileAvatar: async (avatarId) => {
    const user = get().user;
    if (!user) throw new Error('You must sign in before choosing an avatar.');
    const updatedUser = await userService.updateProfileAvatar(user.id, avatarId);
    set({ user: updatedUser, cachedUserDisplay: { name: updatedUser.name } });
    return updatedUser;
  },
  lock: async () => {
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
    authRefreshGeneration += 1;
    if (isSupabaseDriver()) {
      try {
        const user = get().user;
        if (user) {
          await getSupabaseClient().from('device_tokens').delete().eq('user_id', user.id);
        }
      } catch (error) {
        console.error('[push] Could not remove device tokens during logout.', error);
      }
    }
    await authService.logout();
    permissionRefreshGeneration += 1;
    useCartStore.getState().clearOrder();
    set({ user: null, cachedUserDisplay: null, permissions: [], permissionsReady: true, locked: false });
  },
}));
