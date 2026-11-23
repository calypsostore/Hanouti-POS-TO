import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface VerifyRequest {
  password?: unknown;
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function sessionIdFromAuthorization(authorization: string): string {
  const token = authorization.slice('Bearer '.length);
  const payload = token.split('.')[1];
  if (!payload) throw new Error('The signed-in session could not be verified.');
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const claims = JSON.parse(atob(padded)) as { session_id?: unknown };
  if (typeof claims.session_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.session_id)) {
    throw new Error('The signed-in session could not be verified.');
  }
  return claims.session_id;
}

function sourceIp(request: Request): string {
  const cloudflareIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cloudflareIp) return cloudflareIp;
  return request.headers.get('x-forwarded-for')?.split(',').pop()?.trim() || 'unknown';
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const pepper = Deno.env.get('LOGIN_RATE_LIMIT_PEPPER');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !pepper || pepper.length < 32) {
    console.error('Password verification function environment is incomplete.');
    return response(500, { error: 'Password verification is not configured.' });
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return response(401, { error: 'A signed-in session is required.' });

  try {
    let input: VerifyRequest;
    try {
      input = await request.json() as VerifyRequest;
    } catch {
      return response(400, { error: 'The password verification request is invalid.' });
    }
    if (typeof input.password !== 'string' || input.password.length === 0 || input.password.length > 128) {
      return response(400, { error: 'Enter your current password.' });
    }

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await caller.auth.getUser();
    if (authError || !authData.user?.email) return response(401, { error: 'The signed-in session could not be verified.' });

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('id, role, username, email, store_id, is_active, session_version')
      .eq('id', authData.user.id)
      .maybeSingle();
    if (profileError || !profile?.is_active) return response(401, { error: 'The signed-in account is not active.' });

    const sessionId = sessionIdFromAuthorization(authorization);
    const { data: session, error: sessionError } = await admin
      .from('auth_sessions')
      .select('session_version, expires_at')
      .eq('session_id', sessionId)
      .eq('user_id', profile.id)
      .maybeSingle();
    if (sessionError || !session || session.session_version !== profile.session_version ||
      Date.parse(session.expires_at) <= Date.now()) {
      return response(401, { error: 'The sign-in session has expired or is no longer active.' });
    }

    if (profile.store_id) {
      const { data: store, error: storeError } = await admin
        .from('stores')
        .select('owner_id, is_active, archived_at, subscription_paid_until')
        .eq('store_id', profile.store_id)
        .maybeSingle();
      const { data: owner, error: ownerError } = store?.owner_id
        ? await admin.from('profiles').select('role, is_active, store_id').eq('id', store.owner_id).maybeSingle()
        : { data: null, error: null };
      if (storeError || ownerError || !store?.is_active || store.archived_at ||
        (store.subscription_paid_until && store.subscription_paid_until < tunisianDate()) ||
        owner?.role !== 'owner' || !owner.is_active || owner.store_id !== profile.store_id) {
        return response(403, { error: 'This account or store is not active.' });
      }
    }

    const identifier = (profile.username ?? profile.email ?? authData.user.email).toLowerCase();
    const usernameKey = await hashKey(pepper, 'username', identifier);
    const ipKey = await hashKey(pepper, 'ip', sourceIp(request));
    const { data: allowed, error: limitError } = await admin.rpc('consume_login_attempt', {
      p_username_hash: usernameKey,
      p_ip_hash: ipKey,
    });
    if (limitError) {
      console.error('Could not apply password verification rate limits.', limitError);
      return response(503, { error: 'Password verification is temporarily unavailable.' });
    }
    if (allowed !== true) return response(429, { error: 'Too many attempts. Try again in 15 minutes.' });

    const verifier = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: verification, error: verifyError } = await verifier.auth.signInWithPassword({
      email: authData.user.email,
      password: input.password,
    });
    if (verifyError) return response(401, { error: 'Password is incorrect.' });
    if (!verification.session) throw new Error('The password verification session could not be established.');
    const revokeResponse = await fetch(`${supabaseUrl}/auth/v1/logout?scope=local`, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${verification.session.access_token}`,
      },
    });
    if (!revokeResponse.ok) {
      console.error('Could not revoke the temporary password verification session.');
      return response(503, { error: 'Password verification is temporarily unavailable.' });
    }

    const { error: clearError } = await admin.rpc('clear_login_attempts', {
      p_username_hash: usernameKey,
    });
    if (clearError) {
      console.error('Could not clear password verification rate limits.', clearError);
      return response(503, { error: 'Password verification is temporarily unavailable.' });
    }
    return response(200, { verified: true });
  } catch (error) {
    console.error('Password verification request failed.', error);
    return response(500, { error: 'Password verification is temporarily unavailable.' });
  }
});
