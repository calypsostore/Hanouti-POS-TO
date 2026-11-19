import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderRecord, ShiftRecord } from '../src/types/domain';

const { createOrderMock, getSessionMock } = vi.hoisted(() => ({
  createOrderMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('../src/data/driver', () => ({ isSupabaseDriver: () => true }));
vi.mock('../src/data/repositories/orderRepository', () => ({ createOrder: createOrderMock }));
vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: () => ({ auth: { getSession: getSessionMock } }),
}));

import { offlineOrderQueue } from '../src/services/offlineOrderQueue';

describe('offline order queue idempotency', () => {
  beforeEach(() => {
    createOrderMock.mockReset();
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: 'staff-queue-test' } } },
      error: null,
    });
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('submits one queued order once when the same idempotency key is enqueued and flushed repeatedly', async () => {
    const shift: ShiftRecord = {
      id: 'shift-queue-test',
      storeId: 'store-queue-test',
      staffId: 'staff-queue-test',
      status: 'open',
      startingCashMillimes: 0,
      openedAt: new Date().toISOString(),
    };
    const order: OrderRecord = {
      id: 'queue-order-key',
      idempotencyKey: 'queue-order-key',
      number: -1,
      storeId: shift.storeId,
      staffId: shift.staffId,
      shiftId: shift.id,
      status: 'done',
      paymentMethod: 'cash',
      items: [],
      totalMillimes: 1_000,
      createdAt: new Date().toISOString(),
    };
    const input = { storeId: shift.storeId, staffId: shift.staffId, items: [] };
    const entry = { idempotencyKey: 'queue-order-key', order, shift, input };
    let resolveOrder!: (value: OrderRecord) => void;
    createOrderMock.mockImplementation(() => new Promise<OrderRecord>((resolve) => {
      resolveOrder = resolve;
    }));

    await offlineOrderQueue.enqueue(entry);
    await offlineOrderQueue.enqueue({ ...entry, order: { ...order, totalMillimes: 2_000 } });
    expect(await offlineOrderQueue.pendingOrders(shift.storeId)).toHaveLength(1);

    const flushing = offlineOrderQueue.flush();
    await vi.waitFor(() => expect(createOrderMock).toHaveBeenCalledTimes(1));
    await offlineOrderQueue.flush();
    expect(createOrderMock).toHaveBeenCalledTimes(1);
    resolveOrder(order);
    await flushing;
    await offlineOrderQueue.flush();

    expect(createOrderMock).toHaveBeenCalledTimes(1);
    expect(await offlineOrderQueue.pendingOrders(shift.storeId)).toHaveLength(0);
  });
});
