import { create } from 'zustand';
import type { UserRole, UserSummary } from '../types/domain';
import { authService } from '../services/authService';
import { initializeMockData } from '../services/mockDataService';
import { useCartStore } from './cartStore';

interface AuthState {
  user: UserSummary | null;
  locked: boolean;
  ready: boolean;
  initializationError: string | null;
  hydrate: () => Promise<void>;
  refreshCurrentUser: () => Promise<void>;
  login: (identifier: string, password: string, roles?: UserRole[]) => Promise<UserSummary>;
  setInitialPassword: (password: string) => Promise<void>;
  setInitialPin: (pin: string) => Promise<void>;
  lock: () => Promise<void>;
  unlockWithPin: (pin: string) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  locked: false,
  ready: false,
  initializationError: null,
  hydrate: async () => {
    try {
      await initializeMockData();
      const user = await authService.getCurrentUser();
      const locked = user ? await authService.isSessionLocked() : false;
      set({ user, locked, ready: true, initializationError: null });
    } catch (error) {
      set({ ready: true, initializationError: errorMessage(error) });
    }
  },
  refreshCurrentUser: async () => {
    try {
      const user = await authService.getCurrentUser();
      const locked = user ? await authService.isSessionLocked() : false;
      set({ user, locked, initializationError: null });
    } catch (error) {
      set({ initializationError: errorMessage(error) });
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
  },
  setInitialPin: async (pin) => {
    const user = get().user;
    if (!user) throw new Error('You must sign in before setting a PIN.');
    await authService.setPersonalPin(user.id, pin);
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
