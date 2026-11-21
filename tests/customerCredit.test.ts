import { describe, expect, it } from 'vitest';
import { getCustomerCreditTone } from '../src/lib/customerCredit';

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
