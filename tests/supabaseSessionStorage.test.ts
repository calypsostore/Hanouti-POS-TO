import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }));

function installWindow(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage, sessionStorage: localStorage },
  });
}

describe('Supabase remember-me storage', () => {
  beforeEach(() => {
    localStorage.clear();
    createClientMock.mockReset();
    createClientMock.mockImplementation((_url, _key, options) => ({ options }));
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project-ref.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key');
    installWindow();
  });

  it('uses the selected storage dynamically without replacing the initialized client', async () => {
    vi.resetModules();
    const clientModule = await import('../src/data/supabaseClient');
    const client = clientModule.getSupabaseClient() as unknown as {
      options: { auth: { storageKey: string; storage: Storage } };
    };
    const { storage, storageKey } = client.options.auth;

    clientModule.setKeepSignedInPreference(true);
    storage.setItem(storageKey, 'persistent-session');
    expect(localStorage.getItem(storageKey)).toBe('persistent-session');

    clientModule.setKeepSignedInPreference(false);
    expect(clientModule.getSupabaseClient()).toBe(client);
    expect(localStorage.getItem(storageKey)).toBeNull();
    storage.setItem(storageKey, 'runtime-session');
    expect(localStorage.getItem(storageKey)).toBeNull();
    expect(clientModule.getKeepSignedInPreference()).toBe(false);

    vi.resetModules();
    const restartedModule = await import('../src/data/supabaseClient');
    const restartedClient = restartedModule.getSupabaseClient() as unknown as {
      options: { auth: { storageKey: string; storage: Storage } };
    };
    expect(restartedClient.options.auth.storage.getItem(storageKey)).toBeNull();
    expect(restartedModule.getKeepSignedInPreference()).toBe(false);
  });

  it('restores a persistent session after a new client is created when enabled', async () => {
    vi.resetModules();
    const clientModule = await import('../src/data/supabaseClient');
    const client = clientModule.getSupabaseClient() as unknown as {
      options: { auth: { storageKey: string; storage: Storage } };
    };
    const { storage, storageKey } = client.options.auth;
    clientModule.setKeepSignedInPreference(true);
    storage.setItem(storageKey, 'persistent-session');

    vi.resetModules();
    const restartedModule = await import('../src/data/supabaseClient');
    const restartedClient = restartedModule.getSupabaseClient() as unknown as {
      options: { auth: { storageKey: string; storage: Storage } };
    };
    expect(restartedClient.options.auth.storage.getItem(storageKey)).toBe('persistent-session');
    expect(restartedModule.getKeepSignedInPreference()).toBe(true);
  });
});
