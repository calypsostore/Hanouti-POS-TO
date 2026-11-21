import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from '../src/data/supabaseClient';
import { listShifts } from '../src/data/repositories/shiftRepository';

vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: vi.fn(),
}));

describe('shiftRepository listShifts', () => {
  const shiftRows = [
    {
      id: 'shift-1',
      store_id: 'store-1',
      staff_id: 'staff-1',
      status: 'closed',
      starting_cash_millimes: 1000,
      counted_cash_millimes: 1000,
      expected_cash_millimes: 1000,
      difference_millimes: 0,
      opened_at: '2026-01-01T08:00:00.000Z',
      closed_at: '2026-01-01T16:00:00.000Z',
      force_closed_by_owner: false,
      voids_auto_approved_count: 0,
      closed_by_user_id: null,
      difference_note: null,
    },
    {
      id: 'shift-2',
      store_id: 'store-1',
      staff_id: 'staff-2',
      status: 'open',
      starting_cash_millimes: 2000,
      counted_cash_millimes: null,
      expected_cash_millimes: null,
      difference_millimes: null,
      opened_at: '2026-01-01T16:00:00.000Z',
      closed_at: null,
      force_closed_by_owner: false,
      voids_auto_approved_count: 0,
      closed_by_user_id: null,
      difference_note: null,
    },
  ];
  const shiftQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (result: { data: typeof shiftRows; error: null }) => unknown) =>
      Promise.resolve({ data: shiftRows, error: null }).then(resolve)),
  };
  const adjustmentRows = [{
    shift_id: 'shift-1',
    order_id: 'order-1',
    order_number: 1,
    amount_millimes: -500,
    kind: 'approved',
    created_at: '2026-01-01T16:30:00.000Z',
  }];
  const adjustmentQuery = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (result: { data: typeof adjustmentRows; error: null }) => unknown) =>
      Promise.resolve({ data: adjustmentRows, error: null }).then(resolve)),
  };
  const client = {
    from: vi.fn((table: string) => table === 'shifts' ? shiftQuery : adjustmentQuery),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseClient).mockReturnValue(client as unknown as ReturnType<typeof getSupabaseClient>);
  });

  it('loads all listed shift adjustments in one batched query', async () => {
    const shifts = await listShifts('store-1');

    expect(client.from).toHaveBeenCalledTimes(2);
    expect(adjustmentQuery.in).toHaveBeenCalledOnce();
    expect(adjustmentQuery.in).toHaveBeenCalledWith('shift_id', ['shift-1', 'shift-2']);
    expect(shifts[0].voidAdjustments).toEqual([{
      orderId: 'order-1',
      orderNumber: 1,
      amountMillimes: -500,
      kind: 'approved',
      createdAt: '2026-01-01T16:30:00.000Z',
    }]);
  });
});
