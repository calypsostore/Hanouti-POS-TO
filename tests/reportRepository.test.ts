import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFrom, mockGetSupabaseClient } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockGetSupabaseClient: vi.fn(),
}));

vi.mock('../src/data/supabaseClient', () => ({
  getSupabaseClient: mockGetSupabaseClient,
}));

import { listReports } from '../src/data/repositories/reportRepository';

function reportsQuery(result: { data: unknown[]; error: null }) {
  const order = vi.fn().mockResolvedValue(result);
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  return { select };
}

function reportRow(data: Record<string, unknown>, periodTo: string | null) {
  return {
    id: 'report-1',
    store_id: 'store-1',
    type: 'Z',
    business_date: '2026-11-21',
    created_at: '2026-11-21T15:37:01.000Z',
    sales_millimes: 0,
    sales_collected_millimes: 0,
    expenses_millimes: 0,
    net_profit_millimes: 0,
    receivable_millimes: 0,
    order_count: 0,
    cash_difference_millimes: 0,
    z_number: 1,
    period_from: '2026-11-21',
    period_to: periodTo,
    generated_by: null,
    data,
  };
}

describe('report repository period boundaries', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockGetSupabaseClient.mockReturnValue({ from: mockFrom });
  });

  it('preserves the full-precision boundary from the report snapshot', async () => {
    const periodTo = '2026-11-21T15:36:55.33307+00:00';
    mockFrom.mockReturnValue(reportsQuery({
      data: [reportRow({ periodFrom: '2026-11-21T15:00:00.123456+00:00', periodTo }, '2026-11-21')],
      error: null,
    }));

    const [report] = await listReports('store-1');

    expect(report.periodFrom).toBe('2026-11-21T15:00:00.123456+00:00');
    expect(report.periodTo).toBe(periodTo);
  });

  it('keeps historical date-only snapshot values instead of promoting database midnight to an exact boundary', async () => {
    mockFrom.mockReturnValue(reportsQuery({
      data: [reportRow({ periodFrom: '2026-11-21', periodTo: '2026-11-21' }, '2026-11-21T00:00:00.000Z')],
      error: null,
    }));

    const [report] = await listReports('store-1');

    expect(report.periodFrom).toBe('2026-11-21');
    expect(report.periodTo).toBe('2026-11-21');
  });

  it('leaves absent snapshot boundaries absent so lifecycle code can fall back to created_at', async () => {
    mockFrom.mockReturnValue(reportsQuery({
      data: [reportRow({}, '2026-11-21T00:00:00.000Z')],
      error: null,
    }));

    const [report] = await listReports('store-1');

    expect(report.periodFrom).toBeUndefined();
    expect(report.periodTo).toBeUndefined();
    expect(report.createdAt).toBe('2026-11-21T15:37:01.000Z');
  });
});
