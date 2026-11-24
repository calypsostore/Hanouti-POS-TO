import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyStoreAppearance, resetStoreAppearance } from '../src/lib/storeAppearance';
import { DEFAULT_STORE_APPEARANCE, resolveStoreAppearance } from '../src/theme/themeRegistry';

describe('store appearance application', () => {
  let variables: Map<string, string>;
  let classes: Map<string, boolean>;
  let addThemeClass: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    variables = new Map();
    classes = new Map();
    addThemeClass = vi.fn();
    const root = {
      classList: {
        add: addThemeClass,
        toggle: (name: string, value: boolean) => classes.set(name, value),
      },
      style: { setProperty: (name: string, value: string) => variables.set(name, value) },
    };
    vi.stubGlobal('document', { documentElement: root, querySelector: () => null });
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false, addEventListener: vi.fn() }) });
    resetStoreAppearance();
  });

  it('applies the persisted store color, component, and typography tokens to the document', () => {
    const appearance = resolveStoreAppearance({
      ...DEFAULT_STORE_APPEARANCE,
      mode: 'light',
      light: {
        palette: { primary: '250 204 21' },
        dimensions: { buttonRadius: '12px', inputHeight: '44px' },
        typography: { sizes: { bodyMd: '16px' } },
      },
    });

    applyStoreAppearance(appearance);

    expect(variables.get('--color-primary')).toBe('250 204 21');
    expect(variables.get('--button-radius')).toBe('12px');
    expect(variables.get('--input-height')).toBe('44px');
    expect(variables.get('--font-size-body-md')).toBe('16px');
    expect(classes.get('dark')).toBe(false);
    expect(addThemeClass).toHaveBeenCalledWith('theme-hanouti-crystal-glass');
  });

  it('ignores obsolete local theme preferences without deleting unrelated stored values', () => {
    const legacyPreference = JSON.stringify({ theme: 'dark', paletteId: 'olive-market' });
    const storage = new Map([['hanouti.display-settings.v1', legacyPreference], ['unrelated-setting', 'preserve']]);
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
    });

    resetStoreAppearance();

    expect(variables.get('--color-primary')).toBe(DEFAULT_STORE_APPEARANCE.light.palette.primary);
    expect(storage.get('hanouti.display-settings.v1')).toBe(legacyPreference);
    expect(storage.get('unrelated-setting')).toBe('preserve');
  });

  it('applies the shared dark palette and large-control setting', () => {
    applyStoreAppearance({ ...DEFAULT_STORE_APPEARANCE, mode: 'dark', largeButtons: true, compactDensity: true });

    expect(variables.get('--color-primary')).toBe(DEFAULT_STORE_APPEARANCE.dark.palette.primary);
    expect(classes.get('dark')).toBe(true);
    expect(classes.get('large-buttons')).toBe(true);
    expect(classes.get('compact-density')).toBe(true);
  });
});
