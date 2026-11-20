import { describe, expect, it } from 'vitest';
import { resolveStoreSettings } from '../src/types/domain';

describe('store Quick Picks settings', () => {
  it('defaults to automatic picks and no manually selected products', () => {
    const settings = resolveStoreSettings();

    expect(settings.quickPickMode).toBe('auto');
    expect(settings.quickPickItemIds).toEqual([]);
  });

  it('preserves manual picks while removing blank and duplicate product ids', () => {
    const settings = resolveStoreSettings({
      quickPickMode: 'manual',
      quickPickItemIds: ['item-1', 'item-2', 'item-1', ' '],
    });

    expect(settings.quickPickMode).toBe('manual');
    expect(settings.quickPickItemIds).toEqual(['item-1', 'item-2']);
  });

});
