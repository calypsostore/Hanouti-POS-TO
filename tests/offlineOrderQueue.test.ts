import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderRecord, ShiftRecord } from '../src/types/domain';
import { calculateFiscalOrder } from '../src/services/fiscal/taxEngine';
import type { FiscalTaxRuleRecord } from '../src/types/fiscal';

const { closeShiftMock, createOrderMock, getSessionMock } = vi.hoisted(() => ({
  closeShiftMock: vi.fn(),
  createOrderMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('../src/data/driver', () => ({ isSupabaseDriver: () => true }));
vi.mock('../src/data/repositories/orderRepository', () => ({ createOrder: createOrderMock }));
vi.mock('../src/data/repositories/shiftRepository', () => ({
  closeShift: closeShiftMock,
  forceCloseDay: vi.fn(),
  forceCloseShift: vi.fn(),
  getExpectedCash: vi.fn(),
  getOpenShiftForUser: vi.fn(),
  getShift: vi.fn(),
  listCashMovements: vi.fn(),
  listShifts: vi.fn(),
  openShift: vi.fn(),
  recordCashMovement: vi.fn(),
}));
vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: () => ({ auth: { getSession: getSessionMock } }),
}));

import { offlineOrderQueue } from '../src/services/offlineOrderQueue';
import { shiftService } from '../src/services/shiftService';

function makeQueueEntry(id: string, shiftId: string): {
  idempotencyKey: string;
  order: OrderRecord;
  shift: ShiftRecord;
  input: { storeId: string; staffId: string; items: []; fiscalSnapshot?: import('../src/types/fiscal').FiscalOrderSnapshot | null };
} {
  const shift: ShiftRecord = {
    id: shiftId,
    storeId: 'store-queue-test',
    staffId: 'staff-queue-test',
    status: 'open',
    startingCashMillimes: 0,
    openedAt: new Date().toISOString(),
  };
  const order: OrderRecord = {
    id,
    idempotencyKey: id,
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
  return {
    idempotencyKey: id,
    order,
    shift,
    input: { storeId: shift.storeId, staffId: shift.staffId, items: [] },
  };
}

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

  it('passes the queued fiscal snapshot unchanged when syncing the idempotent order', async () => {
    const shift: ShiftRecord = {
      id: 'shift-fiscal-queue',
      storeId: 'store-fiscal-queue',
      staffId: 'staff-queue-test',
      status: 'open',
      startingCashMillimes: 0,
      openedAt: new Date().toISOString(),
    };
    const rule: FiscalTaxRuleRecord = {
      id: 'vat-queue-v1',
      storeId: shift.storeId,
      version: 1,
      name: 'Synthetic offline queue test',
      taxType: 'vat',
      calculationMethod: 'percentage',
      ratePpm: 100_000,
      priority: 1,
      effectiveFrom: '2026-01-01',
      status: 'active',
      legalReviewed: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const fiscalSnapshot = calculateFiscalOrder(shift.storeId, '2026-06-01', [{
      lineId: 'line-1',
      itemId: 'item-queue',
      quantity: 1,
      unitAmountMillimes: 1_000,
      priceMode: 'exclusive',
      requiredTaxTypes: ['vat'],
      treatments: [{ taxType: 'vat', treatment: 'taxable' }],
      rules: [rule],
    }]);
    const order: OrderRecord = {
      id: 'offline-fiscal-order',
      idempotencyKey: 'offline-fiscal-order',
      number: -1,
      storeId: shift.storeId,
      staffId: shift.staffId,
      shiftId: shift.id,
      status: 'done',
      paymentMethod: 'cash',
      items: [],
      totalMillimes: fiscalSnapshot.totalAmountMillimes,
      fiscalSnapshot,
      createdAt: new Date().toISOString(),
    };
    const input = {
      storeId: shift.storeId,
      staffId: shift.staffId,
      items: [],
      fiscalSnapshot,
    };
    createOrderMock.mockResolvedValue(order);

    await offlineOrderQueue.enqueue({
      idempotencyKey: 'offline-fiscal-order',
      order,
      shift,
      input,
    });
    await offlineOrderQueue.flush();

    expect(createOrderMock).toHaveBeenCalledWith(expect.objectContaining({ fiscalSnapshot }));
  });

  it('pins an explicit missing snapshot for offline orders made before fiscal rules are configured', async () => {
    const entry = makeQueueEntry('offline-without-fiscal', 'shift-offline-without-fiscal');
    entry.input.fiscalSnapshot = null;
    createOrderMock.mockResolvedValue(entry.order);

    await offlineOrderQueue.enqueue(entry);
    await offlineOrderQueue.flush();

    expect(createOrderMock).toHaveBeenCalledWith(expect.objectContaining({ fiscalSnapshot: null }));
  });
});

describe('shift closing with queued orders', () => {
  beforeEach(() => {
    createOrderMock.mockReset();
    closeShiftMock.mockReset();
    closeShiftMock.mockImplementation(async (shiftId: string) => ({
      ...makeQueueEntry('closed-shift-result', shiftId).shift,
      status: 'closed',
    }));
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: 'staff-queue-test' } } },
      error: null,
    });
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('blocks closing when a queued order for that shift remains unsynced', async () => {
    const entry = makeQueueEntry('queued-close-block', 'shift-queued-close-block');
    await offlineOrderQueue.enqueue(entry);
    createOrderMock.mockRejectedValue(new Error('Network request failed'));

    await expect(shiftService.closeShift(entry.shift.id, 0)).rejects.toThrow(
      '1 order has not synced yet.',
    );
    expect(closeShiftMock).not.toHaveBeenCalled();
  });

  it('blocks closing when a needs-attention order belongs to that shift', async () => {
    const entry = makeQueueEntry('attention-close-block', 'shift-attention-close-block');
    await offlineOrderQueue.enqueue(entry);
    createOrderMock.mockRejectedValue(new Error('The saved shift is closed.'));
    await offlineOrderQueue.flush();

    await expect(shiftService.closeShift(entry.shift.id, 0)).rejects.toThrow(
      '1 order has not synced yet.',
    );
    expect(closeShiftMock).not.toHaveBeenCalled();
  });

  it('closes after the queued order is successfully flushed', async () => {
    const entry = makeQueueEntry('queued-close-flush', 'shift-queued-close-flush');
    await offlineOrderQueue.enqueue(entry);
    createOrderMock.mockResolvedValue(entry.order);

    await shiftService.closeShift(entry.shift.id, 0);

    expect(createOrderMock).toHaveBeenCalledOnce();
    expect(await offlineOrderQueue.pendingCount(entry.order.storeId)).toBe(0);
    expect(closeShiftMock).toHaveBeenCalledOnce();
  });

  it('does not let an unresolved order for another shift block closing', async () => {
    const entry = makeQueueEntry('attention-other-shift', 'shift-attention-other');
    await offlineOrderQueue.enqueue(entry);
    createOrderMock.mockRejectedValue(new Error('The saved shift is closed.'));
    await offlineOrderQueue.flush();
    closeShiftMock.mockClear();

    await shiftService.closeShift('shift-to-close', 0);

    expect(closeShiftMock).toHaveBeenCalledOnce();
  });
});
