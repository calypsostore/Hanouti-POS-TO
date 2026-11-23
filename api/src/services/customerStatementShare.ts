import { formatTnd } from '../lib/format';
import { shareTextAsPdf } from './receiptExport';
import type { CustomerStatementData } from './customerService';

function formatAmount(amountMillimes: number): string {
  return `${formatTnd(Math.abs(amountMillimes) / 1000)} DT`;
}

export async function shareCustomerStatement(statement: CustomerStatementData): Promise<void> {
  const { customer, balanceMillimes, transactions, orders } = statement;
  const orderIndex = new Map(orders.map((order) => [order.id, order]));
  const entries = [...transactions].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const text = [
    `${customer.name} - customer tab statement`,
    `As of ${new Date().toLocaleString()}`,
    '',
    ...entries.map((entry) => {
      const order = entry.orderId ? orderIndex.get(entry.orderId) : undefined;
      const label = entry.kind === 'issued'
        ? `Ticket #${order?.number ?? '-'}`
        : entry.kind === 'reversal' ? 'Payment reversed' : 'Cash payment';
      const sign = entry.kind === 'issued' || entry.kind === 'reversal' ? '+' : '-';
      const note = entry.note ? ` (${entry.note})` : '';
      return `${new Date(entry.createdAt).toLocaleDateString()} ${label}: ${sign}${formatAmount(entry.amountMillimes)}${note}`;
    }),
    ...(entries.length ? [] : ['No tab activity recorded.']),
    '',
    `${balanceMillimes < 0 ? 'Credit balance' : 'Amount due'}: ${formatAmount(balanceMillimes)}`,
  ].join('\n');

  await shareTextAsPdf(text, `tab-statement-${customer.name}`, `Tab statement - ${customer.name}`);
}
