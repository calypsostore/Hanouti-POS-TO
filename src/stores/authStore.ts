import { create } from 'zustand';
import type { UserRole, UserSummary } from '../types/domain';
import { authService } from '../services/authService';
import { initializeMockData } from '../services/mockDataService';
import { useCartStore } from './cartStore';
import { getSupabaseClient } from '../data/supabaseClient';
import { isSupabaseDriver } from '../data/driver';
import { assertExpectedSchemaVersion } from '../services/schemaVersionService';

let authStateSubscription: { unsubscribe: () => void } | undefined;

interface AuthState {
  user: UserSummary | null;
  locked: boolean;
  ready: boolean;
  initializationError: Error | null;
  hydrate: () => Promise<void>;
  refreshCurrentUser: () => Promise<void>;
  login: (identifier: string, password: string, roles?: UserRole[]) => Promise<UserSummary>;
  setInitialPassword: (password: string) => Promise<UserSummary>;
  setInitialPin: (pin: string) => Promise<void>;
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
  locked: false,
  ready: false,
  initializationError: null,
  hydrate: async () => {
    set({ ready: false, initializationError: null });
    try {
      await assertExpectedSchemaVersion();
      await initializeMockData();
      const user = await authService.getCurrentUser();
      const locked = user ? await authService.isSessionLocked() : false;
      set({ user, locked, ready: true, initializationError: null });
      if (isSupabaseDriver() && !authStateSubscription) {
        const { data } = getSupabaseClient().auth.onAuthStateChange((_event, session) => {
          window.setTimeout(() => {
            if (!session) {
              useCartStore.getState().clearOrder();
              set({ user: null, locked: false });
              return;
            }
            void get().refreshCurrentUser();
          }, 0);
        });
        authStateSubscription = data.subscription;
      }
    } catch (error) {
      console.error('[startup] Could not initialize the application.', error);
      set({ ready: true, initializationError: normalizeError(error) });
    }
  },
  refreshCurrentUser: async () => {
    try {
      const user = await authService.getCurrentUser();
      const locked = user ? await authService.isSessionLocked() : false;
      set({ user, locked, initializationError: null });
    } catch (error) {
      console.error('[startup] Could not refresh the signed-in user.', error);
      set({ initializationError: normalizeError(error) });
    }
  },
  login: async (identifier, password, roles) => {
    const user = await authService.login(identifier, password, roles);
    set({ user, locked: false });
    return user;
  },
  setInitialPassword: async (password) => {
    const user = get().user;
    if (!user) throw new Error('You must sign in before setting a password.');
    const updatedUser = await authService.setInitialPassword(user.id, password);
    set({ user: updatedUser });
    return updatedUser;
  },
  setInitialPin: async (pin) => {
    const user = get().user;
    if (!user) throw new Error('You must sign in before setting a PIN.');
    const updatedUser = await authService.setPersonalPin(user.id, pin);
    set({ user: updatedUser });
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
    await authService.logout();
    useCartStore.getState().clearOrder();
    set({ user: null, locked: false });
  },
}));
