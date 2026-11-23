import type { PermissionOverrides, UserRole, UserSummary } from '../../types/domain';
import { getSupabaseClient } from '../supabaseClient';
import { DEFAULT_PROFILE_AVATAR_ID, isProfileAvatarId } from '../profileAvatars';

interface ProfileRow {
  id: string;
  store_id: string | null;
  role: UserRole;
  name: string;
  avatar_id: string | null;
  email: string | null;
  username: string | null;
  phone: string | null;
  notes: string | null;
  position_id: string | null;
  must_change_password: boolean;
  must_set_pin: boolean;
  is_active: boolean;
  session_version: number;
  created_at: string;
}

export function profileFromRow(row: ProfileRow): UserSummary {
  return {
    id: row.id,
    storeId: row.store_id ?? undefined,
    role: row.role,
    name: row.name,
    avatarId: isProfileAvatarId(row.avatar_id) ? row.avatar_id : DEFAULT_PROFILE_AVATAR_ID,
    email: row.email ?? undefined,
    username: row.username ?? undefined,
    phone: row.phone ?? undefined,
    notes: row.notes ?? undefined,
    positionId: row.position_id ?? undefined,
    mustChangePassword: row.must_change_password,
    mustSetPin: (row.role === 'staff' || row.role === 'owner') && row.must_set_pin,
    isActive: row.is_active,
    sessionVersion: row.session_version,
    createdAt: row.created_at,
  };
}

export async function getProfile(userId: string): Promise<UserSummary | undefined> {
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select('id, store_id, role, name, avatar_id, email, username, phone, notes, position_id, must_change_password, must_set_pin, is_active, session_version, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the signed-in profile: ${error.message}`, { cause: error });
  return data ? profileFromRow(data as ProfileRow) : undefined;
}

export async function listProfiles(storeId?: string): Promise<UserSummary[]> {
  let query = getSupabaseClient()
    .from('profiles')
    .select('id, store_id, role, name, avatar_id, email, username, phone, notes, position_id, must_change_password, must_set_pin, is_active, session_version, created_at')
    .order('created_at');
  if (storeId) query = query.eq('store_id', storeId);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load store accounts: ${error.message}`, { cause: error });
  return (data ?? []).map((row) => profileFromRow(row as ProfileRow));
}

export async function listProfileNames(
  storeId: string,
  userIds: string[],
): Promise<Array<{ id: string; name: string }>> {
  if (!storeId || userIds.length === 0) return [];
  const { data, error } = await getSupabaseClient()
    .from('profiles')
    .select('id, name')
    .eq('store_id', storeId)
    .in('id', [...new Set(userIds)]);
  if (error) throw new Error(`Could not load order staff names: ${error.message}`, { cause: error });
  return data ?? [];
}

export async function getPermissionOverrides(userId: string): Promise<PermissionOverrides | undefined> {
  const { data, error } = await getSupabaseClient()
    .from('permission_overrides')
    .select('granted, revoked')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Could not load permission overrides: ${error.message}`, { cause: error });
  if (!data) return undefined;
  return {
    granted: data.granted as string[],
    revoked: data.revoked as string[],
  };
}

export async function hasPersonalPin(userId: string): Promise<boolean> {
  const { data, error } = await getSupabaseClient().rpc('has_personal_pin', { p_user_id: userId });
  if (error) throw new Error(`Could not check the staff PIN: ${error.message}`, { cause: error });
  return data === true;
}
