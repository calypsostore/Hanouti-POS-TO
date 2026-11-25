import type { StoreRecord, StoreSubscription } from '../../types/domain';
import { getSupabaseClient } from '../../data/supabaseClient';
import { isSupabaseDriver } from '../../data/driver';
import { activityService } from '../activityService';
import { getStore as getRemoteStore } from '../../data/repositories/storeRepository';
import { assertSuperAdmin, getStores, saveStores, logUserMutation } from './userHelpers';

export const storeAdministrationMethods = {
  async updateStoreNameAsAdmin(storeId: string, actorId: string, name: string): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      const cleanedName = name.trim();
      if (!cleanedName) throw new Error('Store name is required.');
      const store = await getRemoteStore(storeId);
      if (!store) throw new Error('The store could not be found.');
      const { error } = await getSupabaseClient().from('stores').update({ name: cleanedName }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update store name: ${error.message}`, { cause: error });
      const updated = { ...store, name: cleanedName };
      await activityService.log({
        storeId,
        actorId,
        action: 'store.name_changed',
        summary: `Platform owner changed store name to "${cleanedName}".`,
        entityType: 'store',
        entityId: store.id,
        meta: { before: { name: store.name }, after: { name: updated.name } },
      });
      return updated;
    }
    assertSuperAdmin(actorId);
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    const cleanedName = name.trim();
    if (!store) throw new Error('The store could not be found.');
    if (!cleanedName) throw new Error('Store name is required.');
    const updated = { ...store, name: cleanedName };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId,
      action: 'store.name_changed',
      summary: `Platform owner changed store name to "${cleanedName}".`,
      entityType: 'store',
      entityId: store.id,
      before: { name: store.name },
      after: { name: updated.name },
    });
    return updated;
  },

  async updateStoreSubscription(
    storeId: string,
    actorId: string,
    subscription: StoreSubscription,
  ): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      if (!['trial', 'monthly', 'yearly'].includes(subscription.plan)) throw new Error('Choose a valid subscription plan.');
      if (subscription.paidUntil !== null) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(subscription.paidUntil);
        if (!match) throw new Error('Subscription end date must use YYYY-MM-DD format.');
        const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
          throw new Error('Enter a valid subscription end date.');
        }
      }
      if (subscription.notes.length > 2000) throw new Error('Subscription notes must be 2000 characters or fewer.');
      const store = await getRemoteStore(storeId);
      if (!store) throw new Error('The store could not be found.');
      const { error } = await getSupabaseClient().from('stores').update({
        subscription_plan: subscription.plan,
        subscription_paid_until: subscription.paidUntil,
        subscription_notes: subscription.notes,
      }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update subscription: ${error.message}`, { cause: error });
      const updated = { ...store, subscription };
      await activityService.log({
        storeId,
        actorId,
        action: 'store.subscription_changed',
        summary: `Updated subscription for "${store.name}".`,
        entityType: 'store',
        entityId: store.id,
        meta: { before: store.subscription, after: subscription },
      });
      return updated;
    }
    assertSuperAdmin(actorId);
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    if (!['trial', 'monthly', 'yearly'].includes(subscription.plan)) {
      throw new Error('Choose a valid subscription plan.');
    }
    if (subscription.paidUntil !== null) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(subscription.paidUntil);
      if (!match) throw new Error('Subscription end date must use YYYY-MM-DD format.');
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
        throw new Error('Enter a valid subscription end date.');
      }
    }
    const notes = subscription.notes.trim();
    if (notes.length > 1000) throw new Error('Subscription notes must be 1000 characters or fewer.');
    const updated = { ...store, subscription: { ...subscription, notes } };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId,
      action: 'store.subscription_changed',
      summary: `Updated ${store.name} subscription (${subscription.plan}${subscription.paidUntil ? ` through ${subscription.paidUntil}` : ', no end date'}).`,
      entityType: 'store',
      entityId: store.id,
      before: store.subscription,
      after: updated.subscription,
    });
    return updated;
  },

  async archiveStore(storeId: string, actorId: string): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store) throw new Error('The store could not be found.');
      const archivedAt = new Date().toISOString();
      const { error } = await getSupabaseClient().from('stores').update({ is_active: false, archived_at: archivedAt }).eq('store_id', storeId);
      if (error) throw new Error(`Could not archive store: ${error.message}`, { cause: error });
      await activityService.log({
        storeId,
        actorId,
        action: 'store.archived',
        summary: `Archived store "${store.name}".`,
        entityType: 'store',
        entityId: store.id,
        meta: { before: { isActive: store.isActive, archivedAt: store.archivedAt }, after: { isActive: false, archivedAt } },
      });
      return { ...store, isActive: false, archivedAt };
    }
    assertSuperAdmin(actorId);
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    if (store.archivedAt) return store;
    const updated = { ...store, isActive: false, archivedAt: new Date().toISOString() };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      actorId,
      action: 'store.archived',
      summary: `Archived store "${store.name}".`,
      entityType: 'store',
      entityId: store.id,
      before: { isActive: store.isActive, archivedAt: store.archivedAt },
      after: { isActive: updated.isActive, archivedAt: updated.archivedAt },
    });
    return updated;
  },

  async clearDayClosed(storeId: string): Promise<void> {
    if (isSupabaseDriver()) return;
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    saveStores(stores.map((store) => store.id === storeId ? { ...store, dayClosedOn: undefined } : store));
    if (store.dayClosedOn) {
      await logUserMutation({
        storeId,
        action: 'store.day_reopened',
        summary: 'Reopened the business day.',
        entityType: 'store',
        entityId: store.id,
        before: { dayClosedOn: store.dayClosedOn },
        after: { dayClosedOn: undefined },
      });
    }
  },

  async suspendStore(storeId: string, isActive: boolean): Promise<StoreRecord> {
    if (isSupabaseDriver()) {
      const store = await getRemoteStore(storeId);
      if (!store) throw new Error('The store could not be found.');
      const { error } = await getSupabaseClient().from('stores').update({ is_active: isActive }).eq('store_id', storeId);
      if (error) throw new Error(`Could not update store status: ${error.message}`, { cause: error });
      await activityService.log({
        storeId,
        action: 'store.status_changed',
        summary: `${isActive ? 'Activated' : 'Suspended'} store "${store.name}".`,
        entityType: 'store',
        entityId: store.id,
        meta: { before: { isActive: store.isActive }, after: { isActive } },
      });
      return { ...store, isActive };
    }
    const stores = getStores();
    const store = stores.find((candidate) => candidate.id === storeId);
    if (!store) throw new Error('The store could not be found.');
    const updated = { ...store, isActive };
    saveStores(stores.map((candidate) => candidate.id === storeId ? updated : candidate));
    await logUserMutation({
      storeId,
      action: 'store.status_changed',
      summary: `${isActive ? 'Activated' : 'Suspended'} store "${store.name}".`,
      entityType: 'store',
      entityId: store.id,
      before: { isActive: store.isActive },
      after: { isActive: updated.isActive },
    });
    return updated;
  },
};
