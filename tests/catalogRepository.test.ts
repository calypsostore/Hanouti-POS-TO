import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from '../src/data/supabaseClient';
import { listItems } from '../src/data/repositories/catalogRepository';

vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: vi.fn(),
}));

describe('catalogRepository list queries', () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (result: { data: never[]; error: null }) => unknown) =>
      Promise.resolve({ data: [] as never[], error: null }).then(resolve)),
  };
  const client = { from: vi.fn(() => query) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseClient).mockReturnValue(client as unknown as ReturnType<typeof getSupabaseClient>);
  });

  it('selects only the catalog columns needed by the product view', async () => {
    await listItems('store-id');

    expect(client.from).toHaveBeenCalledWith('catalog_items');
    expect(query.select).toHaveBeenCalledWith(expect.not.stringContaining('*'));
    expect(query.select.mock.calls[0][0]).toContain('price_millimes');
    expect(query.select.mock.calls[0][0]).toContain('out_of_stock');
  });
});
