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
}

interface ProvisionRequest {
  action: 'create_owner' | 'create_staff' | 'reset_password';
  name?: string;
  email?: string;
  storeName?: string;
  storeCode?: string;
  storeId?: string;
  phone?: string;
  notes?: string;
  positionId?: string;
  usernameSuffix?: string;
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

function randomSuffix(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return Array.from(bytes, (byte) => String(byte % 10)).join('');
}

function slug(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
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
    .select('id, role, store_id, name, is_active')
    .eq('id', authData.user.id)
    .maybeSingle();
  if (error || !profile?.is_active) throw new Error('An active account is required.');
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
  const storeCode = requiredText(input.storeCode, 'Store code', 32).toLocaleLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(storeCode)) throw new Error('Store code may use lowercase letters, digits, and hyphens.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid owner email.');

  const temporaryPassword = randomPassword(12);
  const storeId = crypto.randomUUID();
  const paidUntil = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: store, error: storeError } = await admin.from('stores').insert({
    id: storeId,
    store_id: storeId,
    code: storeCode,
    name: storeName,
    subscription_plan: 'trial',
    subscription_paid_until: paidUntil,
    subscription_notes: '',
    pin_must_change: true,
  }).select('store_id, code, name, created_at, is_active').single();
  if (storeError) throw new Error(`Could not create store: ${storeError.message}`);

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
    .select('code')
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
  const firstName = slug(name.split(/\s+/)[0] ?? '');
  if (!firstName) throw new Error('Staff name must contain letters or digits.');
  let username = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = attempt === 0 && input.usernameSuffix && /^\d{3}$/.test(input.usernameSuffix)
      ? input.usernameSuffix
      : randomSuffix();
    const candidate = `${store.code}.${firstName}${suffix}`;
    const { data: existing, error } = await admin.from('profiles').select('id').eq('username', candidate).maybeSingle();
    if (error) throw new Error(`Could not check the staff username: ${error.message}`);
    if (!existing) {
      username = candidate;
      break;
    }
  }
  if (!username) throw new Error('Could not create a unique staff username. Try again.');

  const temporaryPassword = randomPassword(6);
  const email = `${username}@staff.7anouti.app`;
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: temporaryPassword,
    email_confirm: true,
  });
  if (authError || !authData.user) throw new Error(`Could not create staff sign-in: ${authError?.message ?? 'No user was returned.'}`);
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
    is_active: true,
  });
  if (profileError) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(authData.user.id);
    if (deleteError) console.error('Could not roll back the partially created staff account.', deleteError);
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
      isActive: true,
      storeId,
      positionId,
      permissionOverrides: overrides,
      createdAt: authData.user.created_at,
    },
    temporaryPassword,
  };
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
