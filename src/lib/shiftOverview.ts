import type { ExpenseRecord, OrderRecord } from '../types/domain';

export type ShiftOverviewMetricKey = 'sales' | 'transactions' | 'cash' | 'cards' | 'expenses' | 'netSales';
export type ShiftOverviewValues = Record<ShiftOverviewMetricKey, number>;
export type ShiftOverviewTrend = { changePercent?: number; values: number[] };

type OverviewOrder = Pick<OrderRecord, 'status' | 'businessDate' | 'createdAt' | 'totalMillimes' | 'paymentMethod'>;
type OverviewExpense = Pick<ExpenseRecord, 'date' | 'amountMillimes'>;

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function emptyValues(): ShiftOverviewValues {
  return { sales: 0, transactions: 0, cash: 0, cards: 0, expenses: 0, netSales: 0 };
}

export function getDailyOverviewTrends(
  orders: OverviewOrder[],
  expenses: OverviewExpense[],
  currentValues: ShiftOverviewValues,
  today = new Date(),
): Record<ShiftOverviewMetricKey, ShiftOverviewTrend> {
  const days = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 5 + index);
    return localDateKey(date);
  });
  const valuesByDay = new Map(days.map((day) => [day, emptyValues()]));

  for (const order of orders) {
    if (order.status !== 'done') continue;
    const createdAt = new Date(order.createdAt);
    const day = order.businessDate ?? (Number.isNaN(createdAt.getTime()) ? '' : localDateKey(createdAt));
    const values = valuesByDay.get(day);
    if (!values) continue;

    values.sales += order.totalMillimes;
    values.transactions += 1;
    if (order.paymentMethod === 'cash') values.cash += order.totalMillimes;
    if (order.paymentMethod === 'card') values.cards += order.totalMillimes;
  }

  for (const expense of expenses) {
    const values = valuesByDay.get(expense.date);
    if (values) values.expenses += expense.amountMillimes;
  }

  for (const values of valuesByDay.values()) {
    values.netSales = values.sales - values.expenses;
  }

  Object.assign(valuesByDay.get(days[days.length - 1])!, currentValues);

  const getTrend = (key: ShiftOverviewMetricKey): ShiftOverviewTrend => {
    const series = days.map((day) => valuesByDay.get(day)![key]);
    const values = series.some((value) => value !== 0) ? series : [];
    const previous = series[series.length - 2];
    const current = series[series.length - 1];
    return {
      values,
      changePercent: previous > 0 ? ((current - previous) / previous) * 100 : undefined,
    };
  };

  return {
    sales: getTrend('sales'),
    transactions: getTrend('transactions'),
    cash: getTrend('cash'),
    cards: getTrend('cards'),
    expenses: getTrend('expenses'),
    netSales: getTrend('netSales'),
  };
}
