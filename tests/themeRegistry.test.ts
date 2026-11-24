import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STORE_APPEARANCE,
  getRegisteredThemeIds,
  getTheme,
  hexToRgbTriplet,
  mergeStoreAppearance,
  resolveStoreAppearance,
} from '../src/theme/themeRegistry';

describe('theme registry', () => {
  it('keeps Hanouti Crystal Glass as the only registered official theme', () => {
    const theme = getTheme('hanouti-crystal-glass');
    const resolved = resolveStoreAppearance(DEFAULT_STORE_APPEARANCE);

    expect(theme.name).toBe('Hanouti Crystal Glass');
    expect(getRegisteredThemeIds()).toEqual(['hanouti-crystal-glass']);
    expect(theme.light.palette.primary).toBe('15 95 110');
    expect(theme.dark.palette.primary).toBe('112 213 230');
    expect(resolved.light.gradients.page).toBe(theme.light.gradients.page);
    expect(resolved.light.shadows.card).toBe(theme.light.shadows.card);
  });

  it('normalizes invalid or obsolete saved theme selections to the official theme', () => {
    const appearance = resolveStoreAppearance({
      themeId: 'olive-market',
      mode: 'invalid',
      light: { palette: { primary: 'var(--attacker-value)' } },
    });

    expect(appearance.themeId).toBe('hanouti-crystal-glass');
    expect(appearance.mode).toBe('system');
    expect(appearance.light.palette.primary).toBe(DEFAULT_STORE_APPEARANCE.light.palette.primary);
  });

  it('merges a token edit without discarding other saved store appearance values', () => {
    const current = resolveStoreAppearance({
      ...DEFAULT_STORE_APPEARANCE,
      mode: 'dark',
      light: { palette: { primary: '1 2 3', secondary: '4 5 6' } },
      compactDensity: true,
    });
    const updated = mergeStoreAppearance(current, {
      light: { palette: { primary: '7 8 9' } },
    });

    expect(updated.light.palette.primary).toBe('7 8 9');
    expect(updated.light.palette.secondary).toBe('4 5 6');
    expect(updated.mode).toBe('dark');
    expect(updated.compactDensity).toBe(true);
    expect(updated.themeId).toBe('hanouti-crystal-glass');
  });

  it('converts valid custom colors to CSS RGB triplets', () => {
    expect(hexToRgbTriplet('#0f5f6e')).toBe('15 95 110');
    expect(hexToRgbTriplet('zzzzzz')).toBeNull();
  });
});
