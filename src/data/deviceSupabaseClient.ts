import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

export function getDeviceSupabaseClient(): SupabaseClient {
  if (client) return client;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('Supabase mode requires VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }
  const projectRef = new URL(url).hostname.split('.')[0];
  client = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      storageKey: `sb-${projectRef}-device-auth-token`,
    },
  });
  return client;
}
