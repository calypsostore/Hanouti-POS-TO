import { resolveStoreSettings, type StoreRecord, type StoreSettings } from '../../types/domain';
import { hashSecret, verifySecret } from '../secretService';
import { readData } from '../storage';
import { activityService } from '../activityService';
import { getLogoDefinition } from '../../data/logoCatalog';
import { getSupabaseClient } from '../../data/supabaseClient';
import { isSupabaseDriver } from '../../data/driver';
import { invalidateQueryCache } from '../../lib/queryCache';
import { getStore as getRemoteStore } from '../../data/repositories/storeRepository';
import { mergeStoreAppearance } from '../../theme/themeRegistry';
import { getStores, getUsers, getPositions, saveStores, saveUsers, logUserMutation, notifyStoreSettingsChanged } from './userHelpers';
import { resolveEffectivePermissionIds } from './userValidation';

export const storeSettingsMethods = {
  async updateStoreSettings(
    storeId: string,
    ownerId: string,
    changes: {
      defaultSettlementTerms?: StoreSettings['defaultSettlementTerms'];
      blindShiftClosing?: StoreSettings['blindShiftClosing'];
      notificationPreferences?: Partial<StoreSettings['notificationPreferences']>;
      quickPickMode?: StoreSettings['quickPickMode'];
      quickPickItemIds?: StoreSettings['quickPickItemIds'];
      storeType?: StoreSettings['storeType'];
      ticketHeaderText?: string[];
      ticketFooterText?: string[];
      reportFooterText?: string[];
      storeLogoId?: string;
      showLogo?: boolean;
      showAddress?: boolean;
      showPhone?: boolean;
      showStaffName?: boolean;
      showDateTime?: boolean;
      paperWidth?: 58 | 80;
      appearance?: StoreSettings['appearance'];
    },
  ): Promise<StoreRecord> {
    if (changes.storeType !== undefined &&
      !['general', 'coffee', 'restaurant', 'bakery', 'grocery'].includes(changes.storeType)) {
      throw new Error('Choose a valid store type.');
    }
    if (changes.quickPickMode !== undefined && !['auto', 'manual'].includes(changes.quickPickMode)) {
      throw new Error('Choose automatic or manual Quick Picks.');
    }
    if (changes.quickPickItemIds &&
      changes.quickPickItemIds.some((itemId) => typeof itemId !== 'string' || !itemId.trim())) {
      throw new Error('Quick Pick product selections are invalid.');
    }
    const normalizedChanges = changes.quickPickItemIds
      ? { ...changes, quickPickItemIds: [...new Set(changes.quickPickItemIds)] }
      : changes;
    if (isSupabaseDriver()) {
      if (changes.defaultSettlementTerms !== undefined &&
        !['weekly', 'monthly', 'anytime'].includes(changes.defaultSettlementTerms)) {
        throw new Error('Choose valid default customer settlement terms.');
      }
      if (changes.notificationPreferences &&
        Object.values(changes.notificationPreferences).some((enabled) => typeof enabled !== 'boolean')) {
        throw new Error('Notification preferences must be enabled or disabled.');
      }
      if (changes.storeLogoId !== undefined && changes.storeLogoId !== '' && !getLogoDefinition(changes.storeLogoId)) {
        throw new Error('Choose a logo from the platform logo catalog.');
      }
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can change store settings.');
      const currentSettings = resolveStoreSettings(store.settings);
      const settings = {
        ...currentSettings,
        ...normalizedChanges,
        appearance: normalizedChanges.appearance
          ? mergeStoreAppearance(currentSettings.appearance, normalizedChanges.appearance)
          : currentSettings.appearance,
        notificationPreferences: {
          ...currentSettings.notificationPreferences,
          ...normalizedChanges.notificationPreferences,
        },
      };
      const { error } = await getSupabaseClient().from('store_settings').upsert({ store_id: storeId, settings });
      if (error) throw new Error(`Could not save store settings: ${error.message}`, { cause: error });
      invalidateQueryCache(['stores', 'store_settings']);
      notifyStoreSettingsChanged();
      await activityService.log({
        storeId,
        action: 'store.settings_changed',
        summary: 'Updated store preferences.',
        entityType: 'store',
        entityId: storeId,
        meta: { before: store.settings, after: settings },
      });
      return { ...store, settings };
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error('Only this store owner can change store settings.');
    }
    if (changes.defaultSettlementTerms !== undefined &&
      !['weekly', 'monthly', 'anytime'].includes(changes.defaultSettlementTerms)) {
      throw new Error('Choose valid default customer settlement terms.');
    }
    if (changes.notificationPreferences &&
      Object.values(changes.notificationPreferences).some((enabled) => typeof enabled !== 'boolean')) {
      throw new Error('Notification preferences must be enabled or disabled.');
    }
    if (changes.storeLogoId !== undefined && changes.storeLogoId !== '' && !getLogoDefinition(changes.storeLogoId)) {
      throw new Error('Choose a logo from the platform logo catalog.');
    }
    const currentSettings = resolveStoreSettings(store.settings);
    const settings: StoreSettings = {
      ...currentSettings,
      ...normalizedChanges,
      appearance: normalizedChanges.appearance
        ? mergeStoreAppearance(currentSettings.appearance, normalizedChanges.appearance)
        : currentSettings.appearance,
      notificationPreferences: {
        ...currentSettings.notificationPreferences,
        ...normalizedChanges.notificationPreferences,
      },
    };
    const updated = { ...store, settings };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    notifyStoreSettingsChanged();
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary: 'Updated store preferences.',
      entityType: 'store',
      entityId: store.id,
      before: store.settings ?? currentSettings,
      after: settings,
    });
    return updated;
  },

  async updateStorePin(storeId: string, pin: string): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      if (!/^\d{4}$/.test(pin)) throw new Error('Admin PIN must contain exactly 4 digits.');
      const store = await getRemoteStore(storeId);
      if (!store) throw new Error('The store could not be found.');
      const { error } = await getSupabaseClient().rpc('set_store_admin_pin', { p_store_id: storeId, p_pin: pin });
      if (error) throw new Error(`Could not update Admin PIN: ${error.message}`, { cause: error });
      await activityService.log({
        storeId,
        action: 'store.pin_changed',
        summary: 'Changed the store Admin PIN.',
        entityType: 'store',
        entityId: store.id,
        meta: { before: { pinMustChange: store.pinMustChange }, after: { pinMustChange: false } },
      });
      return { ...store, pinMustChange: false };
    }
    if (!/^\d{4}$/.test(pin)) throw new Error('Admin PIN must contain exactly 4 digits.');
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    const updated = { ...store, adminPin: undefined, adminPinHash: await hashSecret(pin), pinMustChange: false };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      action: 'store.pin_changed',
      summary: 'Changed the store Admin PIN.',
      entityType: 'store',
      entityId: store.id,
      before: { pinMustChange: store.pinMustChange },
      after: { pinMustChange: false },
    });
    return updated;
  },

  async verifyStorePin(storeId: string, pin: string, purpose: 'credit_override' | 'void' | 'z_report' = 'credit_override'): Promise<boolean> {
    if (isSupabaseDriver()) {
      const { data, error } = await getSupabaseClient().rpc('verify_store_pin', {
        p_store_id: storeId,
        p_pin: pin,
        p_purpose: purpose,
      });
      if (error) {
        if (error.message.includes('temporarily locked')) throw new Error('PIN verification is temporarily locked.');
        throw new Error(`Could not verify the Admin PIN: ${error.message}`, { cause: error });
      }
      return data === true;
    }
    const session = readData<{ userId: string } | null>('auth-session', null);
    const users = getUsers();
    const activeUser = session?.userId
      ? users.find((candidate) => candidate.id === session.userId && candidate.storeId === storeId && candidate.isActive)
      : undefined;
    const position = activeUser?.positionId
      ? getPositions().find((candidate) => candidate.id === activeUser.positionId && candidate.storeId === storeId)
      : undefined;
    const permissions = new Set(resolveEffectivePermissionIds(
      position?.permissionIds ?? [],
      activeUser?.permissionOverrides?.granted,
      activeUser?.permissionOverrides?.revoked,
    ));
    const usesStaffPin = (purpose === 'z_report' && permissions.has('manage_shifts')) ||
      (purpose === 'void' && permissions.has('resolve_voids'));
    if (usesStaffPin && activeUser?.role === 'staff') {
      if (!activeUser.pinHash) return false;
      const result = await verifySecret(activeUser.pinHash, pin);
      if (result.valid && result.needsRehash) {
        const pinHash = await hashSecret(pin);
        saveUsers(users.map((candidate) => candidate.id === activeUser.id
          ? { ...candidate, pinHash }
          : candidate));
      }
      return result.valid;
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) return false;
    const result = await verifySecret(store.adminPinHash ?? store.adminPin, pin);
    if (result.valid && result.needsRehash) {
      const updated = { ...store, adminPin: undefined, adminPinHash: await hashSecret(pin) };
      saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    }
    return result.valid;
  },

  async updateStoreInfo(
    storeId: string,
    ownerId: string,
    changes: { name?: string; dailySalesTargetMillimes?: number; address?: string; phone?: string; taxId?: string },
  ): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      if (changes.name !== undefined && !changes.name.trim()) throw new Error('Store name is required.');
      if (changes.dailySalesTargetMillimes !== undefined &&
        (!Number.isSafeInteger(changes.dailySalesTargetMillimes) || changes.dailySalesTargetMillimes < 0)) {
        throw new Error('Daily sales target must be a non-negative amount in millimes.');
      }
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can update store information.');
      const { error } = await getSupabaseClient().from('stores').update({
        ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
        ...(changes.dailySalesTargetMillimes !== undefined ? { daily_sales_target_millimes: changes.dailySalesTargetMillimes } : {}),
        ...(changes.address !== undefined ? { address: changes.address.trim() || null } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone.trim() || null } : {}),
        ...(changes.taxId !== undefined ? { tax_id: changes.taxId.trim() || null } : {}),
      }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update store information: ${error.message}`, { cause: error });
      invalidateQueryCache(['stores', 'store_settings']);
      const updated = { ...store, ...changes, name: changes.name?.trim() ?? store.name };
      await activityService.log({
        storeId,
        actorId: ownerId,
        action: 'store.settings_changed',
        summary: 'Updated store information.',
        entityType: 'store',
        entityId: storeId,
        meta: {
          before: { name: store.name, dailySalesTargetMillimes: store.dailySalesTargetMillimes },
          after: { name: updated.name, dailySalesTargetMillimes: updated.dailySalesTargetMillimes },
        },
      });
      return updated;
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error('Only this store owner can update store information.');
    }
    if (changes.name !== undefined && !changes.name.trim()) throw new Error('Store name is required.');
    if (changes.dailySalesTargetMillimes !== undefined &&
      (!Number.isSafeInteger(changes.dailySalesTargetMillimes) || changes.dailySalesTargetMillimes < 0)) {
      throw new Error('Daily sales target must be a non-negative amount in millimes.');
    }
    const updated = { ...store, ...changes, name: changes.name?.trim() ?? store.name };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary: 'Updated store information.',
      entityType: 'store',
      entityId: store.id,
      before: { name: store.name, dailySalesTargetMillimes: store.dailySalesTargetMillimes },
      after: { name: updated.name, dailySalesTargetMillimes: updated.dailySalesTargetMillimes },
    });
    return updated;
  },
};
