import type {
  CatalogItemRecord,
  CategoryRecord,
  CustomerRecord,
  OrderLineRecord,
  OrderRecord,
  OrderSummaryRecord,
  PaymentMethod,
  ShiftRecord,
  StoreRecord,
} from '../types/domain';
import type { CustomerCreditStatus } from './customerService';
import { createOrder as createRemoteOrder } from '../data/repositories/orderRepository';
import { isSupabaseDriver } from '../data/driver';
import { getSupabaseClient } from '../data/supabaseClient';

const DATABASE_NAME = '7anouti-pos-offline';
const DATABASE_VERSION = 1;
const STORE_NAME = 'records';
const QUEUE_KEY = 'order-queue';
export const OFFLINE_QUEUE_CHANGED_EVENT = '7anouti-offline-queue-changed';
export const OFFLINE_ORDER_SYNCED_EVENT = '7anouti-offline-order-synced';

export interface PosOfflineSnapshot {
  storeId: string;
  userId: string;
  items: CatalogItemRecord[];
  categories: CategoryRecord[];
  customers: CustomerRecord[];
  creditStatuses: Record<string, CustomerCreditStatus>;
  shift?: ShiftRecord;
  store?: StoreRecord;
  orders: OrderSummaryRecord[];
  permissions: {
    can86Items: boolean;
    canCompItems: boolean;
    canUseTabs: boolean;
    canOverrideCreditLimit: boolean;
  };
  cachedAt: string;
}

export interface OfflineOrderInput {
  storeId: string;
  staffId: string;
  items: OrderLineRecord[];
  paymentMethod?: PaymentMethod;
  customerId?: string;
  location?: string;
  note?: string;
}

interface QueuedOrderEntry {
  idempotencyKey: string;
  order: OrderRecord;
  shift: ShiftRecord;
  input: OfflineOrderInput;
  status: 'queued' | 'needs_attention';
  queuedAt: string;
  error?: string;
}

interface SyncedOrderEvent {
  idempotencyKey: string;
  order: OrderRecord;
}

let databasePromise: Promise<IDBDatabase> | undefined;
let flushing = false;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('Offline storage is not available in this browser.'));
  }
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open offline storage.'));
      request.onblocked = () => reject(new Error('Offline storage is blocked by another open tab.'));
    });
  }
  return databasePromise;
}

async function getValue<T>(key: string): Promise<T | undefined> {
  const database = await openDatabase();
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error ?? new Error('Could not read offline storage.'));
  });
}

async function setValue<T>(key: string, value: T): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save offline data.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Saving offline data was interrupted.'));
  });
}

async function updateQueue(
  update: (entries: QueuedOrderEntry[]) => QueuedOrderEntry[],
): Promise<QueuedOrderEntry[]> {
  const database = await openDatabase();
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(QUEUE_KEY);
    let updatedEntries: QueuedOrderEntry[] = [];
    request.onsuccess = () => {
      updatedEntries = update((request.result as QueuedOrderEntry[] | undefined) ?? []);
      store.put(updatedEntries, QUEUE_KEY);
    };
    request.onerror = () => reject(request.error ?? new Error('Could not load queued orders.'));
    transaction.oncomplete = () => resolve(updatedEntries);
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not update queued orders.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Updating queued orders was interrupted.'));
  });
}

function announceQueueChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OFFLINE_QUEUE_CHANGED_EVENT));
}

function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (/fetcherror|networkerror/i.test(error.name)) return true;
  if (/failed to fetch|network request failed|networkerror|load failed|connection|offline|timed out|timeout/i.test(error.message)) return true;
  return isNetworkFailure(error.cause);
}

