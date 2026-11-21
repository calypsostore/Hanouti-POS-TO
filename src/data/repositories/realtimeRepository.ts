import { isSupabaseDriver } from '../driver';
import { getSupabaseClient } from '../supabaseClient';
import { invalidateQueryCache } from '../../lib/queryCache';

export type StoreRealtimeTable = 'orders' | 'shifts' | 'notifications' | 'catalog_items' | 'categories' | 'stores' | 'store_settings';

export function subscribeToStoreChanges(
  storeId: string,
  tables: StoreRealtimeTable[],
  onChange: () => void,
): () => void {
  if (!isSupabaseDriver() || !storeId || tables.length === 0) return () => undefined;
  let refreshTimer: number | undefined;
  let disposed = false;
  const scheduleRefresh = (table: StoreRealtimeTable) => {
    invalidateQueryCache([table]);
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(() => {
      if (!disposed) onChange();
    }, 250);
  };
  const channel = getSupabaseClient().channel(`store-changes:${storeId}:${tables.join(',')}`);
  for (const table of new Set(tables)) {
    channel.on('postgres_changes', {
      event: '*',
      schema: 'public',
      table,
      filter: `store_id=eq.${storeId}`,
    }, () => scheduleRefresh(table));
  }
  channel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.error(`Realtime subscription failed for store ${storeId}: ${status}`);
    }
  });
  return () => {
    disposed = true;
    if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    void getSupabaseClient().removeChannel(channel).catch((error: unknown) => {
      console.error('Unable to close store realtime subscription.', error);
    });
  };
}
