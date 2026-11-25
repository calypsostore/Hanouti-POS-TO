import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const settingsScreen = readFileSync('src/screens/SettingsScreen.tsx', 'utf8');
const settingsStyles = [
  readFileSync('src/styles.css', 'utf8'),
  ...readdirSync('src/styles')
    .filter((file) => file.endsWith('.css'))
    .map((file) => readFileSync(`src/styles/${file}`, 'utf8')),
].join('\n');
const logoPicker = readFileSync('src/components/LogoPicker.tsx', 'utf8');
const settingsSection = readFileSync('src/components/settings/SettingsGlassSection.tsx', 'utf8');
const appearanceSettings = readFileSync('src/components/AppearanceSettings.tsx', 'utf8');

describe('Settings legacy layout', () => {
  it('renders the historical category overview and opens one section at a time', () => {
    expect(settingsScreen).toContain('<div className="settings-content">');
    expect(settingsScreen).toContain('className="settings-dashboard"');
    expect(settingsScreen).toContain('className="settings-dashboard-grid"');
    expect(settingsScreen).toContain('className="settings-dashboard-card"');
    expect(settingsScreen).toContain('<div className="settings-section-content">');
    expect(settingsScreen).toContain('className="settings-back-button"');
    expect(settingsScreen).toContain("activeSection.id === 'display'");
    expect(settingsScreen).toContain("hidden={activeSection.id !== 'receipts'}");
    expect(settingsScreen).not.toContain('settings-section-nav');

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

  it('keeps settings section deep links and existing controls available', () => {
    expect(settingsScreen).toContain('SettingsGlassSection');
    expect(settingsScreen).toContain('settings-logo-picker-panel');
    expect(settingsScreen).toContain('setSearchParams({ section: section.id })');
    expect(settingsSection).toContain('id={id}');
    expect(settingsSection).toContain('className={`settings-section ');
    expect(logoPicker).toContain('panelClassName');
    expect(settingsSection).not.toContain('settings-glass-section');
    expect(settingsStyles).not.toContain('.settings-glass-section');
    expect(settingsStyles).toContain('.settings-logo-picker-panel');
    expect(settingsStyles).not.toContain('.workspace-layout.settings-screen-layout');
    expect(settingsStyles).toContain('.settings-dashboard-card');
    expect(settingsStyles).not.toContain('.settings-overview-card');
    expect(settingsStyles).toContain('.settings-section-content [hidden]');
    expect(appearanceSettings).toContain('Hanouti Crystal Glass');
    expect(appearanceSettings).toContain('type="color"');
    expect(appearanceSettings).toContain('Save shared theme');
    expect(appearanceSettings).toContain('disabled={!canEdit}');
    expect(settingsScreen).toContain('userService.updateStoreSettings(store.id, user.id, { appearance })');
    expect(settingsScreen).not.toContain('updateDisplaySettings');
    expect(appearanceSettings).not.toContain('localStorage');
    expect(settingsStyles).not.toContain('.legacy-workspace');
  });
});
