import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const sessionLifetimeMs = 12 * 60 * 60 * 1000;

export interface DeviceRecord {
  id: string;
  store_id: string;
  auth_user_id: string;
  name: string;
  username: string;
  is_active: boolean;
  must_change_password: boolean;
  session_version: number;
  last_seen_at: string | null;
  created_at: string;
}

export interface DeviceContext {
  admin: SupabaseClient;
  device: DeviceRecord;
  sessionId: string;
  accessToken: string;
}

export interface OwnerContext {
  admin: SupabaseClient;
  ownerClient: SupabaseClient;
  ownerId: string;
  storeId: string;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export function clients(): { url: string; anonKey: string; admin: SupabaseClient } {
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceRoleKey) {
    throw new HttpError(500, 'Device authentication is not configured.');
  }
  return {
    url,
    anonKey,
    admin: createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

export function bearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    throw new HttpError(401, 'A signed-in session is required.');
  }
  return authorization.slice('Bearer '.length);
}

export function sessionIdFromToken(accessToken: string): string {
  const payload = accessToken.split('.')[1];
  if (!payload) throw new HttpError(401, 'The signed-in session could not be verified.');
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const claims = JSON.parse(atob(padded)) as { session_id?: unknown };
    if (typeof claims.session_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.session_id)) {
      throw new Error('Invalid session id.');
    }
    return claims.session_id;
  } catch {
    throw new HttpError(401, 'The signed-in session could not be verified.');
  }
}

export function isActiveStore(
  store: {
    is_active: boolean;
    archived_at: string | null;
    subscription_paid_until: string | null;
    timezone: string;
  },
): boolean {
  if (!store.is_active || store.archived_at) return false;
  if (!store.subscription_paid_until) return true;
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: store.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return store.subscription_paid_until >= `${values.year}-${values.month}-${values.day}`;
}

export async function requireDeviceContext(request: Request): Promise<DeviceContext> {
  const token = bearerToken(request);
  const { url, anonKey, admin } = clients();
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser(token);
  if (authError || !authData.user) throw new HttpError(401, 'The device session could not be verified.');

  const sessionId = sessionIdFromToken(token);
  const { data: device, error: deviceError } = await admin
    .from('devices')
    .select('id, store_id, auth_user_id, name, username, is_active, must_change_password, session_version, last_seen_at, created_at')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle();
  if (deviceError) throw new HttpError(503, 'Could not load the device account.');
  if (!device || !device.is_active) throw new HttpError(403, 'This device is inactive.');

  const { data: deviceSession, error: sessionError } = await admin
    .from('device_sessions')
    .select('session_version, expires_at')
    .eq('device_id', device.id)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (sessionError) throw new HttpError(503, 'Could not verify the device session.');
  if (!deviceSession || deviceSession.session_version !== device.session_version ||
    Date.parse(deviceSession.expires_at) <= Date.now()) {
    throw new HttpError(401, 'The device session has expired or is no longer active.');
  }

  const { data: store, error: storeError } = await admin
    .from('stores')
    .select('owner_id, is_active, archived_at, subscription_paid_until, timezone')
    .eq('store_id', device.store_id)
    .maybeSingle();
  const { data: owner, error: ownerError } = store?.owner_id
    ? await admin.from('profiles').select('role, is_active, store_id').eq('id', store.owner_id).maybeSingle()
    : { data: null, error: null };
  if (storeError || ownerError) throw new HttpError(503, 'Could not verify the device store.');
  if (!store || !isActiveStore(store) || owner?.role !== 'owner' || !owner.is_active ||
    owner.store_id !== device.store_id) {
    throw new HttpError(403, 'This device or store is not active.');
  }
  return { admin, device: device as DeviceRecord, sessionId, accessToken: token };
}

export async function requireOwnerContext(request: Request): Promise<OwnerContext> {
  const token = bearerToken(request);
  const { url, anonKey, admin } = clients();
  const ownerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await ownerClient.auth.getUser(token);
  if (authError || !authData.user) throw new HttpError(401, 'The owner session could not be verified.');

  const sessionId = sessionIdFromToken(token);
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, role, store_id, is_active, session_version')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (profileError) throw new HttpError(503, 'Could not load the owner account.');
  if (!profile || profile.role !== 'owner' || !profile.is_active || !profile.store_id) {
    throw new HttpError(403, 'Only the active owner of a store can manage devices.');
  }

  const { data: activeSession, error: sessionError } = await admin
    .from('auth_sessions')
    .select('session_version, expires_at')
    .eq('session_id', sessionId)
    .eq('user_id', profile.id)
    .maybeSingle();
  if (sessionError) throw new HttpError(503, 'Could not verify the owner session.');
  if (!activeSession || activeSession.session_version !== profile.session_version ||
    Date.parse(activeSession.expires_at) <= Date.now()) {
    throw new HttpError(401, 'The owner session has expired or is no longer active.');
  }

  const { data: store, error: storeError } = await admin
    .from('stores')
    .select('owner_id, is_active, archived_at, subscription_paid_until, timezone')
    .eq('store_id', profile.store_id)
    .maybeSingle();
  if (storeError) throw new HttpError(503, 'Could not load the store status.');
  if (!store || store.owner_id !== profile.id || !isActiveStore(store)) {
    throw new HttpError(403, 'This store is not active.');
  }

  return { admin, ownerClient, ownerId: profile.id, storeId: profile.store_id };
}

export function sessionLifetimeExpiresAt(): string {
  return new Date(Date.now() + sessionLifetimeMs).toISOString();
}

export function deviceEmail(username: string): string {
  return `${username}@device.7anouti.app`;
}

export function randomTemporaryPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function randomDeviceUsername(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `d-${suffix}`;
}
