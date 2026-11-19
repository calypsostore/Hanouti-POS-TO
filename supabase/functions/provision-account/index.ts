import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const passwordAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const permissionIds = new Set([
  'take_orders', 'view_order_history', 'view_all_orders', 'request_void', 'add_order_note',
  'comp_items', '86_items', 'edit_stock_counts', 'customers_view', 'customers_create',
  'customers_edit', 'use_tabs', 'settle_tabs', 'tab_override_limit', 'open_close_shift',
  'cash_in_out', 'view_schedule', 'view_own_hours',
]);

interface CallerProfile {
  id: string;
  role: 'staff' | 'owner' | 'super_admin';
  store_id: string | null;
  name: string;
  is_active: boolean;
  session_version: number;
}

interface ProvisionRequest {
  action: 'create_owner' | 'create_staff' | 'reset_password';
  name?: string;
  email?: string;
  storeName?: string;
  storeId?: string;
  phone?: string;
  notes?: string;
  positionId?: string;
  userId?: string;
  permissionOverrides?: { granted: string[]; revoked: string[] };
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function requiredText(value: string | undefined, field: string, maximum = 200): string {
  const cleaned = value?.trim() ?? '';
  if (!cleaned || cleaned.length > maximum) throw new Error(`${field} is required and must be ${maximum} characters or fewer.`);
  return cleaned;
}

function randomPassword(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => passwordAlphabet[byte % passwordAlphabet.length]).join('');
}

function normalizedName(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function identifierHash(value: string): string {
  let hash = 2166136261;
  for (const character of normalizedName(value)) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return (hash >>> 0).toString(36);
}

function storeCodeBase(storeName: string): string {
  const words = normalizedName(storeName).match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0) return `st${identifierHash(storeName).slice(0, 2)}`;
  const compactWords = words.map((word) => word[0] + word.slice(1).replace(/[aeiou]/g, ''));
  const code = (words.length === 1
    ? compactWords[0].slice(0, 4)
    : compactWords.map((word) => word.slice(0, 2)).join('').slice(0, 4));
  return code || `st${identifierHash(storeName).slice(0, 2)}`;
}

