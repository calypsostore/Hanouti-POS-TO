import { formatTnd } from '../lib/format';
import { formatTicketDateTime, getTicketDateLocale, ticketT } from '../i18n/tickets';
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
    ticketT('Customer tab statement for {customer}', { customer: customer.name }),
    ticketT('As of {date}', { date: formatTicketDateTime(new Date()) }),
    '',
    ...entries.map((entry) => {
      const order = entry.orderId ? orderIndex.get(entry.orderId) : undefined;
      const label = entry.kind === 'issued'
        ? ticketT('Ticket #{number}', { number: order?.number ?? '-' })
        : entry.kind === 'reversal' ? ticketT('Payment reversed') : ticketT('Cash payment');
      const sign = entry.kind === 'issued' || entry.kind === 'reversal' ? '+' : '-';
      const note = entry.note ? ` (${entry.note})` : '';
      return `${new Date(entry.createdAt).toLocaleDateString(getTicketDateLocale())} ${label}: ${sign}${formatAmount(entry.amountMillimes)}${note}`;
    }),
    ...(entries.length ? [] : [ticketT('No tab activity recorded.')]),
    '',
    `${ticketT(balanceMillimes < 0 ? 'Credit balance' : 'Amount due')}: ${formatAmount(balanceMillimes)}`,
  ].join('\n');

  await shareTextAsPdf(text, `tab-statement-${customer.name}`, ticketT('Tab statement - {customer}', { customer: customer.name }));
}
