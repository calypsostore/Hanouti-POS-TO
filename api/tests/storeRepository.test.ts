import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockGetSupabaseClient } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetSupabaseClient: vi.fn(),
}));

vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: mockGetSupabaseClient,
}));

import { getStore } from '../src/data/repositories/storeRepository';

const storeRow = {
  id: 'store-1',
  store_id: 'store-1',
  owner_id: 'owner-1',
  code: 'CAFE',
  name: 'Cafe',
  timezone: 'Africa/Tunis',
  address: null,
  phone: null,
  tax_id: null,
  is_active: true,
  archived_at: null,
  day_closed_on: null,
  allow_customer_credit_balance: false,
  allow_card_payments: false,
  allow_other_payments: false,
  staff_auto_lock_minutes: 5,
  cash_out_alert_threshold_millimes: 50_000,
  daily_sales_target_millimes: 0,
  pin_must_change: false,
  subscription_plan: 'trial',
  subscription_paid_until: null,
  subscription_notes: '',
  created_at: '2026-01-01T00:00:00.000Z',
};

function queryResult(result: { data: unknown; error: null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const select = vi.fn().mockReturnValue({ eq });
  return { select };
}

describe('store repository', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockGetSupabaseClient.mockReturnValue({ from: mockFrom });
  });

  it('loads the shared manual Quick Picks for staff and owners', async () => {
    mockFrom
      .mockReturnValueOnce(queryResult({ data: storeRow, error: null }))
      .mockReturnValueOnce(queryResult({
        data: { settings: { quickPickMode: 'manual', quickPickItemIds: ['item-1'] } },
        error: null,
      }));

    await expect(getStore('store-1')).resolves.toMatchObject({
      id: 'store-1',
      settings: {
        quickPickMode: 'manual',
        quickPickItemIds: ['item-1'],
      },
    });
    expect(mockFrom.mock.calls.map(([table]) => table)).toEqual(['stores', 'store_settings']);
  });

  it('does not silently replace an unreadable shared settings row with defaults', async () => {
    mockFrom
      .mockReturnValueOnce(queryResult({ data: storeRow, error: null }))
      .mockReturnValueOnce(queryResult({ data: null, error: null }));

    await expect(getStore('store-1')).rejects.toThrow('no shared settings row is visible');
  });
});
