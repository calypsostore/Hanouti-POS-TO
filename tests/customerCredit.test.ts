import { describe, expect, it, vi } from 'vitest';
import { getCustomerCreditTone, loadCustomerCreditStatuses } from '../src/lib/customerCredit';
import { customerService } from '../src/services/customerService';

describe('getCustomerCreditTone', () => {
  it.each([
    [49.4, 'bg-success-dark'],
    [49.5, 'bg-secondary'],
    [50, 'bg-secondary'],
    [74.4, 'bg-secondary'],
    [74.5, 'bg-error-dark'],
    [75, 'bg-error-dark'],
  ])('uses %s percent as %s', (percentUsed, barClass) => {
    expect(getCustomerCreditTone('ok', percentUsed).barClass).toBe(barClass);
  });
});

describe('loadCustomerCreditStatuses', () => {
  it('returns no credit data and logs the error when the request fails', async () => {
    const error = new Error('RPC failed');
    const load = vi.fn().mockRejectedValue(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await expect(loadCustomerCreditStatuses(load)).resolves.toEqual({
        statuses: {},
        unavailable: true,
      });
      expect(consoleError).toHaveBeenCalledWith('Unable to load customer credit statuses.', error);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe('customerService.getAccountsSummaryFromData', () => {
  it('summarizes the already-loaded millime balances without counting settled customers as overdue', () => {
    const customers = [
      { id: 'owing', storeId: 'store-1', name: 'Owing', settlementTerms: 'weekly' as const, isActive: true, createdAt: '' },
      { id: 'settled', storeId: 'store-1', name: 'Settled', settlementTerms: 'weekly' as const, isActive: true, createdAt: '' },
    ];

    expect(customerService.getAccountsSummaryFromData(
      customers,
      {
        owing: { balance: 12_500, limit: 20_000, state: 'ok' },
        settled: { balance: 0, limit: 20_000, state: 'ok' },
      },
      {
        owing: { overdue: true },
        settled: { overdue: true },
      },
    )).toEqual({
      totalOutstandingMillimes: 12_500,
      customersOwing: 1,
      overdueCount: 1,
    });
  });
});
