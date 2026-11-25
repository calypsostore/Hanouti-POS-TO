import type { StoreRecord } from '../../types/domain';
import { activityService } from '../activityService';
import { getSupabaseClient } from '../../data/supabaseClient';
import { isSupabaseDriver } from '../../data/driver';
import { invalidateQueryCache } from '../../lib/queryCache';
import { getStore as getRemoteStore } from '../../data/repositories/storeRepository';
import { STORE_AUTO_LOCK_CHANGED_EVENT } from '../userEvents';
import { getStores, getUsers, saveStores, logUserMutation } from './userHelpers';

export const storePreferenceMethods = {
  async updateCustomerCreditBalanceSetting(storeId: string, ownerId: string, allowed: boolean): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can change customer credit settings.');
      const { error } = await getSupabaseClient().from('stores').update({ allow_customer_credit_balance: allowed }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update customer credit settings: ${error.message}`, { cause: error });
      invalidateQueryCache(['stores']);
      const updated = { ...store, allowCustomerCreditBalance: allowed };
      await activityService.log({
        storeId,
        actorId: ownerId,
        action: 'store.settings_changed',
        summary: 'Updated customer credit balance settings.',
        entityType: 'store',
        entityId: storeId,
        meta: { before: { allowCustomerCreditBalance: store.allowCustomerCreditBalance }, after: { allowCustomerCreditBalance: allowed } },
      });
      return updated;
    }
    const store = getStores().find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error('Only this store owner can change customer credit settings.');
    }
    const updated = { ...store, allowCustomerCreditBalance: allowed };
    saveStores(getStores().map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary: 'Updated customer credit balance settings.',
      entityType: 'store',
      entityId: store.id,
      before: { allowCustomerCreditBalance: store.allowCustomerCreditBalance },
      after: { allowCustomerCreditBalance: updated.allowCustomerCreditBalance },
    });
    return updated;
  },

  async updateStorePaymentSettings(
    storeId: string,
    ownerId: string,
    changes: Pick<StoreRecord, 'allowCardPayments' | 'allowOtherPayments'>,
  ): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can change POS payment methods.');
      const { error } = await getSupabaseClient().from('stores').update({
        ...(changes.allowCardPayments !== undefined ? { allow_card_payments: changes.allowCardPayments } : {}),
        ...(changes.allowOtherPayments !== undefined ? { allow_other_payments: changes.allowOtherPayments } : {}),
      }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update payment settings: ${error.message}`, { cause: error });
      invalidateQueryCache(['stores']);
      const updated = { ...store, ...changes };
      await activityService.log({
        storeId,
        actorId: ownerId,
        action: 'store.settings_changed',
        summary: 'Updated accepted payment methods.',
        entityType: 'store',
        entityId: storeId,
        meta: {
          before: { allowCardPayments: store.allowCardPayments, allowOtherPayments: store.allowOtherPayments },
          after: { allowCardPayments: updated.allowCardPayments, allowOtherPayments: updated.allowOtherPayments },
        },
      });
      return updated;
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error('Only this store owner can change POS payment methods.');
    }
    const updated = { ...store, ...changes };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary: 'Updated accepted payment methods.',
      entityType: 'store',
      entityId: store.id,
      before: { allowCardPayments: store.allowCardPayments, allowOtherPayments: store.allowOtherPayments },
      after: { allowCardPayments: updated.allowCardPayments, allowOtherPayments: updated.allowOtherPayments },
    });
    return updated;
  },

  async updateStoreAutoLockMinutes(
    storeId: string,
    ownerId: string,
    audience: 'staff' | 'owner',
    minutes: number,
  ): Promise<StoreRecord> {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 60) {
      throw new Error('Auto-lock timeout must be between 0 and 60 minutes.');
    }
    const settingName = audience === 'staff' ? 'staffAutoLockMinutes' : 'ownerAutoLockMinutes';
    const columnName = audience === 'staff' ? 'staff_auto_lock_minutes' : 'owner_auto_lock_minutes';
    const summary = `Updated ${audience} auto-lock timeout.`;
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error(`Only this store owner can change the ${audience} auto-lock timeout.`);
      const { error } = await getSupabaseClient().from('stores').update({ [columnName]: minutes }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update auto-lock timeout: ${error.message}`, { cause: error });
      invalidateQueryCache(['stores']);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORE_AUTO_LOCK_CHANGED_EVENT));
      const updated = { ...store, [settingName]: minutes };
      await activityService.log({
        storeId,
        actorId: ownerId,
        action: 'store.settings_changed',
        summary,
        entityType: 'store',
        entityId: storeId,
        meta: { before: { [settingName]: store[settingName] }, after: { [settingName]: minutes } },
      });
      return updated;
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error(`Only this store owner can change the ${audience} auto-lock timeout.`);
    }
    const updated = { ...store, [settingName]: minutes };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(STORE_AUTO_LOCK_CHANGED_EVENT));
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary,
      entityType: 'store',
      entityId: store.id,
      before: { [settingName]: store[settingName] },
      after: { [settingName]: updated[settingName] },
    });
    return updated;
  },

  async updateCashOutAlertThreshold(storeId: string, ownerId: string, thresholdMillimes: number): Promise<StoreRecord> {
    if (!Number.isSafeInteger(thresholdMillimes) || thresholdMillimes < 0) {
      throw new Error('Cash-out alert threshold must be a non-negative amount in millimes.');
    }
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store || store.ownerId !== ownerId) throw new Error('Only this store owner can change the cash-out alert threshold.');
      const { error } = await getSupabaseClient().from('stores').update({ cash_out_alert_threshold_millimes: thresholdMillimes }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update cash-out threshold: ${error.message}`, { cause: error });
      invalidateQueryCache(['stores']);
      const updated = { ...store, cashOutAlertThresholdMillimes: thresholdMillimes };
      await activityService.log({
        storeId,
        actorId: ownerId,
        action: 'store.settings_changed',
        summary: 'Updated the cash-out alert threshold.',
        entityType: 'store',
        entityId: storeId,
        meta: {
          before: { cashOutAlertThresholdMillimes: store.cashOutAlertThresholdMillimes },
          after: { cashOutAlertThresholdMillimes: thresholdMillimes },
        },
      });
      return updated;
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const owner = getUsers().find((candidate) => candidate.id === ownerId);
    if (!store || !owner || owner.role !== 'owner' || store.ownerId !== owner.id || owner.storeId !== store.id) {
      throw new Error('Only this store owner can change the cash-out alert threshold.');
    }
    const updated = { ...store, cashOutAlertThresholdMillimes: thresholdMillimes };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId: ownerId,
      action: 'store.settings_changed',
      summary: 'Updated the cash-out alert threshold.',
      entityType: 'store',
      entityId: store.id,
      before: { cashOutAlertThresholdMillimes: store.cashOutAlertThresholdMillimes },
      after: { cashOutAlertThresholdMillimes: updated.cashOutAlertThresholdMillimes },
    });
    return updated;
  },
};
