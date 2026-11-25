import type { ProfileAvatarId, UserSummary } from '../../types/domain';
import { getSupabaseClient } from '../../data/supabaseClient';
import { isSupabaseDriver } from '../../data/driver';
import { getProfile } from '../../data/repositories/profileRepository';
import { isProfileAvatarId } from '../../data/profileAvatars';
import { authService } from '../authService';
import { getUsers, saveUsers, withoutPassword, logUserMutation } from './userHelpers';

export const userProfileMethods = {
  async updateOwnerProfile(ownerId: string, changes: { name: string; phone: string }): Promise<UserSummary> {
    const name = changes.name.trim();
    const phone = changes.phone.trim();
    if (!name || name.length > 200) throw new Error('Owner name is required and must be 200 characters or fewer.');
    if (phone.length > 100) throw new Error('Phone must be 100 characters or fewer.');
    if (isSupabaseDriver()) {
      const client = getSupabaseClient();
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || authData.user?.id !== ownerId) {
        throw new Error('Only the signed-in store owner can update this profile.', { cause: authError });
      }
      const { error } = await client.rpc('update_owner_profile', {
        p_name: name,
        p_phone: phone || null,
      });
      if (error) throw new Error(`Could not update owner profile: ${error.message}`, { cause: error });
      const updatedOwner = await getProfile(ownerId);
      if (!updatedOwner || updatedOwner.role !== 'owner') throw new Error('The updated owner profile could not be loaded.');
      return updatedOwner;
    }
    const currentUser = await authService.getCurrentUser();
    if (!currentUser || currentUser.id !== ownerId || currentUser.role !== 'owner') {
      throw new Error('Only the signed-in store owner can update this profile.');
    }
    const users = getUsers();
    const owner = users.find((candidate) =>
      candidate.id === ownerId && candidate.role === 'owner' && candidate.storeId === currentUser.storeId,
    );
    if (!owner) throw new Error('The owner profile could not be found.');
    const updatedOwner = { ...owner, name, phone: phone || undefined };
    saveUsers(users.map((candidate) => candidate.id === ownerId ? updatedOwner : candidate));
    if (owner.storeId) {
      await logUserMutation({
        storeId: owner.storeId,
        actorId: owner.id,
        action: 'owner.profile_changed',
        summary: 'Updated owner profile details.',
        entityType: 'owner',
        entityId: owner.id,
        before: { name: owner.name, phone: owner.phone },
        after: { name, phone: phone || undefined },
      });
    }
    return withoutPassword(updatedOwner);
  },

  async updateProfileAvatar(userId: string, avatarId: ProfileAvatarId): Promise<UserSummary> {
    if (!isProfileAvatarId(avatarId)) throw new Error('Choose one of the available profile avatars.');
    const currentUser = await authService.getCurrentUser();
    if (!currentUser || currentUser.id !== userId) {
      throw new Error('Only the signed-in user can update this profile avatar.');
    }
    if (isSupabaseDriver()) {
      const { error } = await getSupabaseClient().rpc('update_profile_avatar', { p_avatar_id: avatarId });
      if (error) throw new Error(`Could not update profile avatar: ${error.message}`, { cause: error });
      const updatedUser = await getProfile(userId);
      if (!updatedUser) throw new Error('The updated profile could not be loaded.');
      return updatedUser;
    }
    const users = getUsers();
    const profile = users.find((candidate) => candidate.id === userId);
    if (!profile) throw new Error('The profile could not be found.');
    const updatedUser = { ...profile, avatarId };
    saveUsers(users.map((candidate) => candidate.id === userId ? updatedUser : candidate));
    return withoutPassword(updatedUser);
  },
};
