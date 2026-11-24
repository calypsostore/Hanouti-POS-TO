import { useState } from 'react';
import { MaterialIcon } from './MaterialIcon';
import { SettingsGlassSection } from './settings/SettingsGlassSection';
import { updateDisplaySettings, useDisplaySettings, type DisplaySettings } from '../lib/displaySettings';

type DisplayPreferenceChanges = Pick<Partial<DisplaySettings>, 'theme' | 'largeButtons' | 'compactDensity'>;

export function AppearanceSettings() {
  const settings = useDisplaySettings();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  function save(changes: DisplayPreferenceChanges) {
    setNotice('');
    setError('');
    try {
      updateDisplaySettings(changes);
      setNotice('Display settings saved on this device.');
    } catch (saveError) {
      console.error('Unable to save display settings.', saveError);
      setError('Unable to save display settings. Please try again.');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SettingsGlassSection
        heading="Display"
        description="Choose how 7anouti-POS looks on this device."
        icon="palette"
        headingId="display-settings-heading"
      >
        <label htmlFor="display-theme" className="font-body text-label-md text-on-surface">Theme</label>
        <select
          id="display-theme"
          value={settings.theme}
          onChange={(event) => {
            const theme = event.currentTarget.value;
            if (theme === 'light' || theme === 'dark' || theme === 'system') save({ theme });
          }}
          className="h-12 w-full rounded-lg bg-surface-container-low px-3 font-body text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>

        <label className="flex min-h-12 items-center gap-3 rounded-xl bg-surface-container-low p-3 font-body text-label-md text-on-surface">
          <input
            type="checkbox"
            checked={settings.largeButtons}
            onChange={(event) => save({ largeButtons: event.currentTarget.checked })}
            className="h-5 w-5 accent-primary"
          />
          <span>
            <span className="block">Large buttons</span>
            <span className="mt-1 block font-body text-body-sm text-on-surface-variant">
              Use larger product cards, quantity controls and action buttons in the POS.
            </span>
          </span>
        </label>

        <label className="desktop-density-option flex min-h-12 items-center gap-3 rounded-xl bg-surface-container-low p-3 font-body text-label-md text-on-surface">
          <input
            type="checkbox"
            checked={settings.compactDensity}
            onChange={(event) => save({ compactDensity: event.currentTarget.checked })}
            className="h-5 w-5 accent-primary"
          />
          <span>
            <span className="block">Compact density</span>
            <span className="mt-1 block font-body text-body-sm text-on-surface-variant">
              Reduce desktop card spacing and type size to show more information.
            </span>
          </span>
        </label>
        {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
        {notice && <p role="status" className="flex items-center gap-1 font-body text-body-sm text-success-dark"><MaterialIcon name="check_circle" />{notice}</p>}
      </SettingsGlassSection>
    </div>
  );
}
