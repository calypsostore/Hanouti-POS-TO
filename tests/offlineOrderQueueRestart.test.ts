import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderRecord, ShiftRecord } from '../src/types/domain';

const { createRemoteOrderMock, getSessionMock } = vi.hoisted(() => ({
  createRemoteOrderMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('../src/data/driver', () => ({ isSupabaseDriver: () => true }));
vi.mock('../src/data/repositories/orderRepository', () => ({ createOrder: createRemoteOrderMock }));
vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: () => ({ auth: { getSession: getSessionMock } }),
}));

import { offlineOrderQueue } from '../src/services/offlineOrderQueue';

function makeEntry(key: string) {
  const shift: ShiftRecord = {
    id: `shift-${key}`,
    storeId: 'offline-restart-store',
    staffId: 'offline-restart-user',
    status: 'open',
    startingCashMillimes: 0,
    openedAt: new Date().toISOString(),
  };
  const order: OrderRecord = {
    id: key,
    idempotencyKey: key,
    number: -1,
    storeId: shift.storeId,
    staffId: shift.staffId,
    shiftId: shift.id,
    status: 'done',
    paymentMethod: 'cash',
    items: [],
    totalMillimes: 2_500,
    createdAt: new Date().toISOString(),
  };
  return {
    idempotencyKey: key,
    order,
    shift,
    input: { storeId: shift.storeId, staffId: shift.staffId, items: [] },
  };
}

describe('offline IndexedDB restart lifecycle', () => {
  beforeEach(() => {
    createRemoteOrderMock.mockReset();
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: 'offline-restart-user' } } },
      error: null,
    });
    vi.stubGlobal('navigator', { onLine: false });
  });

  it('retains queued orders across a module restart and synchronizes them exactly once', async () => {
    const entry = makeEntry('restart-order-once');
    await offlineOrderQueue.enqueue(entry);
    expect(await offlineOrderQueue.pendingOrders(entry.order.storeId)).toHaveLength(1);

    vi.resetModules();
    const { offlineOrderQueue: reopenedQueue } = await import('../src/services/offlineOrderQueue');
    expect(await reopenedQueue.pendingOrders(entry.order.storeId)).toMatchObject([
      { idempotencyKey: entry.idempotencyKey, syncStatus: 'queued' },
    ]);

    vi.stubGlobal('navigator', { onLine: true });
    createRemoteOrderMock.mockResolvedValue({ ...entry.order, number: 42 });
    await reopenedQueue.flush();
    await reopenedQueue.flush();

    expect(createRemoteOrderMock).toHaveBeenCalledTimes(1);
    expect(createRemoteOrderMock).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: entry.idempotencyKey,
    }));
    expect(await reopenedQueue.pendingOrders(entry.order.storeId)).toHaveLength(0);
  });

  it('keeps the previous complete snapshot when a refresh is incomplete', async () => {
    const base = {
      storeId: 'offline-restart-store',
      userId: 'offline-restart-user',
      items: [],
      categories: [],
      customers: [],
      creditStatuses: {},
      orders: [],
      permissions: {
        can86Items: false,
        canCompItems: false,
        canUseTabs: false,
        canOverrideCreditLimit: false,
      },
    };
    const previous = { ...base, cachedAt: '2026-01-01T00:00:00.000Z' };
    const incomplete = { ...base, cachedAt: '2026-02-01T00:00:00.000Z' };
    await offlineOrderQueue.cacheSnapshot(previous);
    await offlineOrderQueue.cacheSnapshot(incomplete, false);

    await expect(offlineOrderQueue.getSnapshot(base.storeId, base.userId)).resolves.toEqual(previous);
  });
});
