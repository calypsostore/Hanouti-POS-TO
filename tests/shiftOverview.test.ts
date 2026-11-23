import { describe, expect, it } from 'vitest';
import { getDailyOverviewTrends, type ShiftOverviewValues } from '../src/lib/shiftOverview';

const currentValues: ShiftOverviewValues = {
  sales: 30000,
  transactions: 3,
  cash: 20000,
  cards: 10000,
  expenses: 1000,
  netSales: 29000,
};

describe('shift overview trends', () => {
  it('builds daily sales, payment, transaction, and expense series from real records', () => {
    const trends = getDailyOverviewTrends(
      [
        { status: 'done', businessDate: '2026-11-22', createdAt: '2026-11-22T09:00:00', totalMillimes: 20000, paymentMethod: 'cash' },
        { status: 'done', businessDate: '2026-11-22', createdAt: '2026-11-22T10:00:00', totalMillimes: 10000, paymentMethod: 'card' },
        { status: 'voided', businessDate: '2026-11-23', createdAt: '2026-11-23T09:00:00', totalMillimes: 50000, paymentMethod: 'cash' },
      ],
      [{ date: '2026-11-22', amountMillimes: 5000 }],
      currentValues,
      new Date(2026, 10, 23, 12),
    );

    expect(trends.sales.values).toEqual([0, 0, 0, 0, 30000, 30000]);
    expect(trends.sales.changePercent).toBe(0);
    expect(trends.transactions.values.at(-1)).toBe(3);
    expect(trends.cash.values.at(-2)).toBe(20000);
    expect(trends.cards.values.at(-2)).toBe(10000);
    expect(trends.expenses.values.at(-2)).toBe(5000);
    expect(trends.netSales.values.at(-2)).toBe(25000);
  });

  it('leaves percentage unavailable when the previous day has no baseline', () => {
    const trends = getDailyOverviewTrends([], [], currentValues, new Date(2026, 10, 23, 12));

    expect(trends.sales.values).toEqual([0, 0, 0, 0, 0, 30000]);
    expect(trends.sales.changePercent).toBeUndefined();
  });

  it('does not draw a fabricated trend when there is no activity', () => {
    const noActivity: ShiftOverviewValues = {
      sales: 0,
      transactions: 0,
      cash: 0,
      cards: 0,
      expenses: 0,
      netSales: 0,
    };
    const trends = getDailyOverviewTrends([], [], noActivity, new Date(2026, 10, 23, 12));

    expect(trends.sales.values).toEqual([]);
    expect(trends.transactions.values).toEqual([]);
  });
});
