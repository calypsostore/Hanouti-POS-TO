import type { PositionRecord, StoreRecord, UserSummary } from '../../types/domain';
import { isSupabaseDriver } from '../../data/driver';
import { getSupabaseClient } from '../../data/supabaseClient';
import { fetchCachedQuery } from '../../lib/queryCache';
import { getPermissionOverrides, getProfile, listProfileNames, listProfileNamesForStore, listProfiles } from '../../data/repositories/profileRepository';
import { getStore as getRemoteStore, getSuperAdminStoreOverview, listStores as listRemoteStores } from '../../data/repositories/storeRepository';
import { getUsers, getStores, getPositions, positionFromRow, withoutPassword } from './userHelpers';
import type { UserServiceContext } from './types';

export const userQueryMethods = {
  async getSuperAdminStoreOverview(this: UserServiceContext, search = '', limit = 100, offset = 0) {
    if (!isSupabaseDriver()) {
      const stores = await this.listStores();
      return stores
        .filter((store) => !search || `${store.name} ${store.code}`.toLowerCase().includes(search.toLowerCase()))
        .slice(offset, offset + limit)
        .map((store) => ({
          storeId: store.id,
          ownerId: store.ownerId || null,
          code: store.code,
          name: store.name,
          isActive: store.isActive,
          archivedAt: store.archivedAt ?? null,
          subscriptionPaidUntil: store.subscription?.paidUntil ?? null,
          todayOrderCount: 0,
          todaySalesMillimes: 0,
          openShiftCount: 0,
          totalCount: stores.length,
        }));
    }
    return getSuperAdminStoreOverview(search, limit, offset);
  },

  async listUsers(storeId?: string): Promise<UserSummary[]> {
    if (isSupabaseDriver()) {
      const users = await listProfiles(storeId);
      const { data: authData, error } = await getSupabaseClient().auth.getUser();
      if (error || !authData.user) throw new Error('An active sign-in is required to list accounts.', { cause: error });
      const actor = await getProfile(authData.user.id);
      if (actor?.role !== 'owner') return users;
      return Promise.all(users.map(async (user) => user.role === 'staff'
        ? { ...user, permissionOverrides: await getPermissionOverrides(user.id) }
        : user));
    }
    return getUsers().filter((user) => !storeId || user.storeId === storeId).map(withoutPassword);
  },

  async listStaffNames(storeId: string, staffIds: string[]): Promise<Map<string, string>> {
    if (isSupabaseDriver()) {
      const profiles = await listProfileNames(storeId, staffIds);
      return new Map(profiles.map((profile) => [profile.id, profile.name]));
    }
    const requestedIds = new Set(staffIds);
    return new Map(getUsers()
      .filter((user) => user.storeId === storeId && requestedIds.has(user.id))
      .map((user) => [user.id, user.name]));
  },

  async listProfileNamesForStore(storeId: string): Promise<Map<string, string>> {
    if (!storeId) return new Map();
    if (isSupabaseDriver()) {
      const profiles = await listProfileNamesForStore(storeId);
      return new Map(profiles.map((profile) => [profile.id, profile.name]));
    }
    return new Map(getUsers()
      .filter((user) => user.storeId === storeId)
      .map((user) => [user.id, user.name]));
  },

  async getUser(userId: string): Promise<UserSummary | undefined> {
    if (isSupabaseDriver()) {
      const user = await getProfile(userId);
      if (!user || user.role !== 'staff') return user;
      const { data: authData, error } = await getSupabaseClient().auth.getUser();
      if (error || !authData.user) throw new Error('An active sign-in is required to load staff permissions.', { cause: error });
      const actor = await getProfile(authData.user.id);
      return actor?.role === 'owner'
        ? { ...user, permissionOverrides: await getPermissionOverrides(user.id) }
        : user;
    }
    const user = getUsers().find((candidate) => candidate.id === userId);
    if (!user) return undefined;
    return withoutPassword(user);
  },

  async getStore(storeId: string): Promise<StoreRecord | undefined> {
    if (isSupabaseDriver()) {
      return fetchCachedQuery(`store:${storeId}`, ['stores', 'store_settings'], 15_000, () => getRemoteStore(storeId));
    }
    return getStores().find((store) => store.id === storeId);
  },

  async listStores(): Promise<StoreRecord[]> {
    if (isSupabaseDriver()) return listRemoteStores();
    return getStores();
  },

  async listPositions(storeId: string): Promise<PositionRecord[]> {
    if (isSupabaseDriver()) {
      const { data, error } = await getSupabaseClient()
        .from('positions')
        .select('id, store_id, name, permission_ids, self_service_item_ids, self_service_category_ids, max_staff_drink_quantity_per_shift')
        .eq('store_id', storeId)
        .order('name');
      if (error) throw new Error(`Could not load positions: ${error.message}`, { cause: error });
      return (data ?? []).map((row) => positionFromRow(row));
    }
    return getPositions().filter((position) => position.storeId === storeId);
  },
};
