import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  clients,
  corsHeaders,
  deviceEmail,
  HttpError,
  isActiveStore,
  response,
  sessionIdFromToken,
  sessionLifetimeExpiresAt,
} from '../_shared/deviceAuth.ts';

interface LoginRequest {
  username?: unknown;
  password?: unknown;
}

async function hashKey(pepper: string, dimension: 'username' | 'ip', value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${dimension}:${value}`),
  ));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sourceIp(request: Request): string {
  const cloudflareIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflareIp) return cloudflareIp;
  return request.headers.get('x-forwarded-for')?.split(',').pop()?.trim() || 'unknown';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const pepper = Deno.env.get('LOGIN_RATE_LIMIT_PEPPER');
  if (!url || !anonKey || !pepper || pepper.length < 32) {
    console.error('[device-login] Device sign-in is not configured.');
    return response(500, { error: 'Device sign-in is not configured.' });
  }

  try {
    let input: LoginRequest;
    try {
      input = await request.json() as LoginRequest;
    } catch {
      return response(400, { error: 'The device sign-in request is invalid.' });
    }
    if (typeof input.username !== 'string' || !/^d-[a-f0-9]{8}$/i.test(input.username.trim()) ||
      typeof input.password !== 'string' || input.password.length === 0 || input.password.length > 128) {
      return response(400, { error: 'Enter the device username and password.' });
    }

    const username = input.username.trim().toLowerCase();
    const usernameKey = await hashKey(pepper, 'username', username);
    const ipKey = await hashKey(pepper, 'ip', sourceIp(request));
    const { admin } = clients();
    const { data: allowed, error: limitError } = await admin.rpc('consume_login_attempt', {
      p_username_hash: usernameKey,
      p_ip_hash: ipKey,
    });
    if (limitError) {
      console.error('[device-login] Rate-limit check failed.');
      return response(503, { error: 'Device sign-in is temporarily unavailable.' });
    }
    if (allowed !== true) return response(429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' });

    const auth = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await auth.auth.signInWithPassword({
      email: deviceEmail(username),
      password: input.password,
    });
    if (authError || !authData.session || !authData.user) {
      return response(401, { error: 'The device username or password is incorrect.' });
    }

    const { data: device, error: deviceError } = await admin
      .from('devices')
      .select('id, store_id, name, username, is_active, must_change_password, session_version')
      .eq('auth_user_id', authData.user.id)
      .eq('username', username)
      .maybeSingle();
    if (deviceError) throw new HttpError(503, 'Could not verify the device account.');
    if (!device || !device.is_active) return response(403, { error: 'This device is inactive.' });

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
      return response(403, { error: 'This device or store is not active.' });
    }

    const sessionId = sessionIdFromToken(authData.session.access_token);
    const { error: sessionError } = await admin.from('device_sessions').upsert({
      session_id: sessionId,
      device_id: device.id,
      session_version: device.session_version,
      expires_at: sessionLifetimeExpiresAt(),
    });
    if (sessionError) throw new HttpError(503, 'Could not register the device session.');

    const { error: clearError } = await admin.rpc('clear_login_attempts', {
      p_username_hash: usernameKey,
    });
    if (clearError) throw new HttpError(503, 'Could not complete device sign-in.');
    const { error: activityError } = await admin
      .from('devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', device.id);
    if (activityError) throw new HttpError(503, 'Could not update device activity.');

    return response(200, {
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
      device: {
        id: device.id,
        storeId: device.store_id,
        name: device.name,
        username: device.username,
        mustChangePassword: device.must_change_password,
      },
    });
  } catch (error) {
    if (error instanceof HttpError) return response(error.status, { error: error.message });
    console.error('[device-login] Device sign-in failed.', error instanceof Error ? error.name : 'UnknownError');
    return response(500, { error: 'Device sign-in is temporarily unavailable.' });
  }
});
