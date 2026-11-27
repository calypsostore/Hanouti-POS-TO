import { describe, expect, it } from 'vitest';
import { getSubscriptionDaysRemaining } from '../src/lib/subscriptionExpiry';

describe('subscription expiry dates', () => {
  const today = new Date(2026, 10, 20, 12);

  it('calculates upcoming, current-day, and expired subscription dates', () => {
    expect(getSubscriptionDaysRemaining('2026-11-27', today)).toBe(7);
    expect(getSubscriptionDaysRemaining('2026-11-20', today)).toBe(0);
    expect(getSubscriptionDaysRemaining('2026-11-19', today)).toBe(-1);
  });

  it('rejects invalid expiry dates for warning display', () => {
    expect(getSubscriptionDaysRemaining('not-a-date', today)).toBeNull();
  });
});
