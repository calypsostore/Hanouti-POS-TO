import { beforeEach, describe, expect, it, vi } from 'vitest';

const { client, getProfileMock, getStoreMock, preference, setPreferenceMock } = vi.hoisted(() => {
  const client = {
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      signOut: vi.fn(),
      setSession: vi.fn(),
    },
    functions: { invoke: vi.fn() },
    rpc: vi.fn(),
  };
  return {
    client,
    getProfileMock: vi.fn(),
    getStoreMock: vi.fn(),
    preference: { enabled: true },
    setPreferenceMock: vi.fn((enabled: boolean) => { preference.enabled = enabled; }),
  };
});

vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: () => client,
  getKeepSignedInPreference: () => preference.enabled,
  setKeepSignedInPreference: setPreferenceMock,
}));
vi.mock('../src/data/repositories/profileRepository', () => ({
  getProfile: getProfileMock,
  hasPersonalPin: vi.fn(),
}));
vi.mock('../src/data/repositories/storeRepository', () => ({ getStore: getStoreMock }));

import { authRepository } from '../src/data/repositories/authRepository';

const session = {
  access_token: 'access-token',
  refresh_token: 'refresh-token',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: 'auth-user' },
};
const profile = {
  id: 'auth-user',
  role: 'owner' as const,
  name: 'Cached Owner',
  isActive: true,
  mustChangePassword: false,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('offline Supabase authentication cache', () => {
  beforeEach(() => {
    localStorage.clear();
    client.auth.getSession.mockReset();
    client.auth.getUser.mockReset();
    client.auth.signOut.mockReset().mockResolvedValue({ error: null });
    client.auth.setSession.mockReset().mockResolvedValue({ error: null });
    client.functions.invoke.mockReset();
    client.rpc.mockReset().mockResolvedValue({ error: null });
    getProfileMock.mockReset().mockResolvedValue(profile);
    getStoreMock.mockReset();
    setPreferenceMock.mockReset();
    preference.enabled = true;
    setPreferenceMock.mockImplementation((enabled: boolean) => { preference.enabled = enabled; });
    client.auth.getSession.mockResolvedValue({ data: { session }, error: null });
    client.auth.getUser.mockResolvedValue({ data: { user: session.user }, error: null });
    vi.stubGlobal('navigator', { onLine: true });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage, sessionStorage: localStorage },
    });
  });

  it('caches account identity but never caches the password', async () => {
    await expect(authRepository.currentUser()).resolves.toMatchObject({ id: profile.id, role: profile.role });
    const cached = JSON.parse(localStorage.getItem('7anouti-pos:cached-auth-user') ?? 'null') as Record<string, unknown>;
    expect(cached).toMatchObject({ id: profile.id, role: 'owner', name: profile.name });
    expect(cached).not.toHaveProperty('password');
    expect(cached).not.toHaveProperty('passwordHash');
  });

  it('applies the login choice before setting the session and does not cache identity when disabled', async () => {
    client.functions.invoke.mockResolvedValue({
      data: { access_token: 'access-token', refresh_token: 'refresh-token' },
      error: null,
    });

    await authRepository.login('cashier', 'not-stored-password', undefined, false);

    expect(setPreferenceMock).toHaveBeenCalledWith(false);
    expect(client.functions.invoke).toHaveBeenCalledWith('login', {
      body: { identifier: 'cashier', password: 'not-stored-password', acceptedRoles: undefined },
    });
    expect(localStorage.getItem('7anouti-pos:cached-auth-user')).toBeNull();
    const persistedValues = Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index);
      return key ? localStorage.getItem(key) ?? '' : '';
    }).join('\n');
    expect(persistedValues).not.toContain('not-stored-password');
  });

  it('restores cached identity offline only while the matching unexpired session exists', async () => {
    await authRepository.currentUser();
    vi.stubGlobal('navigator', { onLine: false });
    client.auth.getUser.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(authRepository.currentUser()).resolves.toMatchObject({
      id: profile.id,
      role: profile.role,
    });

    client.auth.getSession.mockResolvedValue({
      data: { session: { ...session, expires_at: Math.floor(Date.now() / 1000) - 1 } },
      error: null,
    });
    await expect(authRepository.currentUser()).resolves.toBeNull();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(localStorage.getItem('7anouti-pos:cached-auth-user')).toBeNull();
  });

  it('restores cached identity when the store lookup fails after auth is verified', async () => {
    getProfileMock.mockResolvedValue({ ...profile, storeId: 'store-1' });
    getStoreMock.mockResolvedValue({ isActive: true, archivedAt: null, pinMustChange: false });
    await authRepository.currentUser();

    vi.stubGlobal('navigator', { onLine: false });
    getStoreMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(authRepository.currentUser()).resolves.toMatchObject({
      id: profile.id,
      role: profile.role,
    });
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it('clears cached identity and local session on logout even while offline', async () => {
    await authRepository.currentUser();
    vi.stubGlobal('navigator', { onLine: false });
    client.auth.getUser.mockRejectedValue(new TypeError('Failed to fetch'));

    await authRepository.logout();

    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(client.rpc).not.toHaveBeenCalled();
    expect(localStorage.getItem('7anouti-pos:cached-auth-user')).toBeNull();
    expect(localStorage.getItem('7anouti-pos:cached-auth-at')).toBeNull();
  });

  it('clears cached identity when Supabase rejects the session after reconnecting', async () => {
    await authRepository.currentUser();
    client.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: Object.assign(new Error('Invalid JWT'), { name: 'AuthApiError' }),
    });

    await expect(authRepository.currentUser()).resolves.toBeNull();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(localStorage.getItem('7anouti-pos:cached-auth-user')).toBeNull();
  });

  it('does not trust an expired server session to restore cached identity', async () => {
    await authRepository.currentUser();
    client.auth.getSession.mockResolvedValue({
      data: { session: { ...session, expires_at: Math.floor(Date.now() / 1000) - 1 } },
      error: null,
    });

    await expect(authRepository.currentUser()).resolves.toBeNull();
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(localStorage.getItem('7anouti-pos:cached-auth-user')).toBeNull();
  });

  it('surfaces a failed Owner PIN change returned by the RPC', async () => {
    client.rpc.mockResolvedValue({ data: false, error: null });

    await expect(authRepository.changePersonalPin(profile.id, '9999', '8642')).rejects.toThrow('Incorrect PIN.');
    expect(client.rpc).toHaveBeenCalledWith('change_personal_pin', {
      p_current_pin: '9999',
      p_new_pin: '8642',
    });
  });
});
