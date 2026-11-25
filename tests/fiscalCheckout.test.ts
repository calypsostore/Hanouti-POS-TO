import { describe, expect, it } from 'vitest';
import type {
  FiscalProfileRecord,
  FiscalTaxAssignmentRecord,
  FiscalTaxRuleRecord,
} from '../src/types/fiscal';
import type { OrderLineRecord } from '../src/types/domain';
import { calculateFiscalCheckoutSnapshot } from '../src/services/fiscal/fiscalCheckout';

const profile: FiscalProfileRecord = {
  storeId: 'store-a',
  reviewStatus: 'confirmed',
  requiredTaxTypes: ['vat'],
  pricingMode: 'exclusive',
  reviewedBy: 'owner-a',
  reviewedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const rule: FiscalTaxRuleRecord = {
  id: 'vat-rule',
  storeId: 'store-a',
  version: 1,
  name: 'Synthetic checkout fixture',
  taxType: 'vat',
  calculationMethod: 'percentage',
  ratePpm: 100_000,
  priority: 1,
  effectiveFrom: '2026-01-01',
  status: 'active',
  legalReviewed: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const line: OrderLineRecord = {
  itemId: 'item-a',
  categoryId: 'category-a',
  name: 'Fixture item',
  quantity: 1,
  unitPriceMillimes: 1_000,
  lineTotalMillimes: 1_000,
  modifiers: [],
};

function assignment(overrides: Partial<FiscalTaxAssignmentRecord> = {}): FiscalTaxAssignmentRecord {
  return {
    id: 'assignment-a',
    storeId: 'store-a',
    categoryId: 'category-a',
    taxType: 'vat',
    treatment: 'taxable',
    ruleId: rule.id,
    ruleVersion: rule.version,
    effectiveFrom: '2026-01-01',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('fiscal checkout preparation', () => {
  it('resolves effective category classifications and computes the order snapshot', () => {
    const snapshot = calculateFiscalCheckoutSnapshot({
      storeId: 'store-a',
      transactionDate: '2026-02-01',
      lines: [line],
      profile,
      rules: [rule],
      assignments: [assignment()],
    });

    expect(snapshot).toMatchObject({
      storeId: 'store-a',
      totalAmountMillimes: 1_100,
      totalTaxMillimes: 100,
    });
    expect(snapshot?.lines[0].taxes[0]).toMatchObject({
      ruleId: rule.id,
      amountMillimes: 100,
    });
  });

  it('uses the item classification ahead of its category classification', () => {
    const exempt = assignment({
      id: 'item-exemption',
      itemId: 'item-a',
      categoryId: undefined,
      treatment: 'exempt',
      ruleId: undefined,
      ruleVersion: undefined,
      legalReference: 'Test fixture evidence',
    });
    const snapshot = calculateFiscalCheckoutSnapshot({
      storeId: 'store-a',
      transactionDate: '2026-02-01',
      lines: [line],
      profile,
      rules: [rule],
      assignments: [assignment(), exempt],
    });

    expect(snapshot?.totalAmountMillimes).toBe(1_000);
    expect(snapshot?.lines[0].taxes[0]).toMatchObject({
      treatment: 'exempt',
      amountMillimes: 0,
    });
  });

  it('fails closed when active rules exist without configured tax types or classification', () => {
    expect(() => calculateFiscalCheckoutSnapshot({
      storeId: 'store-a',
      transactionDate: '2026-02-01',
      lines: [line],
      rules: [rule],
      assignments: [],
    })).toThrow('no configured line-tax types');

    expect(() => calculateFiscalCheckoutSnapshot({
      storeId: 'store-a',
      transactionDate: '2026-02-01',
      lines: [line],
      profile,
      rules: [rule],
      assignments: [],
    })).toThrow('needs an effective vat classification');
  });
});
