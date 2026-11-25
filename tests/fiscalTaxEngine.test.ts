import { describe, expect, it } from 'vitest';
import { isFiscalOrderSnapshot, type FiscalLineTaxInput, type FiscalTaxRuleRecord } from '../src/types/fiscal';
import { calculateFiscalOrder } from '../src/services/fiscal/taxEngine';
import { aggregateFiscalOrders } from '../src/services/fiscal/fiscalReporting';

const tenPercentRule: FiscalTaxRuleRecord = {
  id: 'tax-vat-v1',
  storeId: 'store-a',
  version: 1,
  name: 'Synthetic 10 percent test rule',
  taxType: 'vat',
  calculationMethod: 'percentage',
  ratePpm: 100_000,
  priority: 1,
  effectiveFrom: '2026-01-01',
  status: 'active',
  legalReviewed: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function line(overrides: Partial<FiscalLineTaxInput> = {}): FiscalLineTaxInput {
  return {
    lineId: 'line-1',
    itemId: 'item-1',
    quantity: 1,
    unitAmountMillimes: 1_000,
    priceMode: 'exclusive',
    requiredTaxTypes: ['vat'],
    treatments: [{ taxType: 'vat', treatment: 'taxable' }],
    rules: [tenPercentRule],
    ...overrides,
  };
}

describe('fiscal tax engine', () => {
  it('accepts only structurally valid, reconciled fiscal snapshots', () => {
    const snapshot = calculateFiscalOrder('store-a', '2026-06-01', [line()]);

    expect(isFiscalOrderSnapshot(snapshot)).toBe(true);
    expect(isFiscalOrderSnapshot({
      ...snapshot,
      totalTaxMillimes: 99,
    })).toBe(false);
    expect(isFiscalOrderSnapshot({
      ...snapshot,
      lines: [{ ...snapshot.lines[0], taxes: [] }],
    })).toBe(false);
  });

  it('aggregates completed orders and reverses voids from their original snapshots', () => {
    const snapshot = calculateFiscalOrder('store-a', '2026-06-01', [line()]);
    const summary = aggregateFiscalOrders([
      { id: 'order-1', storeId: 'store-a', status: 'done', totalMillimes: 1_100, fiscalSnapshot: snapshot },
      { id: 'order-2', storeId: 'store-a', status: 'done', totalMillimes: 500 },
      { id: 'order-3', storeId: 'store-a', status: 'voided', totalMillimes: 1_100, fiscalSnapshot: snapshot },
      { id: 'order-4', storeId: 'store-a', status: 'voided', totalMillimes: 500 },
    ]);

    expect(summary).toMatchObject({
      completedOrderCount: 2,
      ordersWithFiscalSnapshot: 1,
      ordersMissingFiscalSnapshot: 1,
      voidedOrderCount: 2,
      voidedOrdersWithFiscalSnapshot: 1,
      voidedOrdersMissingFiscalSnapshot: 1,
      netAmountMillimes: 1_000,
      taxAmountMillimes: 100,
      grossAmountMillimes: 1_100,
      reversedNetAmountMillimes: -1_000,
      reversedTaxAmountMillimes: -100,
      reversedGrossAmountMillimes: -1_100,
    });
    expect(summary.taxes).toEqual([expect.objectContaining({
      taxType: 'vat',
      amountMillimes: 100,
      taxableBaseMillimes: 1_000,
    })]);
    expect(summary.reversedTaxes).toEqual([expect.objectContaining({
      taxType: 'vat',
      amountMillimes: -100,
      taxableBaseMillimes: -1_000,
    })]);
  });

  it('calculates exclusive tax and reconciles order totals in millimes', () => {
    const result = calculateFiscalOrder('store-a', '2026-06-01', [line()]);

    expect(result).toMatchObject({
      netAmountMillimes: 1_000,
      totalTaxMillimes: 100,
      totalAmountMillimes: 1_100,
      roundingPolicy: 'nearest-millime-half-up',
    });
    expect(result.lines[0].taxes[0]).toMatchObject({
      taxType: 'vat',
      ruleId: 'tax-vat-v1',
      ruleVersion: 1,
      taxableBaseMillimes: 1_000,
      amountMillimes: 100,
    });
  });

  it('reverses inclusive pricing to an exact net amount', () => {
    const result = calculateFiscalOrder('store-a', '2026-06-01', [line({
      unitAmountMillimes: 1_100,
      priceMode: 'inclusive',
    })]);

    expect(result.lines[0]).toMatchObject({
      netAmountMillimes: 1_000,
      totalTaxMillimes: 100,
      totalAmountMillimes: 1_100,
    });
  });

  it('applies compound and fixed-per-unit rules in explicit priority order', () => {
    const result = calculateFiscalOrder('store-a', '2026-06-01', [line({
      quantity: 2,
      rules: [
        tenPercentRule,
        {
          ...tenPercentRule,
          id: 'tax-consumption-v1',
          name: 'Synthetic compound test rule',
          taxType: 'consumption',
          ratePpm: 50_000,
          compoundWithPriorTaxes: true,
          priority: 2,
        },
        {
          ...tenPercentRule,
          id: 'tax-fixed-v1',
          name: 'Synthetic fixed test rule',
          taxType: 'other',
          calculationMethod: 'fixed',
          ratePpm: undefined,
          fixedAmountMillimes: 25,
          fixedAmountPerUnit: true,
          priority: 3,
        },
      ],
      requiredTaxTypes: ['vat', 'consumption', 'other'],
      treatments: [
        { taxType: 'vat', treatment: 'taxable' },
        { taxType: 'consumption', treatment: 'taxable' },
        { taxType: 'other', treatment: 'taxable' },
      ],
      unitAmountMillimes: 1_000,
    })]);

    expect(result.lines[0]).toMatchObject({
      netAmountMillimes: 2_000,
      totalTaxMillimes: 360,
      totalAmountMillimes: 2_360,
    });
    expect(result.lines[0].taxes.map((tax) => tax.taxableBaseMillimes)).toEqual([2_000, 2_200, 2_000]);
  });

  it('keeps documented exempt treatment separate from taxable lines', () => {
    const result = calculateFiscalOrder('store-a', '2026-06-01', [
      line(),
      line({
        lineId: 'line-2',
        itemId: 'item-2',
        unitAmountMillimes: 2_000,
        rules: [],
        treatments: [{
          taxType: 'vat',
          treatment: 'exempt',
          legalReference: 'Test fixture only',
          evidenceReference: 'evidence-1',
        }],
      }),
    ]);

    expect(result).toMatchObject({
      netAmountMillimes: 3_000,
      totalTaxMillimes: 100,
      totalAmountMillimes: 3_100,
    });
    expect(result.lines[1].taxes[0]).toMatchObject({
      treatment: 'exempt',
      amountMillimes: 0,
      evidenceReference: 'evidence-1',
    });
  });

  it('rejects missing treatment, undocumented exemptions, conflicting rules, and non-reconciling inclusive prices', () => {
    expect(() => calculateFiscalOrder('store-a', '2026-06-01', [line({
      treatments: [],
    })])).toThrow('needs an explicit vat treatment');

    expect(() => calculateFiscalOrder('store-a', '2026-06-01', [line({
      rules: [],
      treatments: [{ taxType: 'vat', treatment: 'exempt' }],
    })])).toThrow('needs legal/evidence documentation');

    expect(() => calculateFiscalOrder('store-a', '2026-06-01', [line({
      rules: [
        tenPercentRule,
        { ...tenPercentRule, id: 'tax-vat-v2', version: 2 },
      ],
    })])).toThrow('ambiguous tax rules');

    expect(() => calculateFiscalOrder('store-a', '2026-06-01', [line({
      unitAmountMillimes: 1_001,
      priceMode: 'inclusive',
      rules: [{ ...tenPercentRule, ratePpm: 1_000_000 }],
    })])).toThrow('cannot be reconciled exactly');
  });

  it('rejects inactive and out-of-date rules instead of recalculating from them', () => {
    expect(() => calculateFiscalOrder('store-a', '2025-12-31', [line()])).toThrow('not effective');
    expect(() => calculateFiscalOrder('store-a', '2026-06-01', [line({
      rules: [{ ...tenPercentRule, status: 'draft' }],
    })])).toThrow('not active');
    expect(() => calculateFiscalOrder('store-a', '2026-06-01', [line({
      rules: [{ ...tenPercentRule, legalReviewed: false }],
    })])).toThrow('has not been legally reviewed');
    expect(() => calculateFiscalOrder('store-b', '2026-06-01', [line()])).toThrow('belongs to another store');
  });
});
