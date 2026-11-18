import { create } from 'zustand';
import type { UserRole, UserSummary } from '../types/domain';
import { authService } from '../services/authService';
import { initializeMockData } from '../services/mockDataService';

interface AuthState {
  user: UserSummary | null;
  ready: boolean;
  initializationError: string | null;
  hydrate: () => void;
  login: (identifier: string, password: string, roles?: UserRole[]) => Promise<UserSummary>;
  setInitialPassword: (password: string) => Promise<void>;
  logout: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  initializationError: null,
  hydrate: () => {
    try {
      initializeMockData();
      set({ user: authService.getCurrentUser(), ready: true, initializationError: null });
    } catch (error) {
      set({ ready: true, initializationError: errorMessage(error) });
    }
  },
  login: async (identifier, password, roles) => {
    const user = await authService.login(identifier, password, roles);
    set({ user });
    return user;
  },
  setInitialPassword: async (password) => {
    const user = get().user;
    if (!user) throw new Error('You must sign in before setting a password.');
    const updatedUser = await authService.setInitialPassword(user.id, password);
    set({ user: updatedUser });
  },
  logout: () => {
    authService.logout();
    set({ user: null });
  },
}));
