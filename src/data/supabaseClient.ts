import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;
const KEEP_SIGNED_IN_KEY = '7anouti-pos:keep-signed-in';
const memoryStorage = new Map<string, string>();

export function getKeepSignedInPreference(): boolean {
  return typeof window === 'undefined' || window.localStorage.getItem(KEEP_SIGNED_IN_KEY) !== 'false';
}

export function setKeepSignedInPreference(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEEP_SIGNED_IN_KEY, String(enabled));
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) return;
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  if (enabled) {
    memoryStorage.delete(storageKey);
  } else {
    window.localStorage.removeItem(storageKey);
    memoryStorage.delete(storageKey);
  }
}

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase mode requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  const storage = {
    getItem(key: string): string | null {
      return getKeepSignedInPreference()
        ? window.localStorage.getItem(key)
        : memoryStorage.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (getKeepSignedInPreference()) {
        window.localStorage.setItem(key, value);
      } else {
        memoryStorage.set(key, value);
      }
    },
    removeItem(key: string): void {
      window.localStorage.removeItem(key);
      memoryStorage.delete(key);
    },
  };
  client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storageKey,
      storage,
    },
  });
  return client;
}
