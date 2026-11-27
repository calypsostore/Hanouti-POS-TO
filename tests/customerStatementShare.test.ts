import { describe, expect, it, vi } from 'vitest';
import { getLanguage, setLanguage } from '../src/i18n';
import { shareCustomerStatement } from '../src/services/customerStatementShare';
import { shareTextAsPdf } from '../src/services/receiptExport';
import type { CustomerStatementData } from '../src/services/customerService';

vi.mock('../src/services/receiptExport', () => ({
  shareTextAsPdf: vi.fn(),
}));

const statement: CustomerStatementData = {
  customer: {
    id: 'customer-1',
    storeId: 'store-1',
    name: 'Sana',
    settlementTerms: 'monthly',
    isActive: true,
    createdAt: '2026-11-20T20:00:00.000Z',
  },
  balanceMillimes: -1500,
  transactions: [
    { id: 'issued-1', storeId: 'store-1', customerId: 'customer-1', shiftId: 'shift-1', staffId: 'staff-1', kind: 'issued', paymentMethod: 'cash', amountMillimes: 1500, createdAt: '2026-11-20T20:00:00.000Z' },
    { id: 'payment-1', storeId: 'store-1', customerId: 'customer-1', shiftId: 'shift-1', staffId: 'staff-1', kind: 'settled', paymentMethod: 'cash', amountMillimes: 500, createdAt: '2026-11-21T20:00:00.000Z' },
    { id: 'reversal-1', storeId: 'store-1', customerId: 'customer-1', shiftId: 'shift-1', staffId: 'staff-1', kind: 'reversal', paymentMethod: 'cash', amountMillimes: 500, createdAt: '2026-11-22T20:00:00.000Z' },
  ],
  orders: [],
};

describe('customer statement translations', () => {
  it('renders customer ticket details in French', async () => {
    const previousLanguage = getLanguage();
    try {
      setLanguage('fr');
      await shareCustomerStatement(statement);

      const [text, , title] = vi.mocked(shareTextAsPdf).mock.calls[0];
      expect(text).toContain('Relevé du compte client de Sana');
      expect(text).toContain('Ticket n° -');
      expect(text).toContain('Paiement en espèces');
      expect(text).toContain('Paiement annulé');
      expect(text).toContain('Solde créditeur');
      expect(title).toBe('Relevé du compte client - Sana');
    } finally {
      setLanguage(previousLanguage);
    }
  });

  it('renders the empty customer statement in Arabic', async () => {
    const previousLanguage = getLanguage();
    try {
      setLanguage('ar');
      await shareCustomerStatement({ ...statement, balanceMillimes: 1000, transactions: [] });

      const [text, , title] = vi.mocked(shareTextAsPdf).mock.calls[0];
      expect(text).toContain('لا توجد حركات مسجلة على حساب العميل.');
      expect(text).toContain('المبلغ المستحق');
      expect(title).toBe('كشف حساب العميل - Sana');
    } finally {
      setLanguage(previousLanguage);
    }
  });
});
