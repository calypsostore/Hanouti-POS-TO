import { describe, expect, it } from 'vitest';
import type { OrderRecord } from '../src/types/domain';
import { buildTicketDocument } from '../src/services/ticketDocument';

describe('provisional offline tickets', () => {
  it('marks a locally queued ticket as provisional and not fiscalized', () => {
    const order: OrderRecord = {
      id: 'local-order',
      idempotencyKey: 'local-order',
      number: -1,
      storeId: 'store',
      staffId: 'staff',
      shiftId: 'shift',
      status: 'done',
      syncStatus: 'queued',
      paymentMethod: 'cash',
      items: [],
      totalMillimes: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    const document = buildTicketDocument(order, { name: 'Test Store' }, 'Cashier');

    expect(document.lines.map((line) => line.text).join('\n')).toContain(
      'PROVISIONAL LOCAL TICKET - NOT SERVER-CONFIRMED OR FISCALIZED',
    );
    expect(document.lines.some((line) => line.text === 'QUEUED - awaiting sync')).toBe(true);
  });
});