function staffNameSlug(value: string): string {
  const firstName = value.trim().split(/\s+/)[0] ?? '';
  return normalizedName(firstName).replace(/[^a-z0-9]+/g, '') || `staff${identifierHash(firstName).slice(0, 6)}`;
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

function validateOverrides(value: ProvisionRequest['permissionOverrides']): { granted: string[]; revoked: string[] } {
  const granted = [...new Set(value?.granted ?? [])];
  const revoked = [...new Set(value?.revoked ?? [])];
  if ([...granted, ...revoked].some((id) => !permissionIds.has(id))) {
    throw new Error('Permission overrides contain an unknown permission.');
  }
  return { granted, revoked };
}

async function authorizeCaller(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  admin: SupabaseClient,
): Promise<CallerProfile> {
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('A signed-in session is required.');
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser();
  if (authError || !authData.user) throw new Error('The signed-in session could not be verified.');
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id, role, store_id, name, is_active, session_version')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (error || !profile?.is_active) throw new Error('An active account is required.');

  const sessionId = sessionIdFromAuthorization(authorization);
  const { data: session, error: sessionError } = await admin
    .from('auth_sessions')
    .select('session_version, expires_at')
    .eq('session_id', sessionId)
    .eq('user_id', profile.id)
    .maybeSingle();
  if (sessionError || !session || session.session_version !== profile.session_version ||
    Date.parse(session.expires_at) <= Date.now()) {
    throw new Error('The signed-in session has expired or is no longer active.');
  }

  if (profile.store_id) {
    const { data: store, error: storeError } = await admin
      .from('stores')
      .select('owner_id, is_active, archived_at, subscription_paid_until')
      .eq('store_id', profile.store_id)
      .maybeSingle();
    if (storeError || !store?.is_active || store.archived_at ||
      (store.subscription_paid_until && store.subscription_paid_until < tunisianDate())) {
      throw new Error('The store is not active.');
    }
    const { data: owner, error: ownerError } = store.owner_id
      ? await admin.from('profiles').select('role, is_active, store_id').eq('id', store.owner_id).maybeSingle()
      : { data: null, error: null };
    if (ownerError || owner?.role !== 'owner' || !owner.is_active || owner.store_id !== profile.store_id) {
      throw new Error('The store owner is not active.');
    }
  }
  return profile as CallerProfile;
}

async function createOwner(
  admin: SupabaseClient,
  caller: CallerProfile,
  input: ProvisionRequest,
): Promise<unknown> {
  if (caller.role !== 'super_admin') throw new Error('Only a platform owner can create a store owner.');
  const name = requiredText(input.name, 'Owner name');
  const email = requiredText(input.email, 'Owner email', 320).toLocaleLowerCase();
  const storeName = requiredText(input.storeName, 'Store name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid owner email.');

  const temporaryPassword = randomPassword(12);
  const storeId = crypto.randomUUID();
  const paidUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const codeBase = storeCodeBase(storeName);
  let createdStore: { store_id: string; code: string; name: string; created_at: string; is_active: boolean } | undefined;
  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const code = suffix === 0 ? codeBase : `${codeBase}${suffix}`;
    const { data, error } = await admin.from('stores').insert({
      id: storeId,
      store_id: storeId,
      code,
      name: storeName,
      subscription_plan: 'trial',
      subscription_paid_until: paidUntil,
      subscription_notes: '',
      pin_must_change: true,
    }).select('store_id, code, name, created_at, is_active').single();
    if (error) {
      if (error.code === '23505' && error.message.toLowerCase().includes('code')) continue;
      throw new Error(`Could not create store: ${error.message}`);
    }
    createdStore = data;
    break;
  }
  if (!createdStore) throw new Error('Could not generate a unique store ID. Try again.');
  const store = createdStore;
  const storeCode = store.code;

  let ownerId: string | undefined;
  try {
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
    });
    if (authError || !authData.user) throw new Error(`Could not create owner sign-in: ${authError?.message ?? 'No user was returned.'}`);
    ownerId = authData.user.id;
    const { error: profileError } = await admin.from('profiles').insert({
      id: ownerId,
      store_id: storeId,
      role: 'owner',
      name,
      email,
      must_change_password: true,
      is_active: true,
    });
    if (profileError) throw new Error(`Could not create owner profile: ${profileError.message}`);
    const { error: ownerError } = await admin.from('stores').update({ owner_id: ownerId }).eq('store_id', storeId);
    if (ownerError) throw new Error(`Could not assign the store owner: ${ownerError.message}`);
    const { error: settingsError } = await admin.from('store_settings').insert({ store_id: storeId });
    if (settingsError) throw new Error(`Could not create store settings: ${settingsError.message}`);
    const { error: activityError } = await admin.from('activity_logs').insert({
      store_id: storeId,
      actor_id: caller.id,
      actor_name: caller.name,
      actor_role: caller.role,
      action: 'store.created',
      summary: `Created store "${storeName}" and its owner account.`,
      entity_type: 'store',
      entity_id: storeId,
      meta: { after: { store: { id: storeId, name: storeName, code: storeCode }, owner: { id: ownerId, name, email } } },
    });
    if (activityError) throw new Error(`Could not record store creation: ${activityError.message}`);
    return {
      owner: {
        id: ownerId,
        role: 'owner',
        name,
        email,
        mustChangePassword: true,
        isActive: true,
        storeId,
        createdAt: authData.user.created_at,
      },
      store: {
        id: storeId,
        ownerId,
        code: store.code,
        name: store.name,
        isActive: store.is_active,
        createdAt: store.created_at,
        subscription: { plan: 'trial', paidUntil, notes: '' },
        pinMustChange: true,
        settings: { defaultSettlementTerms: 'monthly', notificationPreferences: {} },
      },
      temporaryPassword,
    };
  } catch (error) {
    if (ownerId) {
      const { error: deleteUserError } = await admin.auth.admin.deleteUser(ownerId);
      if (deleteUserError) console.error('Could not roll back the partially created owner account.', deleteUserError);
    }
    const { error: deleteStoreError } = await admin.from('stores').delete().eq('store_id', storeId);
    if (deleteStoreError) console.error('Could not roll back the partially created store.', deleteStoreError);
    throw error;
  }
}