export const offlineOrderQueue = {
  async cacheSnapshot(snapshot: PosOfflineSnapshot): Promise<void> {
    const key = `pos:${snapshot.storeId}:${snapshot.userId}`;
    await setValue(key, snapshot);
    for (const customer of snapshot.customers) {
      const status = snapshot.creditStatuses[customer.id];
      if (status) await setValue(`customer-credit:${customer.id}`, { customer, status });
    }
  },

  async getSnapshot(storeId: string, userId: string): Promise<PosOfflineSnapshot | undefined> {
    return await getValue<PosOfflineSnapshot>(`pos:${storeId}:${userId}`);
  },

  async getCustomerCredit(customerId: string): Promise<{ customer: CustomerRecord; status: CustomerCreditStatus } | undefined> {
    return await getValue(`customer-credit:${customerId}`);
  },

  async enqueue(entry: Omit<QueuedOrderEntry, 'status' | 'queuedAt'>): Promise<OrderRecord> {
    let queuedOrder = entry.order;
    await updateQueue((entries) => {
      const existing = entries.find((candidate) => candidate.idempotencyKey === entry.idempotencyKey);
      if (existing) {
        queuedOrder = existing.order;
        return entries;
      }
      const nextLocalNumber = Math.max(0, ...entries.map((candidate) =>
        candidate.order.storeId === entry.order.storeId && candidate.order.number < 0
          ? Math.abs(candidate.order.number)
          : 0,
      )) + 1;
      queuedOrder = { ...entry.order, number: -nextLocalNumber };
      return [...entries, { ...entry, order: queuedOrder, status: 'queued' as const, queuedAt: new Date().toISOString() }]
        .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
    });
    announceQueueChanged();
    return queuedOrder;
  },

  async flush(): Promise<void> {
    if (flushing || !isSupabaseDriver() || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    flushing = true;
    try {
      const { data: sessionData, error: sessionError } = await getSupabaseClient().auth.getSession();
      if (sessionError) throw new Error(`Could not check the active account before syncing orders: ${sessionError.message}`, { cause: sessionError });
      if (!sessionData.session) return;
      const entries = ((await getValue<QueuedOrderEntry[]>(QUEUE_KEY)) ?? [])
        .filter((entry) => entry.status === 'queued' && entry.input.staffId === sessionData.session.user.id)
        .sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
      for (const entry of entries) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) break;
        let order: OrderRecord;
        try {
          order = await createRemoteOrder({
            shift: entry.shift,
            items: entry.input.items,
            paymentMethod: entry.input.paymentMethod,
            customerId: entry.input.customerId,
            location: entry.input.location,
            note: entry.input.note,
            idempotencyKey: entry.idempotencyKey,
          });
        } catch (error) {
          if (isNetworkFailure(error) || (typeof navigator !== 'undefined' && !navigator.onLine)) break;
          const message = error instanceof Error ? error.message : 'The server rejected this order.';
          await updateQueue((current) => current.map((candidate) =>
            candidate.idempotencyKey === entry.idempotencyKey
              ? {
                  ...candidate,
                  status: 'needs_attention',
                  order: { ...candidate.order, syncStatus: 'needs_attention' },
                  error: message,
                }
              : candidate,
          ));
          announceQueueChanged();
          continue;
        }
        await updateQueue((current) => current.filter((candidate) => candidate.idempotencyKey !== entry.idempotencyKey));
        const detail: SyncedOrderEvent = {
          idempotencyKey: entry.idempotencyKey,
          order: { ...order, idempotencyKey: entry.idempotencyKey },
        };
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent<SyncedOrderEvent>(OFFLINE_ORDER_SYNCED_EVENT, { detail }));
        }
        announceQueueChanged();
      }
    } finally {
      flushing = false;
    }
  },

  async pendingCount(storeId?: string): Promise<number> {
    return (((await getValue<QueuedOrderEntry[]>(QUEUE_KEY)) ?? []).filter((entry) =>
      entry.status === 'queued' && (!storeId || entry.order.storeId === storeId),
    )).length;
  },

  async pendingOrders(storeId?: string): Promise<OrderRecord[]> {
    return ((await getValue<QueuedOrderEntry[]>(QUEUE_KEY)) ?? [])
      .filter((entry) => !storeId || entry.order.storeId === storeId)
      .map((entry) => entry.order);
  },

  async needsAttention(storeId?: string): Promise<Array<{ order: OrderRecord; message: string }>> {
    return ((await getValue<QueuedOrderEntry[]>(QUEUE_KEY)) ?? [])
      .filter((entry) => entry.status === 'needs_attention' && (!storeId || entry.order.storeId === storeId))
      .map((entry) => ({ order: entry.order, message: entry.error ?? 'The server rejected this order.' }));
  },

  isNetworkFailure,
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void offlineOrderQueue.flush().catch((error: unknown) => {
      console.error('Could not sync offline orders.', error);
    });
  });
}
