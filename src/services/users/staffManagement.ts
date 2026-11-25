import type { PermissionOverrides, UserRecord, UserSummary } from '../../types/domain';
import { removeData } from '../storage';
import { hashSecret } from '../secretService';
import { activityService } from '../activityService';
import { getSupabaseClient } from '../../data/supabaseClient';
import { isSupabaseDriver } from '../../data/driver';
import { createStaff, resetPassword } from '../../data/repositories/accountRepository';
import { getProfile } from '../../data/repositories/profileRepository';
import { formatStaffUsername, generateStoreCode } from '../accountIdentity';
import { getUsers, getStores, getPositions, saveUsers, makeStaffTemporaryPassword, createId, withoutPassword, logUserMutation, notifyPermissionsChanged } from './userHelpers';
import { normalizePermissionOverrides } from './userValidation';
import type { UserServiceContext } from './types';

export const staffManagementMethods = {
  generateStoreCode(storeName: string, existingCodes: string[] = []): string {
    return generateStoreCode(storeName, existingCodes);
  },

  formatStaffUsername(storeCode: string, name: string, existingUsernames: string[] = []): string {
    return formatStaffUsername(storeCode, name, existingUsernames);
  },

  async createStaff(this: UserServiceContext, input: {
    storeId: string;
    name: string;
    phone?: string;
    notes?: string;
    positionId: string;
    permissionOverrides?: PermissionOverrides;
  }): Promise<{ staff: UserSummary; temporaryPassword: string }> {
    if (isSupabaseDriver()) return createStaff(input);
    const name = input.name.trim();
    const store = await this.getStore(input.storeId);
    if (!store) throw new Error('The store could not be found.');
    if (!getPositions().some((position) => position.id === input.positionId && position.storeId === input.storeId)) {
      throw new Error('Select a position from this store.');
    }
    if (!name) throw new Error('Staff name is required.');
    const users = getUsers();
    const username = formatStaffUsername(store.code, name, users.flatMap((user) => user.username ? [user.username] : []));
    const temporaryPassword = makeStaffTemporaryPassword();
    const permissionOverrides = input.permissionOverrides ? normalizePermissionOverrides(input.permissionOverrides) : undefined;
    const staff: UserRecord = {
      id: createId('staff'),
      role: 'staff',
      name,
      phone: input.phone?.trim() || undefined,
      notes: input.notes?.trim() || undefined,
      username,
      passwordHash: await hashSecret(temporaryPassword),
      mustChangePassword: true,
      mustSetPin: true,
      isActive: true,
      storeId: input.storeId,
      positionId: input.positionId,
      permissionOverrides,
      createdAt: new Date().toISOString(),
    };
    saveUsers([...users, staff]);
    await logUserMutation({
      storeId: input.storeId,
      action: 'staff.created',
      summary: `Created staff account "${staff.name}".`,
      entityType: 'staff',
      entityId: staff.id,
      after: withoutPassword(staff),
    });
    const staffSummary = await this.getUser(staff.id);
    if (!staffSummary) throw new Error('The new staff account could not be loaded.');
    return { staff: staffSummary, temporaryPassword };
  },

  async resetStaffPassword(userId: string): Promise<string> {
    if (isSupabaseDriver()) {
      const temporaryPassword = await resetPassword(userId);
      const staff = await getProfile(userId);
      if (staff?.storeId) {
        await activityService.log({
          storeId: staff.storeId,
          action: 'staff.password_reset',
          summary: `Reset the password for "${staff.name}".`,
          entityType: 'staff',
          entityId: staff.id,
          meta: { after: { mustChangePassword: true } },
        });
      }
      return temporaryPassword;
    }
    const users = getUsers();
    const staff = users.find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!staff) throw new Error('Staff account could not be found.');
    const temporaryPassword = makeStaffTemporaryPassword();
    const updated = {
      ...staff,
      passwordHash: await hashSecret(temporaryPassword),
      password: undefined,
      mustChangePassword: true,
      pinHash: undefined,
      mustSetPin: true,
      sessionVersion: (staff.sessionVersion ?? 0) + 1,
    };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    removeData(`staff-pin-attempts:${userId}`);
    await logUserMutation({
      storeId: staff.storeId ?? '',
      action: 'staff.password_reset',
      summary: `Reset the password for "${staff.name}".`,
      entityType: 'staff',
      entityId: staff.id,
      before: { mustChangePassword: staff.mustChangePassword },
      after: { mustChangePassword: true, mustSetPin: true, hasPin: false },
    });
    return temporaryPassword;
  },

  async resetStaffPin(ownerId: string, staffId: string, pin: string): Promise<void> {
    if (isSupabaseDriver()) {
      if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain exactly 4 digits.');
      const { data: authData, error: authError } = await getSupabaseClient().auth.getUser();
      if (authError || authData.user?.id !== ownerId) throw new Error('Only this store owner can reset this staff PIN.');
      const { error } = await getSupabaseClient().rpc('set_staff_pin_by_owner', { p_staff_id: staffId, p_pin: pin });
      if (error) throw new Error(`Could not reset the staff PIN: ${error.message}`, { cause: error });
      const staff = await getProfile(staffId);
      if (staff?.storeId) {
        await activityService.log({
          storeId: staff.storeId,
          action: 'staff.pin_reset',
          summary: `Reset the personal PIN for "${staff.name}".`,
          entityType: 'staff',
          entityId: staff.id,
          meta: { after: { hasPin: true } },
        });
      }
      return;
    }
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN must contain exactly 4 digits.');
    const users = getUsers();
    const owner = users.find((candidate) => candidate.id === ownerId && candidate.role === 'owner');
    const staff = users.find((candidate) => candidate.id === staffId && candidate.role === 'staff');
    const store = owner?.storeId ? getStores().find((candidate) => candidate.id === owner.storeId) : undefined;
    if (!owner || !staff || !store || store.ownerId !== owner.id || owner.storeId !== staff.storeId) {
      throw new Error('Only this store owner can reset this staff PIN.');
    }
    if (staff.mustChangePassword || staff.mustSetPin || !staff.pinHash) {
      throw new Error('The staff member must complete first-login PIN setup before their PIN can be reset.');
    }
    const pinHash = await hashSecret(pin);
    saveUsers(users.map((candidate) => candidate.id === staffId ? { ...candidate, pinHash, mustSetPin: false } : candidate));
    removeData(`staff-pin-attempts:${staffId}`);
    await logUserMutation({
      storeId: store.id,
      actorId: owner.id,
      action: 'staff.pin_reset',
      summary: `Reset the personal PIN for "${staff.name}".`,
      entityType: 'staff',
      entityId: staff.id,
      before: { hasPin: Boolean(staff.pinHash) },
      after: { hasPin: true },
    });
  },

  async forceLogoutStaff(userId: string): Promise<void> {
    if (isSupabaseDriver()) {
      const { error } = await getSupabaseClient().rpc('force_logout_staff', { p_staff_id: userId });
      if (error) throw new Error(`Could not force logout staff: ${error.message}`, { cause: error });
      const staff = await getProfile(userId);
      if (staff?.storeId) {
        await activityService.log({
          storeId: staff.storeId,
          action: 'staff.force_logged_out',
          summary: `Force-logged out "${staff.name}".`,
          entityType: 'staff',
          entityId: staff.id,
        });
      }
      return;
    }
    const users = getUsers();
    const staff = users.find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!staff) throw new Error('Staff account could not be found.');
    const updated = { ...staff, sessionVersion: (staff.sessionVersion ?? 0) + 1 };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    if (staff.storeId) {
      await logUserMutation({
        storeId: staff.storeId,
        action: 'staff.force_logged_out',
        summary: `Force-logged out "${staff.name}".`,
        entityType: 'staff',
        entityId: staff.id,
        before: { sessionVersion: staff.sessionVersion ?? 0 },
        after: { sessionVersion: updated.sessionVersion },
      });
    }
  },

  async updateStaff(this: UserServiceContext, userId: string, changes: { name?: string; phone?: string; notes?: string; positionId?: string; isActive?: boolean }): Promise<UserSummary> {
    if (isSupabaseDriver()) {
      if (changes.name !== undefined && !changes.name.trim()) throw new Error('Staff name is required.');
      const { error } = await getSupabaseClient().from('profiles').update({
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone.trim() || null } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes.trim() || null } : {}),
        ...(changes.positionId !== undefined ? { position_id: changes.positionId } : {}),
        ...(changes.isActive !== undefined ? { is_active: changes.isActive } : {}),
      }).eq('id', userId).eq('role', 'staff');
      if (error) throw new Error(`Could not update staff account: ${error.message}`, { cause: error });
      if (changes.positionId !== undefined) notifyPermissionsChanged();
      const updated = await this.getUser(userId);
      if (!updated) throw new Error('Updated staff account could not be loaded.');
      if (updated.storeId) {
        await activityService.log({
          storeId: updated.storeId,
          action: changes.positionId !== undefined ? 'staff.permission_changed' : 'staff.updated',
          summary: `Updated staff account "${updated.name}".`,
          entityType: 'staff',
          entityId: updated.id,
          meta: { after: { name: updated.name, phone: updated.phone, notes: updated.notes, positionId: updated.positionId, isActive: updated.isActive } },
        });
      }
      return updated;
    }
    const users = getUsers();
    const user = users.find((candidate) => candidate.id === userId && candidate.role === 'staff');
    if (!user) throw new Error('Staff account could not be found.');
    if (changes.name !== undefined && !changes.name.trim()) throw new Error('Staff name is required.');
    if (changes.positionId && !getPositions().some((position) => position.id === changes.positionId && position.storeId === user.storeId)) {
      throw new Error('Select a position from this store.');
    }
    const updated = {
      ...user,
      ...changes,
      name: changes.name?.trim() ?? user.name,
      phone: changes.phone !== undefined ? changes.phone.trim() || undefined : user.phone,
      notes: changes.notes !== undefined ? changes.notes.trim() || undefined : user.notes,
    };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    if (changes.positionId !== undefined) notifyPermissionsChanged();
    await logUserMutation({
      storeId: user.storeId ?? '',
      action: changes.positionId !== undefined ? 'staff.permission_changed' : 'staff.updated',
      summary: `Updated staff account "${updated.name}".`,
      entityType: 'staff',
      entityId: user.id,
      before: { name: user.name, phone: user.phone, notes: user.notes, positionId: user.positionId, isActive: user.isActive },
      after: { name: updated.name, phone: updated.phone, notes: updated.notes, positionId: updated.positionId, isActive: updated.isActive },
    });
    const updatedUser = await this.getUser(userId);
    if (!updatedUser) throw new Error('Updated staff account could not be loaded.');
    return updatedUser;
  },
};