async function createStaff(admin: SupabaseClient, caller: CallerProfile, input: ProvisionRequest): Promise<unknown> {
  const storeId = requiredText(input.storeId, 'Store ID');
  if (caller.role !== 'owner' || caller.store_id !== storeId) throw new Error('Only this store owner can create staff accounts.');
  const name = requiredText(input.name, 'Staff name');
  const positionId = requiredText(input.positionId, 'Position');
  const phone = input.phone?.trim() || null;
  const notes = input.notes?.trim() || null;
  if (phone && phone.length > 100) throw new Error('Phone must be 100 characters or fewer.');
  if (notes && notes.length > 1000) throw new Error('Notes must be 1000 characters or fewer.');

  const { data: store, error: storeError } = await admin
    .from('stores')
    .select('code, name')
    .eq('store_id', storeId)
    .maybeSingle();
  if (storeError || !store) throw new Error('The store could not be found.');
  const { data: position, error: positionError } = await admin
    .from('positions')
    .select('id')
    .eq('id', positionId)
    .eq('store_id', storeId)
    .maybeSingle();
  if (positionError || !position) throw new Error('Select a position from this store.');

  const overrides = validateOverrides(input.permissionOverrides);
  const usernameBase = `${store.code.toUpperCase()}.${staffNameSlug(name)}`;
  const temporaryPassword = randomPassword(6);
  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const username = attempt === 0 ? usernameBase : `${usernameBase}${attempt}`;
    const { data: existing, error } = await admin.from('profiles').select('id').ilike('username', username).maybeSingle();
    if (error) throw new Error(`Could not check the staff username: ${error.message}`);
    if (existing) continue;

    const email = `${username.toLowerCase()}@staff.7anouti.app`;
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
    });
    if (authError || !authData.user) {
      if (authError?.code === 'email_exists') continue;
      throw new Error(`Could not create staff sign-in: ${authError?.message ?? 'No user was returned.'}`);
    }

    const { error: profileError } = await admin.from('profiles').insert({
      id: authData.user.id,
      store_id: storeId,
      role: 'staff',
      name,
      phone,
      notes,
      username,
      position_id: positionId,
      must_change_password: true,
      must_set_pin: true,
      is_active: true,
    });
    if (profileError) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(authData.user.id);
      if (deleteError) console.error('Could not roll back the partially created staff account.', deleteError);
      if (profileError.code === '23505') continue;
      throw new Error(`Could not create staff profile: ${profileError.message}`);
    }
    if (overrides.granted.length || overrides.revoked.length) {
      const { error: overrideError } = await admin.from('permission_overrides').insert({
        store_id: storeId,
        user_id: authData.user.id,
        granted: overrides.granted,
        revoked: overrides.revoked,
      });
      if (overrideError) {
        const { error: deleteError } = await admin.auth.admin.deleteUser(authData.user.id);
        if (deleteError) console.error('Could not roll back the partially created staff account.', deleteError);
        throw new Error(`Could not save staff permissions: ${overrideError.message}`);
      }
    }
    const { error: activityError } = await admin.from('activity_logs').insert({
      store_id: storeId,
      actor_id: caller.id,
      actor_name: caller.name,
      actor_role: caller.role,
      action: 'staff.created',
      summary: `Created staff account "${name}".`,
      entity_type: 'staff',
      entity_id: authData.user.id,
    });
    if (activityError) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(authData.user.id);
      if (deleteError) console.error('Could not roll back the partially created staff account.', deleteError);
      throw new Error(`Could not record staff creation: ${activityError.message}`);
    }
    return {
      staff: {
        id: authData.user.id,
        role: 'staff',
        name,
        phone: phone ?? undefined,
        notes: notes ?? undefined,
        username,
        mustChangePassword: true,
        mustSetPin: true,
        isActive: true,
        storeId,
        positionId,
        permissionOverrides: overrides,
        createdAt: authData.user.created_at,
      },
      temporaryPassword,
    };
  }
  throw new Error('Could not create a unique staff username. Try again.');
}

async function resetPassword(admin: SupabaseClient, caller: CallerProfile, input: ProvisionRequest): Promise<unknown> {
  const userId = requiredText(input.userId, 'Account ID');
  const { data: target, error: targetError } = await admin
    .from('profiles')
    .select('id, role, store_id, name, session_version')
    .eq('id', userId)
    .maybeSingle();
  if (targetError || !target) throw new Error('The account could not be found.');
  const allowed = target.role === 'staff'
    ? caller.role === 'owner' && caller.store_id === target.store_id
    : target.role === 'owner' && caller.role === 'super_admin';
  if (!allowed) throw new Error('You are not allowed to reset this account password.');
  const temporaryPassword = randomPassword(target.role === 'staff' ? 6 : 12);
  const { error: authError } = await admin.auth.admin.updateUserById(userId, { password: temporaryPassword });
  if (authError) throw new Error(`Could not reset the password: ${authError.message}`);
  const { error: profileError } = await admin.from('profiles').update({
    must_change_password: true,
    session_version: target.session_version + 1,
    ...(target.role === 'staff'
      ? { must_set_pin: true, pin_hash: null }
      : { must_set_pin: false }),
  }).eq('id', userId);
  if (profileError) throw new Error(`Could not update the account state: ${profileError.message}`);
  return { temporaryPassword };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response(405, { error: 'Method not allowed.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error('Supabase function environment is incomplete.');
    return response(500, { error: 'Account provisioning is not configured.' });
  }

  try {
    const input = await request.json() as ProvisionRequest;
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const caller = await authorizeCaller(request, supabaseUrl, anonKey, admin);
    let result: unknown;
    if (input.action === 'create_owner') result = await createOwner(admin, caller, input);
    else if (input.action === 'create_staff') result = await createStaff(admin, caller, input);
    else if (input.action === 'reset_password') result = await resetPassword(admin, caller, input);
    else return response(400, { error: 'Choose a supported account operation.' });
    return response(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Account operation failed.';
    return response(400, { error: message });
  }
});
