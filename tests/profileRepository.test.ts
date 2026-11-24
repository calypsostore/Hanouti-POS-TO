import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from '../src/data/supabaseClient';
import { listProfileNamesForStore } from '../src/data/repositories/profileRepository';

vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: vi.fn(),
}));

describe('profileRepository staff name reads', () => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: vi.fn((resolve: (result: { data: Array<{ id: string; name: string }>; error: null }) => unknown) =>
      Promise.resolve({ data: [{ id: 'staff-1', name: 'Staff One' }], error: null }).then(resolve)),
  };
  const client = { from: vi.fn(() => query) };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseClient).mockReturnValue(client as unknown as ReturnType<typeof getSupabaseClient>);
  });

  it('fetches only profile names for the store in one query', async () => {
    await expect(listProfileNamesForStore('store-1')).resolves.toEqual([
      { id: 'staff-1', name: 'Staff One' },
    ]);

    expect(client.from).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledWith('profiles');
    expect(query.select).toHaveBeenCalledWith('id, name');
    expect(query.eq).toHaveBeenNthCalledWith(1, 'store_id', 'store-1');
  });
});
