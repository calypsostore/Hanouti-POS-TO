import type { PermissionDefinition, PositionRecord, UserSummary } from '../../types/domain';
import { getSupabaseClient } from '../../data/supabaseClient';
import { isSupabaseDriver } from '../../data/driver';
import { activityService } from '../activityService';
import { getPermissionOverrides, getProfile } from '../../data/repositories/profileRepository';
import { getUsers, getPositions, savePositions, saveUsers, createId, logUserMutation, notifyPermissionsChanged, positionFromRow, withoutPassword } from './userHelpers';
import { PERMISSIONS, resolveEffectivePermissionIds, normalizePermissionOverrides, validatePositionCompRules } from './userValidation';
import type { UserServiceContext } from './types';

export const userPermissionMethods = {
  async listPermissionDefinitions(): Promise<PermissionDefinition[]> {
    return PERMISSIONS;
  },

  async getEffectivePermissions(userId: string): Promise<string[]> {
    if (isSupabaseDriver()) {
      const { data: sessionData, error: sessionError } = await getSupabaseClient().auth.getSession();
      if (sessionError) throw new Error(`Could not load the active session: ${sessionError.message}`, { cause: sessionError });
      if (!sessionData.session) throw new Error('An active sign-in is required to read permissions.');
      if (sessionData.session.user.id === userId) {
        const { data, error } = await getSupabaseClient().rpc('get_store_permissions');
        if (error) throw new Error(`Could not load effective permissions: ${error.message}`, { cause: error });
        if (!Array.isArray(data) || data.some((permissionId) => typeof permissionId !== 'string')) {
          throw new Error('The server returned an invalid effective permission list.');
        }
        return data;
      }
      const user = await getProfile(userId);
      if (!user || user.role !== 'staff' || !user.storeId) return [];
      const [{ data: position, error: positionError }, overrides] = await Promise.all([
        user.positionId
          ? getSupabaseClient().from('positions').select('permission_ids').eq('id', user.positionId).eq('store_id', user.storeId).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        getPermissionOverrides(user.id),
      ]);
      if (positionError) throw new Error(`Could not load staff position: ${positionError.message}`, { cause: positionError });
      return resolveEffectivePermissionIds(
        (position?.permission_ids as string[] | undefined) ?? [],
        overrides?.granted,
        overrides?.revoked,
      );
    }
    const user = getUsers().find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!user) return [];
    const position = user.storeId && user.positionId
      ? getPositions().find((candidate) => candidate.id === user.positionId && candidate.storeId === user.storeId)
      : undefined;
    return resolveEffectivePermissionIds(
      position?.permissionIds ?? [],
      user.permissionOverrides?.granted,
      user.permissionOverrides?.revoked,
    );
  },

  async hasPermission(this: UserServiceContext, userId: string, permissionId: string): Promise<boolean> {
    if (isSupabaseDriver()) {
      const { data: authData, error } = await getSupabaseClient().auth.getUser();
      if (error || !authData.user) throw new Error('An active sign-in is required to check permissions.', { cause: error });
      if (authData.user.id === userId) {
        const { data, error: permissionError } = await getSupabaseClient().rpc('has_store_permission', { p_permission: permissionId });
        if (permissionError) throw new Error(`Could not verify permission: ${permissionError.message}`, { cause: permissionError });
        return data === true;
      }
    }
    return (await this.getEffectivePermissions(userId)).includes(permissionId);
  },

  async setPermissionOverrides(this: UserServiceContext, userId: string, overrides: { granted: string[]; revoked: string[] }): Promise<UserSummary> {
    if (isSupabaseDriver()) {
      const normalized = normalizePermissionOverrides(overrides);
      const user = await getProfile(userId);
      if (!user?.storeId) throw new Error('Staff account could not be found.');
      const { error } = await getSupabaseClient().from('permission_overrides').upsert({
        store_id: user.storeId,
        user_id: userId,
        granted: normalized.granted,
        revoked: normalized.revoked,
      });
      if (error) throw new Error(`Could not save permission overrides: ${error.message}`, { cause: error });
      notifyPermissionsChanged();
      const updated = await this.getUser(userId);
      if (!updated) throw new Error('Updated staff account could not be loaded.');
      return updated;
    }
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!user) throw new Error('Staff account could not be found.');
    const updated = {
      ...user,
      permissionOverrides: normalizePermissionOverrides(overrides),
    };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    notifyPermissionsChanged();
    await logUserMutation({
      storeId: user.storeId ?? '',
      action: 'staff.permission_changed',
      summary: `Changed permission overrides for "${user.name}".`,
      entityType: 'staff',
      entityId: user.id,
      before: user.permissionOverrides,
      after: updated.permissionOverrides,
    });
    return withoutPassword(updated);
  },

  async createPosition(this: UserServiceContext, 
    storeId: string,
    name: string,
    permissionIds: string[],
    compRules: Pick<PositionRecord, 'selfServiceItemIds' | 'selfServiceCategoryIds' | 'maxStaffDrinkQuantityPerShift'> = {},
  ): Promise<PositionRecord> {
    if (isSupabaseDriver()) {
      if (!name.trim()) throw new Error('Position name is required.');
      validatePositionCompRules(compRules);
      const { data, error } = await getSupabaseClient().from('positions').insert({
        store_id: storeId,
        name: name.trim(),
        permission_ids: [...new Set(permissionIds)],
        self_service_item_ids: [...new Set(compRules.selfServiceItemIds ?? [])],
        self_service_category_ids: [...new Set(compRules.selfServiceCategoryIds ?? [])],
        max_staff_drink_quantity_per_shift: compRules.maxStaffDrinkQuantityPerShift ?? 0,
      }).select('id, store_id, name, permission_ids, self_service_item_ids, self_service_category_ids, max_staff_drink_quantity_per_shift').single();
      if (error) throw new Error(`Could not create position: ${error.message}`, { cause: error });
      const position = positionFromRow(data);
      await activityService.log({
        storeId,
        action: 'position.created',
        summary: `Created staff position "${position.name}".`,
        entityType: 'position',
        entityId: position.id,
        meta: { after: position },
      });
      return position;
    }
    if (!await this.getStore(storeId)) throw new Error('The store could not be found.');
    if (!name.trim()) throw new Error('Position name is required.');
    validatePositionCompRules(compRules);
    const position: PositionRecord = {
      id: createId('position'),
      storeId,
      name: name.trim(),
      permissionIds: [...new Set(permissionIds)],
      ...compRules,
      selfServiceItemIds: compRules.selfServiceItemIds ? [...new Set(compRules.selfServiceItemIds)] : [],
      selfServiceCategoryIds: compRules.selfServiceCategoryIds ? [...new Set(compRules.selfServiceCategoryIds)] : [],
      maxStaffDrinkQuantityPerShift: compRules.maxStaffDrinkQuantityPerShift ?? 0,
    };
    savePositions([...getPositions(), position]);
    await logUserMutation({
      storeId,
      action: 'position.created',
      summary: `Created staff position "${position.name}".`,
      entityType: 'position',
      entityId: position.id,
      after: position,
    });
    return position;
  },

  async updatePosition(positionId: string, changes: Partial<Pick<PositionRecord,
    'name' | 'permissionIds' | 'selfServiceItemIds' | 'selfServiceCategoryIds' | 'maxStaffDrinkQuantityPerShift'>>): Promise<PositionRecord> {
    if (isSupabaseDriver()) {
      if (changes.name !== undefined && !changes.name.trim()) throw new Error('Position name is required.');
      validatePositionCompRules(changes);
      const { data: current, error: loadError } = await getSupabaseClient().from('positions')
        .select('id, store_id, name, permission_ids, self_service_item_ids, self_service_category_ids, max_staff_drink_quantity_per_shift')
        .eq('id', positionId).maybeSingle();
      if (loadError) throw new Error(`Could not load position: ${loadError.message}`, { cause: loadError });
      if (!current) throw new Error('Position could not be found.');
      const { data, error } = await getSupabaseClient().from('positions').update({
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        ...(changes.permissionIds !== undefined ? { permission_ids: changes.permissionIds } : {}),
        ...(changes.selfServiceItemIds !== undefined ? { self_service_item_ids: changes.selfServiceItemIds } : {}),
        ...(changes.selfServiceCategoryIds !== undefined ? { self_service_category_ids: changes.selfServiceCategoryIds } : {}),
        ...(changes.maxStaffDrinkQuantityPerShift !== undefined ? { max_staff_drink_quantity_per_shift: changes.maxStaffDrinkQuantityPerShift } : {}),
      }).eq('id', positionId).select('id, store_id, name, permission_ids, self_service_item_ids, self_service_category_ids, max_staff_drink_quantity_per_shift').single();
      if (error) throw new Error(`Could not update position: ${error.message}`, { cause: error });
      notifyPermissionsChanged();
      const before = positionFromRow(current);
      const updated = positionFromRow(data);
      await activityService.log({
        storeId: before.storeId,
        action: 'staff.permission_changed',
        summary: `Changed permissions for position "${updated.name}".`,
        entityType: 'position',
        entityId: positionId,
        meta: { before, after: updated },
      });
      return updated;
    }
    const positions = getPositions();
    const position = positions.find((candidate) => candidate.id === positionId);
    if (!position) throw new Error('Position could not be found.');
    if (changes.name !== undefined && !changes.name.trim()) throw new Error('Position name is required.');
    validatePositionCompRules(changes);
    const updated = { ...position, ...changes, name: changes.name?.trim() ?? position.name };
    savePositions(positions.map((candidate) => candidate.id === positionId ? updated : candidate));
    notifyPermissionsChanged();
    await logUserMutation({
      storeId: position.storeId,
      action: 'staff.permission_changed',
      summary: `Changed permissions for position "${updated.name}".`,
      entityType: 'position',
      entityId: position.id,
      before: position,
      after: updated,
    });
    return updated;
  },

  async deletePosition(positionId: string, replacementPositionId?: string): Promise<void> {
    if (isSupabaseDriver()) {
      const { data: positionRow, error: positionError } = await getSupabaseClient().from('positions')
        .select('id, store_id, name, permission_ids, self_service_item_ids, self_service_category_ids, max_staff_drink_quantity_per_shift')
        .eq('id', positionId).maybeSingle();
      if (positionError) throw new Error(`Could not load position: ${positionError.message}`, { cause: positionError });
      if (!positionRow) throw new Error('Position could not be found.');
      const position = positionFromRow(positionRow);
      const { data: assignedStaff, error: assignedError } = await getSupabaseClient().from('profiles')
        .select('id')
        .eq('position_id', positionId)
        .eq('role', 'staff');
      if (assignedError) throw new Error(`Could not check assigned staff: ${assignedError.message}`, { cause: assignedError });
      if (assignedStaff?.length && !replacementPositionId) {
        throw new Error(`Move ${assignedStaff.length} staff to a replacement position before deleting this position.`);
      }
      if (assignedStaff?.length && replacementPositionId) {
        const { data: replacement, error: replacementError } = await getSupabaseClient().from('positions')
          .select('id')
          .eq('id', replacementPositionId)
          .eq('store_id', position.storeId)
          .maybeSingle();
        if (replacementError) throw new Error(`Could not load replacement position: ${replacementError.message}`, { cause: replacementError });
        if (!replacement || replacement.id === positionId) throw new Error('Select a replacement position from this store.');
        const { error: updateError } = await getSupabaseClient().from('profiles')
          .update({ position_id: replacement.id })
          .in('id', assignedStaff.map((staff) => staff.id));
        if (updateError) throw new Error(`Could not reassign staff: ${updateError.message}`, { cause: updateError });
      }
      const { error } = await getSupabaseClient().from('positions').delete().eq('id', positionId);
      if (error) throw new Error(`Could not delete position: ${error.message}`, { cause: error });
      notifyPermissionsChanged();
      await activityService.log({
        storeId: position.storeId,
        action: 'position.deleted',
        summary: `Deleted staff position "${position.name}".`,
        entityType: 'position',
        entityId: position.id,
        meta: { before: position, after: { replacementPositionId, reassignedStaffIds: assignedStaff?.map((staff) => staff.id) ?? [] } },
      });
      return;
    }
    const positions = getPositions();
    const position = positions.find((candidate) => candidate.id === positionId);
    if (!position) throw new Error('Position could not be found.');
    const users = getUsers();
    const assignedStaff = users.filter((candidate) => candidate.role === 'staff' && candidate.positionId === positionId);
    if (assignedStaff.length > 0) {
      if (!replacementPositionId) throw new Error(`Move ${assignedStaff.length} staff to a replacement position before deleting this position.`);
      const replacement = positions.find((candidate) =>
        candidate.id === replacementPositionId &&
        candidate.id !== positionId &&
        candidate.storeId === position.storeId,
      );
      if (!replacement) throw new Error('Select a replacement position from this store.');
      const updatedUsers = users.map((candidate) => candidate.role === 'staff' && candidate.positionId === positionId
        ? { ...candidate, positionId: replacement.id }
        : candidate);
      saveUsers(updatedUsers);
    }
    savePositions(positions.filter((candidate) => candidate.id !== positionId));
    notifyPermissionsChanged();
    await logUserMutation({
      storeId: position.storeId,
      action: 'position.deleted',
      summary: `Deleted staff position "${position.name}".`,
      entityType: 'position',
      entityId: position.id,
      before: position,
      after: { replacementPositionId, reassignedStaffIds: assignedStaff.map((staff) => staff.id) },
    });
  },
};
