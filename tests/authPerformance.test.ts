import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const getSession = vi.fn();
  const getUser = vi.fn();
  const rpc = vi.fn();
  const getSupabaseClient = vi.fn(() => ({
    auth: { getSession, getUser },
    rpc,
  }));
  return { getSession, getUser, rpc, getSupabaseClient };
});

vi.mock('../src/data/driver', () => ({
  isSupabaseDriver: vi.fn(() => true),
}));
vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: mocks.getSupabaseClient,
}));

import { authRepository } from '../src/data/repositories/authRepository';
import { userService } from '../src/services/userService';

describe('startup and permission request batching', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads the signed-in user permissions with one aggregate RPC', async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'staff-1' } } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: ['take_orders', 'use_tabs'], error: null });

    await expect(userService.getEffectivePermissions('staff-1')).resolves.toEqual(['take_orders', 'use_tabs']);

    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('get_store_permissions');
  });

  it('reads the lock flag without fetching the current user again', async () => {
    const getItem = vi.fn(() => 'staff-1');
    vi.stubGlobal('window', { sessionStorage: { getItem } });

    await expect(authRepository.isSessionLocked('staff-1')).resolves.toBe(true);

    expect(getItem).toHaveBeenCalledWith('7anouti-pos:auth-locked-user');
    expect(mocks.getSupabaseClient).not.toHaveBeenCalled();
  });

  it('reads only the cached user display data while startup is pending', () => {
    const getItem = vi.fn(() => JSON.stringify({ name: 'Sarah' }));
    vi.stubGlobal('window', { sessionStorage: { getItem, removeItem: vi.fn() } });

    expect(authRepository.getCachedUserDisplay()).toEqual({ name: 'Sarah' });
    expect(getItem).toHaveBeenCalledWith('7anouti-pos:cached-user-display');
    expect(mocks.getSupabaseClient).not.toHaveBeenCalled();
  });
});
