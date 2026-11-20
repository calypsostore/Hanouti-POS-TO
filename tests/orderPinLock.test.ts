import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/data/driver', () => ({ isSupabaseDriver: () => true }));

import { orderService } from '../src/services/orderService';

describe('void PIN lock countdown', () => {
  it('does not read local storage when Supabase is the active data driver', () => {
    expect(() => orderService.getPinLockRemainingMs('store-remote')).not.toThrow();
    expect(orderService.getPinLockRemainingMs('store-remote')).toBe(0);
  });
});
