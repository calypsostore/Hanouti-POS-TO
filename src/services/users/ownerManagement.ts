import { resolveStoreSettings, type StoreRecord, type UserRecord, type UserSummary } from '../../types/domain';
import { hashSecret } from '../secretService';
import { activityService } from '../activityService';
import { getSupabaseClient } from '../../data/supabaseClient';
import { isSupabaseDriver } from '../../data/driver';
import { createOwnerAccount, resetPassword } from '../../data/repositories/accountRepository';
import { getProfile } from '../../data/repositories/profileRepository';
import { generateStoreCode } from '../accountIdentity';
import { getUsers, getStores, saveUsers, saveStores, makeTemporaryPassword, createId, localDateKey, assertSuperAdmin, withoutPassword, logUserMutation } from './userHelpers';
import type { UserServiceContext } from './types';

export const ownerManagementMethods = {
  async createOwnerAccount(this: UserServiceContext, input: { name: string; email: string; storeName: string }): Promise<{ owner: UserSummary; store: StoreRecord; temporaryPassword: string }> {
    if (isSupabaseDriver()) return createOwnerAccount(input);
    const users = getUsers();
    if (users.some((user) => user.email?.toLocaleLowerCase() === input.email.toLocaleLowerCase())) {
      throw new Error('An account already uses this email address.');
    }
    const storeName = input.storeName.trim();
    if (!storeName) throw new Error('Store name is required.');
    const existingStores = getStores();
    const code = generateStoreCode(storeName, existingStores.map((store) => store.code));

    const temporaryPassword = makeTemporaryPassword();
    const ownerId = createId('owner');
    const defaultPinHash = await hashSecret('1234');
    const store: StoreRecord = {
      id: createId('store'),
      ownerId,
      code,
      name: storeName,
      adminPinHash: defaultPinHash,
      pinMustChange: true,
      isActive: true,
      settings: resolveStoreSettings(),
      subscription: {
        plan: 'trial',
        paidUntil: (() => {
          const end = new Date();
          end.setDate(end.getDate() + 14);
          return localDateKey(end);
        })(),
        notes: '',
      },
      createdAt: new Date().toISOString(),
    };
    const owner: UserRecord = {
      id: ownerId,
      role: 'owner',
      name: input.name.trim(),
      email: input.email.trim(),
      passwordHash: await hashSecret(temporaryPassword),
      mustChangePassword: true,
      mustSetPin: true,
      isActive: true,
      storeId: store.id,
      createdAt: new Date().toISOString(),
    };
    saveUsers([...users, owner]);
    saveStores([...getStores(), store]);
    await logUserMutation({
      storeId: store.id,
      actorId: undefined,
      action: 'store.created',
      summary: `Created store "${store.name}" and its owner account.`,
      entityType: 'store',
      entityId: store.id,
      after: { store: { id: store.id, name: store.name, code: store.code }, owner: withoutPassword(owner) },
    });
    const ownerSummary = await this.getUser(owner.id);
    if (!ownerSummary) throw new Error('The new owner account could not be loaded.');
    return { owner: ownerSummary, store, temporaryPassword };
  },

  async resetOwnerPassword(ownerId: string, actorId: string): Promise<string> {
    if (isSupabaseDriver()) {
      const actor = await getProfile(actorId);
      if (!actor || actor.role !== 'super_admin') throw new Error('Only an active platform owner can manage stores.');
      const temporaryPassword = await resetPassword(ownerId);
      const owner = await getProfile(ownerId);
      if (owner?.storeId) {
        await activityService.log({
          storeId: owner.storeId,
          actorId: actor.id,
          action: 'owner.password_reset',
          summary: `Platform owner reset the password for "${owner.name}".`,
          entityType: 'owner',
          entityId: owner.id,
          meta: { after: { mustChangePassword: true } },
        });
      }
      return temporaryPassword;
    }
    assertSuperAdmin(actorId);
    const users = getUsers();
    const owner = users.find((candidate) => candidate.id === ownerId && candidate.role === 'owner');
    if (!owner || !owner.storeId) throw new Error('Owner account could not be found.');
    const temporaryPassword = makeTemporaryPassword();
    const updated: UserRecord = {
      ...owner,
      passwordHash: await hashSecret(temporaryPassword),
      password: undefined,
      mustChangePassword: true,
      pinHash: undefined,
      mustSetPin: true,
      sessionVersion: (owner.sessionVersion ?? 0) + 1,
    };
    saveUsers(users.map((candidate) => candidate.id === ownerId ? updated : candidate));
    await logUserMutation({
      storeId: owner.storeId,
      actorId,
      action: 'owner.password_reset',
      summary: `Platform owner reset the password for "${owner.name}".`,
      entityType: 'owner',
      entityId: owner.id,
      before: { mustChangePassword: owner.mustChangePassword },
      after: { mustChangePassword: true, mustSetPin: true, hasPin: false },
    });
    return temporaryPassword;
  },

  async suspendOwner(this: UserServiceContext, userId: string, isActive: boolean): Promise<UserSummary> {
    if (isSupabaseDriver()) {
      const { error } = await getSupabaseClient().from('profiles').update({ is_active: isActive }).eq('id', userId).eq('role', 'owner');
      if (error) throw new Error(`Could not update owner account: ${error.message}`, { cause: error });
      const updated = await getProfile(userId);
      if (!updated) throw new Error('Updated owner account could not be loaded.');
      if (updated.storeId) {
        await activityService.log({
          storeId: updated.storeId,
          action: 'owner.status_changed',
          summary: `${isActive ? 'Activated' : 'Suspended'} owner "${updated.name}".`,
          entityType: 'owner',
          entityId: updated.id,
          meta: { after: { isActive: updated.isActive } },
        });
      }
      return updated;
    }
    const users = getUsers();
    const owner = users.find((candidate) => candidate.id === userId && candidate.role === 'owner');
    if (!owner) throw new Error('Owner account could not be found.');
    const updated = { ...owner, isActive };
    saveUsers(users.map((candidate) => candidate.id === userId ? updated : candidate));
    if (owner.storeId) {
      await logUserMutation({
        storeId: owner.storeId,
        action: 'owner.status_changed',
        summary: `${isActive ? 'Activated' : 'Suspended'} owner "${owner.name}".`,
        entityType: 'owner',
        entityId: owner.id,
        before: { isActive: owner.isActive },
        after: { isActive: updated.isActive },
      });
    }
    const updatedUser = await this.getUser(userId);
    if (!updatedUser) throw new Error('Updated owner account could not be loaded.');
    return updatedUser;
  },
};
