import { describe, expect, it } from 'vitest';
import { getRegisteredThemeIds, getTheme, hexToRgbTriplet, registerTheme } from '../src/theme/themeRegistry';

describe('theme registry', () => {
  it('registers Hanouti Crystal Glass as the initial theme', () => {
    const theme = getTheme('hanouti-crystal-glass');

    expect(theme.name).toBe('Hanouti Crystal Glass');
    expect(theme.light.palette.primary).toBe('15 95 110');
    expect(theme.dark.palette.primary).toBe('112 213 230');
  });

  it('provides complete light and dark tokens for every gallery theme', () => {
    const themeIds = getRegisteredThemeIds();

    expect(themeIds).toEqual([
      'hanouti-crystal-glass',
      'mediterranean-harbor',
      'olive-market',
      'terracotta-souk',
    ]);
    for (const id of themeIds) {
      const theme = getTheme(id);
      expect(theme.light.palette.primary).toMatch(/^\d+ \d+ \d+$/);
      expect(theme.light.palette.onPrimary).toMatch(/^\d+ \d+ \d+$/);
      expect(theme.dark.palette.primary).toMatch(/^\d+ \d+ \d+$/);
      expect(theme.dark.palette.accent).toMatch(/^\d+ \d+ \d+$/);
    }
  });

  it('supports registering an additional typed theme', () => {
    const existing = getTheme('hanouti-crystal-glass');
    registerTheme({
      ...existing,
      id: 'future-theme',
      name: 'Future Theme',
    });

    expect(getTheme('future-theme').name).toBe('Future Theme');
  });

  it('converts valid custom colors to CSS RGB triplets', () => {
    expect(hexToRgbTriplet('#0f5f6e')).toBe('15 95 110');
    expect(hexToRgbTriplet('zzzzzz')).toBeNull();
  });
});
