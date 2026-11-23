import { describe, expect, it } from 'vitest';
import {
  getShiftOverviewChange,
  getShiftOverviewDateRange,
  getShiftOverviewAnalyticsFromRecords,
  getShiftOverviewSeries,
  type ShiftOverviewAnalytics,
} from '../src/lib/shiftOverview';

const analytics: ShiftOverviewAnalytics = {
  current: { sales: 2_680_500, transactions: 12, cash: 1_500_000, cards: 800_000, other: 80_000, expenses: 200_000, netSales: 2_180_000 },
  previous: { sales: 2_400_000, transactions: 10, cash: 1_300_000, cards: 800_000, other: 50_000, expenses: 100_000, netSales: 2_050_000 },
  comparisonAvailable: true,
  series: [
    { label: '2026-11-22', sales: 2_400_000, transactions: 10, cash: 1_300_000, cards: 800_000, other: 50_000, expenses: 100_000, netSales: 2_050_000 },
    { label: '2026-11-23', sales: 2_680_500, transactions: 12, cash: 1_500_000, cards: 800_000, other: 80_000, expenses: 200_000, netSales: 2_180_000 },
  ],
};

describe('shift overview analytics helpers', () => {
  it('builds equivalent previous periods for each filter', () => {
    expect(getShiftOverviewDateRange('today', '2026-11-23')).toEqual({
      from: '2026-11-23', to: '2026-11-23', previousFrom: '2026-11-22', previousTo: '2026-11-22',
    });
    expect(getShiftOverviewDateRange('last7', '2026-11-23')).toEqual({
      from: '2026-11-17', to: '2026-11-23', previousFrom: '2026-11-10', previousTo: '2026-11-16',
    });
    expect(getShiftOverviewDateRange('month', '2026-11-23')).toEqual({
      from: '2026-11-01', to: '2026-11-23', previousFrom: '2026-10-09', previousTo: '2026-10-31',
    });
    expect(getShiftOverviewDateRange('custom', '2026-11-23', '2026-02-27', '2026-03-02')).toEqual({
      from: '2026-02-27', to: '2026-03-02', previousFrom: '2026-02-23', previousTo: '2026-02-26',
    });
    expect(getShiftOverviewDateRange('custom', '2026-11-23', '2026-11-24', '2026-11-23')).toBeUndefined();
  });

  it('calculates finite period changes and labels zero-baseline comparisons honestly', () => {
    expect(getShiftOverviewChange(2_680_500, 2_400_000)).toEqual({
      direction: 'up',
      percent: 11.6875,
    });
    expect(getShiftOverviewChange(0, 0)).toEqual({ direction: 'neutral', percent: 0 });
    expect(getShiftOverviewChange(10, 0)).toEqual({ direction: 'new' });
    expect(getShiftOverviewChange(10, 0, false)).toEqual({ direction: 'unavailable' });
  });

  it('returns only recorded series values and does not fabricate empty trends', () => {
    expect(getShiftOverviewSeries(analytics, 'sales')).toEqual([2_400_000, 2_680_500]);
    expect(getShiftOverviewSeries({
      ...analytics,
      series: analytics.series.map((point) => ({ ...point, sales: 0 })),
    }, 'sales')).toEqual([]);
  });

  it('aggregates completed sales, collected methods, valid reversals, expenses, and hourly data', () => {
    const range = {
      from: '2026-11-23',
      to: '2026-11-23',
      previousFrom: '2026-11-22',
      previousTo: '2026-11-22',
    };
    const result = getShiftOverviewAnalyticsFromRecords(
      range,
      [
        { status: 'done', createdAt: '2026-11-23T09:00:00Z', totalMillimes: 10_000, paymentMethod: 'cash' },
        { status: 'done', createdAt: '2026-11-23T10:00:00Z', totalMillimes: 20_000, paymentMethod: 'card' },
        { status: 'done', createdAt: '2026-11-23T11:00:00Z', totalMillimes: 50_000, paymentMethod: 'tab' },
        { status: 'done', createdAt: '2026-11-23T12:00:00Z', totalMillimes: 3_000, paymentMethod: 'other' },
        { status: 'voided', createdAt: '2026-11-23T13:00:00Z', totalMillimes: 99_999, paymentMethod: 'cash' },
        { status: 'pending_void', createdAt: '2026-11-23T14:00:00Z', totalMillimes: 88_888, paymentMethod: 'cash' },
        { status: 'done', createdAt: '2026-11-22T12:00:00Z', totalMillimes: 10_000, paymentMethod: 'card' },
      ],
      [
        { date: '2026-11-23', amountMillimes: 2_500 },
        { date: '2026-11-22', amountMillimes: 1_000 },
      ],
      [
        { id: 'cash-in', shiftId: 'shift-1', kind: 'settled', paymentMethod: 'cash', amountMillimes: 5_000, createdAt: '2026-11-23T15:00:00Z' },
        { id: 'cash-reversal', shiftId: 'shift-1', kind: 'reversal', paymentMethod: 'cash', amountMillimes: 2_000, createdAt: '2026-11-23T16:00:00Z', reversalAttribution: 'same_shift' },
        { id: 'card-in', shiftId: 'shift-1', kind: 'settled', paymentMethod: 'card', amountMillimes: 4_000, createdAt: '2026-11-23T17:00:00Z' },
        { id: 'card-reversal', shiftId: 'shift-1', kind: 'reversal', paymentMethod: 'card', amountMillimes: 3_000, createdAt: '2026-11-23T18:00:00Z' },
        { id: 'other-in', shiftId: 'shift-1', kind: 'settled', paymentMethod: 'other', amountMillimes: 1_000, createdAt: '2026-11-23T19:00:00Z' },
        { id: 'tab-issue', shiftId: 'shift-1', kind: 'issued', paymentMethod: 'cash', amountMillimes: 1_000, createdAt: '2026-11-23T20:00:00Z' },
      ],
      [],
      'UTC',
      '2026-01-01T00:00:00Z',
    );

    expect(result.current).toEqual({
      sales: 83_000,
      transactions: 4,
      cash: 13_000,
      cards: 24_000,
      other: 4_000,
      expenses: 2_500,
      netSales: 38_500,
    });
    expect(result.previous).toMatchObject({ sales: 10_000, transactions: 1, cards: 10_000, expenses: 1_000, netSales: 9_000 });
    expect(result.comparisonAvailable).toBe(true);
    expect(result.series).toHaveLength(24);
    expect(result.series.find((point) => point.label === '09:00')).toMatchObject({ sales: 10_000, transactions: 1, cash: 10_000 });
  });
});
