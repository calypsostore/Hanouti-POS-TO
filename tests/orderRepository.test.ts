import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from '../src/data/supabaseClient';
import { listOrderSummaries, listOrders } from '../src/data/repositories/orderRepository';

vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: vi.fn(),
}));

describe('orderRepository list queries', () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (result: { data: never[]; error: null }) => unknown) =>
      Promise.resolve({ data: [] as never[], error: null }).then(resolve)),
  };
  const client = { from: vi.fn(() => query) };

  beforeEach(() => {
    vi.clearAllMocks();
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

  it('rejects invalid page sizes and ranges before querying', async () => {
    await expect(listOrders('store-id', { limit: 0 })).rejects.toThrow('positive whole number');
    await expect(listOrderSummaries('store-id', { range: { from: -1, to: 1 } })).rejects.toThrow('range is invalid');
    expect(client.from).not.toHaveBeenCalled();
  });
});
