import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const sessionLifetimeMs = 12 * 60 * 60 * 1000;

interface LoginRequest {
  identifier?: unknown;
  password?: unknown;
  acceptedRoles?: unknown;
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function staffEmail(identifier: string): string {
  const value = identifier.trim().toLowerCase();
  return value.includes('@') ? value : `${value}@staff.7anouti.app`;
}

async function hashKey(pepper: string, dimension: 'username' | 'ip', value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${dimension}:${value}`)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sourceIp(request: Request): string {
  const cloudflareIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflareIp) return cloudflareIp;
  const forwardedFor = request.headers.get('x-forwarded-for');
  return forwardedFor?.split(',').pop()?.trim() || 'unknown';
}

function sessionIdFromToken(accessToken: string): string {
  const payload = accessToken.split('.')[1];
  if (!payload) throw new Error('The sign-in service returned an invalid session.');
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const claims = JSON.parse(atob(padded)) as { session_id?: unknown };
  if (typeof claims.session_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.session_id)) {
    throw new Error('The sign-in service returned an invalid session.');
  }
  return claims.session_id;
}

function tunisianDate(): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Africa/Tunis',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const pepper = Deno.env.get('LOGIN_RATE_LIMIT_PEPPER');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !pepper || pepper.length < 32) {
    console.error('Login function environment is incomplete.');
    return response(500, { error: 'Sign-in is not configured.' });
  }

  try {
    let input: LoginRequest;
    try {
      input = await request.json() as LoginRequest;
    } catch {
      return response(400, { error: 'The sign-in request is invalid.' });
    }
    if (typeof input.identifier !== 'string' || input.identifier.trim().length === 0 || input.identifier.length > 320 ||
      typeof input.password !== 'string' || input.password.length === 0 || input.password.length > 128) {
      return response(400, { error: 'Enter a valid username/email and password.' });
    }
    if (input.acceptedRoles !== undefined && (!Array.isArray(input.acceptedRoles) ||
      input.acceptedRoles.some((role) => !['staff', 'owner', 'super_admin'].includes(String(role))))) {
      return response(400, { error: 'The requested account type is invalid.' });
    }

    const normalizedIdentifier = input.identifier.trim().toLowerCase();
    const usernameIdentifier = normalizedIdentifier.endsWith('@staff.7anouti.app')
      ? normalizedIdentifier.slice(0, -'@staff.7anouti.app'.length)
      : normalizedIdentifier;
    const usernameKey = await hashKey(pepper, 'username', usernameIdentifier);
    const ipKey = await hashKey(pepper, 'ip', sourceIp(request));
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: allowed, error: limitError } = await admin.rpc('consume_login_attempt', {
      p_username_hash: usernameKey,
      p_ip_hash: ipKey,
    });
    if (limitError) {
      console.error('Could not apply login rate limits.', limitError);
      return response(503, { error: 'Sign-in is temporarily unavailable.' });
    }
    if (allowed !== true) return response(429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' });

    const auth = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await auth.auth.signInWithPassword({
      email: staffEmail(input.identifier),
      password: input.password,
    });
    if (authError || !authData.session || !authData.user) {
      if (authError?.status === 429) return response(429, { error: 'Too many sign-in attempts. Try again later.' });
      if (authError && !authError.message.includes('Invalid login credentials') && authError.status !== 400) {
        console.error('Supabase Auth sign-in failed.', authError);
        return response(503, { error: 'Sign-in is temporarily unavailable.' });
      }
      return response(401, { error: 'The username/email or password is incorrect.' });
    }

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, role, store_id, is_active, session_version')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (profileError) throw new Error(`Could not load the account status: ${profileError.message}`);
    const acceptedRoles = input.acceptedRoles as string[] | undefined;
    if (!profile?.is_active || (acceptedRoles && !acceptedRoles.includes(profile.role))) {
      return response(403, { error: 'The username/email or password is incorrect.' });
    }

    if (profile.store_id) {
      const { data: store, error: storeError } = await admin
        .from('stores')
        .select('owner_id, is_active, archived_at, subscription_paid_until')
        .eq('store_id', profile.store_id)
        .maybeSingle();
      if (storeError) throw new Error(`Could not load the store status: ${storeError.message}`);
      const { data: owner, error: ownerError } = store?.owner_id
        ? await admin.from('profiles').select('role, is_active, store_id').eq('id', store.owner_id).maybeSingle()
        : { data: null, error: null };
      if (ownerError) throw new Error(`Could not load the owner status: ${ownerError.message}`);
      if (!store?.is_active || store.archived_at ||
        (store.subscription_paid_until && store.subscription_paid_until < tunisianDate()) ||
        owner?.role !== 'owner' || !owner.is_active || owner.store_id !== profile.store_id) {
        return response(403, { error: 'This account or store is not active.' });
      }
    }

    const sessionId = sessionIdFromToken(authData.session.access_token);
    const { error: cleanupError } = await admin.from('auth_sessions').delete().lt('expires_at', new Date().toISOString());
    if (cleanupError) throw new Error(`Could not clean expired sessions: ${cleanupError.message}`);
    const { error: sessionError } = await admin.from('auth_sessions').upsert({
      session_id: sessionId,
      user_id: profile.id,
      session_version: profile.session_version,
      expires_at: new Date(Date.now() + sessionLifetimeMs).toISOString(),
    });
    if (sessionError) throw new Error(`Could not register the sign-in session: ${sessionError.message}`);

    const { error: clearError } = await admin.rpc('clear_login_attempts', {
      p_username_hash: usernameKey,
    });
    if (clearError) throw new Error(`Could not clear the login rate limit: ${clearError.message}`);

    return response(200, {
      access_token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
    });
  } catch (error) {
    console.error('Login request failed.', error);
    return response(500, { error: 'Sign-in is temporarily unavailable.' });
  }
});
