import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateDisplaySettingsForUser,
  clearDisplaySettingsForUser,
  discardDisplaySettingsPreview,
  previewDisplaySettings,
  updateDisplaySettings,
} from '../src/lib/displaySettings';
import { getRegisteredThemeIds, getTheme } from '../src/theme/themeRegistry';

const userSettingsKey = (userId: string) => `hanouti.display-settings.user.v1:${userId}`;

describe('display settings', () => {
  let variables: Map<string, string>;

  beforeEach(() => {
    localStorage.clear();
    variables = new Map();
    const root = {
      classList: { toggle: vi.fn() },
      style: { setProperty: (name: string, value: string) => variables.set(name, value) },
    };
    vi.stubGlobal('document', { documentElement: root, querySelector: () => null });
    vi.stubGlobal('window', {
      localStorage,
      matchMedia: () => ({ matches: false, addEventListener: vi.fn() }),
      addEventListener: vi.fn(),
    });
  });

  it('previews custom primary and accent colors without persisting until saved', () => {
    activateDisplaySettingsForUser('preview-user');
    previewDisplaySettings({ customPrimary: '#facc15', customAccent: '#a855f7' });

    expect(variables.get('--color-primary')).toBe('250 204 21');
    expect(variables.get('--color-on-primary')).toBe('16 27 32');
    expect(variables.get('--color-accent')).toBe('168 85 247');
    expect(localStorage.getItem(userSettingsKey('preview-user'))).toBeNull();

    discardDisplaySettingsPreview();

    expect(variables.get('--color-primary')).toBe('15 95 110');
    expect(variables.get('--color-accent')).toBe('14 165 233');
  });

  it('restores saved appearance by account without sharing personal preferences', () => {
    activateDisplaySettingsForUser('account-one');
    updateDisplaySettings({ paletteId: 'olive-market', theme: 'dark', customPrimary: '#8833cc' });

    activateDisplaySettingsForUser('account-two');
    expect(variables.get('--color-primary')).toBe(getTheme('hanouti-crystal-glass').light.palette.primary);
    expect(localStorage.getItem(userSettingsKey('account-two'))).toBeNull();

    activateDisplaySettingsForUser('account-one');
    expect(variables.get('--color-primary')).toBe('136 51 204');
    expect(localStorage.getItem(userSettingsKey('account-one'))).toContain('"paletteId":"olive-market"');
  });

  it('clears the active personal theme for Login while keeping the account cache isolated', () => {
    activateDisplaySettingsForUser('logout-user');
    updateDisplaySettings({ customPrimary: '#7c3aed', theme: 'dark' });

    clearDisplaySettingsForUser();

    expect(variables.get('--color-primary')).toBe('15 95 110');
    expect(variables.get('--color-accent')).toBe('14 165 233');
    expect(localStorage.getItem(userSettingsKey('logout-user'))).toContain('"customPrimary":"#7c3aed"');
  });

  it('applies every registered theme in both light and dark modes', () => {
    activateDisplaySettingsForUser('theme-test');

    for (const paletteId of getRegisteredThemeIds()) {
      const theme = getTheme(paletteId);
      updateDisplaySettings({ paletteId, theme: 'light', customPrimary: undefined, customAccent: undefined });
      expect(variables.get('--color-primary')).toBe(theme.light.palette.primary);

      updateDisplaySettings({ theme: 'dark' });
      expect(variables.get('--color-primary')).toBe(theme.dark.palette.primary);
    }
  });
});
