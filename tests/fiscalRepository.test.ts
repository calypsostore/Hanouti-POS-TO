import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSupabaseClient } from '../src/data/supabaseClient';
import { getCheckoutFiscalProfile } from '../src/data/repositories/fiscalRepository';

vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: vi.fn(),
}));

describe('fiscalRepository checkout profile', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getSupabaseClient>);
  });

  it('loads the limited store-scoped profile through the checkout RPC', async () => {
    rpc.mockResolvedValue({
      data: {
        storeId: 'store-1',
        reviewStatus: 'confirmed',
        requiredTaxTypes: ['vat'],
        pricingMode: 'exclusive',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      error: null,
    });

    await expect(getCheckoutFiscalProfile('store-1')).resolves.toEqual({
      storeId: 'store-1',
      reviewStatus: 'confirmed',
      requiredTaxTypes: ['vat'],
      pricingMode: 'exclusive',
      updatedAt: '2026-06-01T00:00:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('get_checkout_fiscal_profile', { p_store_id: 'store-1' });
  });

  it('rejects malformed or cross-store RPC responses', async () => {
    rpc.mockResolvedValue({
      data: {
        storeId: 'other-store',
        reviewStatus: 'confirmed',
        requiredTaxTypes: ['vat'],
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
      error: null,
    });

    await expect(getCheckoutFiscalProfile('store-1')).rejects.toThrow('Checkout fiscal settings response is invalid.');
  });
});
