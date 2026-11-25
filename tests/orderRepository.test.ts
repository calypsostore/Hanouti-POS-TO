import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from '../src/data/supabaseClient';
import { createOrder, listOrderSummaries, listOrders } from '../src/data/repositories/orderRepository';
import { calculateFiscalOrder } from '../src/services/fiscal/taxEngine';
import type { ShiftRecord } from '../src/types/domain';

vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: vi.fn(),
}));

describe('orderRepository list queries', () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    returns: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (result: { data: never[]; error: null }) => unknown) =>
      Promise.resolve({ data: [] as never[], error: null }).then(resolve)),
  };
  const client = { from: vi.fn(() => query), rpc: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    client.rpc.mockResolvedValue({
      data: {
        order: {
          id: 'order-fiscal-rpc',
          number: 1,
          store_id: 'store-a',
          business_date: '2026-06-01',
          staff_id: 'staff-a',
          shift_id: 'shift-a',
          location: null,
          status: 'done',
          payment_method: 'cash',
          customer_id: null,
          note: null,
          total_millimes: 1_100,
          created_at: '2026-06-01T12:00:00.000Z',
          void_requested_at: null,
          voided_at: null,
          voided_by: null,
          voided_by_user_id: null,
          void_reason: null,
          fiscal_snapshot: calculateFiscalOrder('store-a', '2026-06-01', [{
            lineId: 'line-1',
            itemId: 'item-a',
            quantity: 1,
            unitAmountMillimes: 1_000,
            priceMode: 'exclusive',
            requiredTaxTypes: ['vat'],
            treatments: [{ taxType: 'vat', treatment: 'taxable' }],
            rules: [{
              id: 'vat-v1',
              storeId: 'store-a',
              version: 1,
              name: 'Synthetic RPC fixture',
              taxType: 'vat',
              calculationMethod: 'percentage',
              ratePpm: 100_000,
              priority: 1,
              effectiveFrom: '2026-01-01',
              status: 'active',
              legalReviewed: true,
              createdAt: '2026-01-01T00:00:00.000Z',
            }],
          }]),
        },
        items: [],
        store_name: 'Store A',
        staff_name: 'Staff A',
      },
      error: null,
    });
    vi.mocked(getSupabaseClient).mockReturnValue(client as unknown as ReturnType<typeof getSupabaseClient>);
  });

  it('limits full-order reads to 200 rows by default', async () => {
    await listOrders('store-id');

    expect(query.range).toHaveBeenCalledWith(0, 199);
    expect(query.select).toHaveBeenCalledWith('*, items:order_lines(*)');
  });

  it('paginates summary reads without loading order lines', async () => {
    await listOrderSummaries('store-id', {
      status: 'pending_void',
      limit: 30,
      range: { from: 60, to: 119 },
    });

    expect(query.range).toHaveBeenCalledWith(60, 89);
    expect(query.eq).toHaveBeenCalledWith('status', 'pending_void');
    expect(query.select.mock.calls[0][0]).not.toContain('order_lines');
  });

  it('filters customer order reads at the database', async () => {
    await listOrders('store-id', { customerId: 'customer-id' });

    expect(query.eq).toHaveBeenCalledWith('customer_id', 'customer-id');
  });

  it('filters batched customer order reads at the database', async () => {
    await listOrderSummaries('store-id', { customerIds: ['customer-1', 'customer-2'] });

    expect(query.in).toHaveBeenCalledWith('customer_id', ['customer-1', 'customer-2']);
    expect(query.select.mock.calls[0][0]).not.toContain('order_lines');
  });

  it('rejects invalid page sizes and ranges before querying', async () => {
    await expect(listOrders('store-id', { limit: 0 })).rejects.toThrow('positive whole number');
    await expect(listOrderSummaries('store-id', { range: { from: -1, to: 1 } })).rejects.toThrow('range is invalid');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('pins an offline fiscal snapshot in the idempotent order RPC payload', async () => {
    const shift: ShiftRecord = {
      id: 'shift-a',
      storeId: 'store-a',
      staffId: 'staff-a',
      status: 'open',
      startingCashMillimes: 0,
      openedAt: '2026-06-01T08:00:00.000Z',
    };
    const fiscalSnapshot = calculateFiscalOrder('store-a', '2026-06-01', [{
      lineId: 'line-1',
      itemId: 'item-a',
      quantity: 1,
      unitAmountMillimes: 1_000,
      priceMode: 'exclusive',
      requiredTaxTypes: ['vat'],
      treatments: [{ taxType: 'vat', treatment: 'taxable' }],
      rules: [{
        id: 'vat-v1',
        storeId: 'store-a',
        version: 1,
        name: 'Synthetic RPC fixture',
        taxType: 'vat',
        calculationMethod: 'percentage',
        ratePpm: 100_000,
        priority: 1,
        effectiveFrom: '2026-01-01',
        status: 'active',
        legalReviewed: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      }],
    }]);

    await createOrder({
      shift,
      items: [{
        itemId: 'item-a',
        name: 'Fixture item',
        quantity: 1,
        unitPriceMillimes: 1_000,
        lineTotalMillimes: 1_000,
        modifiers: [],
      }],
      idempotencyKey: 'key-a',
      fiscalSnapshot,
    });

    expect(client.rpc).toHaveBeenCalledWith('create_order_idempotent', expect.objectContaining({
      p_items: [expect.objectContaining({ fiscalSnapshot })],
    }));
  });
});
