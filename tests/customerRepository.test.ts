import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from '../src/data/supabaseClient';
import { listTransactionsForCustomers } from '../src/data/repositories/customerRepository';

vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: vi.fn(),
}));

describe('customerRepository batched reads', () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
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

  it('loads transactions for multiple customers in one paged query', async () => {
    await expect(listTransactionsForCustomers(['customer-1', 'customer-2'])).resolves.toEqual([]);

    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledWith('tabs');
    expect(query.in).toHaveBeenCalledWith('customer_id', ['customer-1', 'customer-2']);
    expect(query.range).toHaveBeenCalledWith(0, 999);
  });
});
