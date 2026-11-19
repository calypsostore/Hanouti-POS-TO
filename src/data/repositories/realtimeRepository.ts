import { isSupabaseDriver } from '../driver';
import { getSupabaseClient } from '../supabaseClient';

export type StoreRealtimeTable = 'orders' | 'shifts' | 'notifications' | 'catalog_items';

export function subscribeToStoreChanges(
  storeId: string,
  tables: StoreRealtimeTable[],
  onChange: () => void,
): () => void {
  if (!isSupabaseDriver() || !storeId || tables.length === 0) return () => undefined;
  const channel = getSupabaseClient().channel(`store-changes:${storeId}:${tables.join(',')}`);
  for (const table of new Set(tables)) {
    channel.on('postgres_changes', {
      event: '*',
      schema: 'public',
      table,
      filter: `store_id=eq.${storeId}`,
    }, onChange);
  }
  channel.subscribe((status) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.error(`Realtime subscription failed for store ${storeId}: ${status}`);
    }
  });
  return () => {
    void getSupabaseClient().removeChannel(channel).catch((error: unknown) => {
      console.error('Unable to close store realtime subscription.', error);
    });
  };
}
