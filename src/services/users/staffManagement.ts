import type { PermissionOverrides, UserRecord, UserSummary } from '../../types/domain';
import { removeData } from '../storage';
import { hashSecret, verifySecret } from '../secretService';
import { activityService } from '../activityService';
import { getSupabaseClient } from '../../data/supabaseClient';
import { isSupabaseDriver } from '../../data/driver';
import { createStaff, resetPassword } from '../../data/repositories/accountRepository';
import { getProfile } from '../../data/repositories/profileRepository';
import { authService } from '../authService';
import { generateStaffPin as createGeneratedStaffPin } from '../staffPin';
import { formatStaffUsername, generateStoreCode } from '../accountIdentity';
import { getUsers, getStores, getPositions, saveUsers, makeStaffTemporaryPassword, createId, withoutPassword, logUserMutation, notifyPermissionsChanged } from './userHelpers';
import { normalizePermissionOverrides } from './userValidation';
import type { UserServiceContext } from './types';

let localPinMutation = Promise.resolve();

async function withLocalPinMutation<T>(operation: () => Promise<T>): Promise<T> {
  const previous = localPinMutation;
  let release: () => void = () => {};
  localPinMutation = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

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

  async generateStaffPin(ownerId: string, staffId: string): Promise<string> {
    if (isSupabaseDriver()) {
      const { data: authData, error: authError } = await getSupabaseClient().auth.getUser();
      if (authError || authData.user?.id !== ownerId) throw new Error('Only this store owner can generate a staff PIN.');
      const { data, error } = await getSupabaseClient().rpc('generate_staff_pin_by_owner', { p_staff_id: staffId });
      if (error) throw new Error('Could not generate the staff PIN.', { cause: error });
      if (typeof data !== 'string' || !/^\d{4}$/.test(data)) throw new Error('Staff PIN generation returned an invalid result.');
      return data;
    }
    return withLocalPinMutation(async () => {
      const owner = await authService.getCurrentUser();
      const users = getUsers();
      const staff = users.find((candidate) => candidate.id === staffId && candidate.role === 'staff');
      const store = owner?.storeId ? getStores().find((candidate) => candidate.id === owner.storeId) : undefined;
      if (!owner || owner.id !== ownerId || owner.role !== 'owner' || !owner.isActive ||
        !staff || !store || !store.isActive || store.ownerId !== owner.id || owner.storeId !== staff.storeId) {
        throw new Error('Only this store owner can generate a staff PIN.');
      }

      const pin = await createGeneratedStaffPin(async (candidatePin) => {
        if (staff.pinHash && (await verifySecret(staff.pinHash, candidatePin)).valid) return false;
        for (const otherStaff of getUsers()) {
          if (otherStaff.role !== 'staff' || otherStaff.storeId !== store.id ||
            otherStaff.id === staff.id || !otherStaff.pinHash) continue;
          if ((await verifySecret(otherStaff.pinHash, candidatePin)).valid) return false;
        }
        return true;
      });
      const pinHash = await hashSecret(pin);
      const latestUsers = getUsers();
      const latestStaff = latestUsers.find((candidate) => candidate.id === staffId && candidate.role === 'staff' && candidate.storeId === store.id);
      if (!latestStaff) throw new Error('Staff account could not be found.');
      if (latestStaff.pinHash && (await verifySecret(latestStaff.pinHash, pin)).valid) {
        throw new Error('A replacement PIN must differ from the current PIN. Generate a new PIN and try again.');
      }
      for (const otherStaff of latestUsers) {
        if (otherStaff.role !== 'staff' || otherStaff.storeId !== store.id ||
          otherStaff.id === staff.id || !otherStaff.pinHash) continue;
        if ((await verifySecret(otherStaff.pinHash, pin)).valid) {
          throw new Error('A staff PIN collision occurred. Generate a new PIN and try again.');
        }
      }

      saveUsers(latestUsers.map((candidate) => candidate.id === staff.id
        ? { ...candidate, pinHash, mustSetPin: false }
        : candidate));
      removeData(`staff-pin-attempts:${staff.id}`);
      await logUserMutation({
        storeId: store.id,
        actorId: owner.id,
        action: latestStaff.pinHash ? 'staff.pin_reset' : 'staff.pin_assigned',
        summary: latestStaff.pinHash
          ? `Generated a replacement PIN for "${staff.name}".`
          : `Generated a PIN for "${staff.name}".`,
        entityType: 'staff',
        entityId: staff.id,
        before: { hasPin: Boolean(latestStaff.pinHash) },
        after: { hasPin: true },
      });
      return pin;
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
