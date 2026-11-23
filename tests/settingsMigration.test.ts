import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settingsScreen = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
const settingsStyles = readFileSync('src/styles.css', 'utf8');
const logoPicker = readFileSync('src/components/LogoPicker.tsx', 'utf8');

describe('Settings Crystal Glass migration', () => {
  it('keeps every role-based owner Settings subsection in the rendered screen', () => {
    for (const section of [
      'display',
      'store',
      'receipts',
      'security',
      'customers',
      'staff',
      'notifications',
      'help',
      'language',
      'permissions',
      'updates',
    ]) {
      expect(settingsScreen).toContain(`id: '${section}'`);
    }
  });

  it('uses shared glass section and popup styling hooks', () => {
    expect(settingsScreen).toContain('SettingsGlassSection');
    expect(settingsScreen).toContain('settings-logo-picker-panel');
    expect(logoPicker).toContain('panelClassName');
    expect(settingsStyles).toContain('.settings-glass-section');
    expect(settingsStyles).toContain('.settings-logo-picker-panel');
    expect(settingsStyles).toContain('.workspace-layout.settings-screen-layout');
  });
});
