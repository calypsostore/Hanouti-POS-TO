import { beforeEach, describe, expect, it } from 'vitest';
import { userService } from '../src/services/userService';
import { DEFAULT_STORE_APPEARANCE } from '../src/theme/themeRegistry';

const storeId = 'store-cafe12';
const ownerId = 'owner-lamarsa';

describe('shared store appearance persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves appearance with existing store settings and restores it through the store record', async () => {
    await userService.updateStoreSettings(storeId, ownerId, {
      quickPickMode: 'manual',
      quickPickItemIds: ['item-direct'],
    });

    await userService.updateStoreSettings(storeId, ownerId, {
      appearance: {
        ...DEFAULT_STORE_APPEARANCE,
        mode: 'dark',
        light: {
          ...DEFAULT_STORE_APPEARANCE.light,
          palette: { ...DEFAULT_STORE_APPEARANCE.light.palette, primary: '7 8 9' },
        },
      },
    });

    const savedStore = await userService.getStore(storeId);
    expect(savedStore?.settings?.appearance.mode).toBe('dark');
    expect(savedStore?.settings?.appearance.light.palette.primary).toBe('7 8 9');
    expect(savedStore?.settings?.quickPickMode).toBe('manual');
    expect(savedStore?.settings?.quickPickItemIds).toEqual(['item-direct']);
  });

  it('does not allow a staff member to change the store-wide theme', async () => {
    await expect(userService.updateStoreSettings(storeId, 'staff-sarah', {
      appearance: DEFAULT_STORE_APPEARANCE,
    })).rejects.toThrow('Only this store owner can change store settings.');
  });
});
