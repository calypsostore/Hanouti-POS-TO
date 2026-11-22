import { describe, expect, it, vi } from 'vitest';

const { getStore, verifyStorePin } = vi.hoisted(() => ({
  getStore: vi.fn(),
  verifyStorePin: vi.fn(),
}));

vi.mock('../src/data/driver', () => ({ isSupabaseDriver: () => true }));
vi.mock('../src/services/userService', () => ({
  userService: { getStore, verifyStorePin },
}));
vi.mock('../src/services/offlineAvailability', () => ({
  requireOnlineForAction: vi.fn(),
}));

import { orderService } from '../src/services/orderService';

describe('void PIN lock countdown', () => {
  it('does not read local storage when Supabase is the active data driver', () => {
    expect(() => orderService.getPinLockRemainingMs('store-remote')).not.toThrow();
    expect(orderService.getPinLockRemainingMs('store-remote')).toBe(0);
  });

  it('checks a complete PIN with the server before asking for a reason', async () => {
    getStore.mockResolvedValue({ id: 'store-remote', pinMustChange: false });
    verifyStorePin.mockResolvedValue(true);

    await expect(orderService.verifyVoidPin('store-remote', '1234')).resolves.toBe(true);
    expect(verifyStorePin).toHaveBeenCalledWith('store-remote', '1234', 'void');
  });
});
