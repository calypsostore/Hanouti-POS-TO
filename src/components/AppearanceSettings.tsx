import { useEffect, useState } from 'react';
import { Button } from './Button';
import { MaterialIcon } from './MaterialIcon';
import {
  getRegisteredThemeIds,
  getTheme,
  type ColorMode,
} from '../theme/themeRegistry';
import {
  discardDisplaySettingsPreview,
  previewDisplaySettings,
  updateDisplaySettings,
  useDisplaySettings,
  type DisplaySettings,
} from '../lib/displaySettings';

const colorPresets = [
  { name: 'Hanouti teal', value: '#0F5F6E' },
  { name: 'Ocean blue', value: '#2563EB' },
  { name: 'Olive', value: '#5B6F28' },
  { name: 'Terracotta', value: '#C24132' },
  { name: 'Amethyst', value: '#7C3AED' },
  { name: 'Rose', value: '#DB2777' },
];

const defaultSettings: DisplaySettings = {
  theme: 'system',
  largeButtons: false,
  compactDensity: false,
  paletteId: 'hanouti-crystal-glass',
};

const modes: { value: ColorMode; label: string; icon: string }[] = [
  { value: 'light', label: 'Light', icon: 'light_mode' },
  { value: 'dark', label: 'Dark', icon: 'dark_mode' },
  { value: 'system', label: 'System', icon: 'settings_brightness' },
];

function getHexColor(value: string | undefined, fallback: string): string {
  return value && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
}

export function AppearanceSettings({ userId }: { userId: string }) {
  const savedSettings = useDisplaySettings();
  const [draft, setDraft] = useState(savedSettings);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const themes = getRegisteredThemeIds().map((id) => getTheme(id));

  useEffect(() => {
    setDraft(savedSettings);
  }, [userId, savedSettings]);

  useEffect(() => {
    previewDisplaySettings(draft);
  }, [draft]);

  useEffect(() => () => discardDisplaySettingsPreview(), []);

  function changeDraft(changes: Partial<DisplaySettings>) {
    setNotice('');
    setError('');
    setDraft((current) => ({ ...current, ...changes }));
  }

  function save() {
    setError('');
    try {
      updateDisplaySettings(draft);
      setNotice('Appearance saved for your account on this device.');
    } catch (saveError) {
      console.error('Unable to save appearance settings.', saveError);
      setError('Unable to save appearance settings. Please try again.');
    }
  }

  function reset() {
    setError('');
    setNotice('');
    setDraft(defaultSettings);
  }

  return (
    <div className="flex flex-col gap-5">
      <section aria-labelledby="appearance-heading" className="rounded-2xl bg-surface-container-lowest p-4 shadow-card sm:p-6">
        <div className="mb-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-fixed text-primary">
              <MaterialIcon name="palette" className="text-2xl" />
            </span>
            <div className="min-w-0">
              <h2 id="appearance-heading" className="font-display text-headline-md text-on-surface">Appearance &amp; themes</h2>
              <p className="mt-1 font-body text-body-sm text-on-surface-variant">
                Make the workspace yours. Changes preview instantly and are saved only when you choose Save.
              </p>
            </div>
          </div>
        </div>

        <fieldset>
          <legend className="mb-3 font-body text-label-md text-on-surface">Choose a theme</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Theme gallery">
            {themes.map((theme) => {
              const selected = draft.paletteId === theme.id;
              return (
                <button
                  key={theme.id}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`${theme.name}${selected ? ', selected' : ''}`}
                  onClick={() => changeDraft({ paletteId: theme.id, customPrimary: undefined, customAccent: undefined })}
                  className={`min-h-28 rounded-xl border p-3 text-start transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${selected ? 'border-primary bg-primary-fixed/40 ring-2 ring-primary' : 'border-outline-variant bg-surface-container-low hover:border-primary/50'}`}
                >
                  <span className="mb-3 flex items-center justify-between gap-2">
                    <span className="flex gap-1.5" aria-hidden="true">
                      <span className="h-5 w-5 rounded-full border border-on-surface/10" style={{ backgroundColor: `rgb(${theme.light.palette.primary})` }} />
                      <span className="h-5 w-5 rounded-full border border-on-surface/10" style={{ backgroundColor: `rgb(${theme.light.palette.accent})` }} />
                      <span className="h-5 w-5 rounded-full border border-outline-variant" style={{ backgroundColor: `rgb(${theme.light.palette.surfaceContainerLow})` }} />
                    </span>
                    {selected && <MaterialIcon name="check_circle" className="text-xl text-primary" />}
                  </span>
                  <span className="block font-body text-label-md text-on-surface">{theme.name}</span>
                  {theme.id === 'hanouti-crystal-glass' && (
                    <span className="mt-1 block font-body text-body-sm text-on-surface-variant">Default Hanouti style</span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="mt-6">
          <legend className="mb-3 font-body text-label-md text-on-surface">Color mode</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Color mode">
            {modes.map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={draft.theme === mode.value}
                onClick={() => changeDraft({ theme: mode.value })}
                className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border px-3 font-body text-label-md transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${draft.theme === mode.value ? 'border-primary bg-primary-fixed/40 text-primary' : 'border-outline-variant bg-surface-container-low text-on-surface hover:border-primary/50'}`}
              >
                <MaterialIcon name={mode.icon} />
                {mode.label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
          <fieldset>
            <legend className="mb-3 font-body text-label-md text-on-surface">Primary color</legend>
            <div className="flex items-center gap-3">
              <label htmlFor="appearance-primary-color" className="sr-only">Choose custom primary color</label>
              <input
                id="appearance-primary-color"
                type="color"
                value={getHexColor(draft.customPrimary, colorPresets[0].value)}
                onChange={(event) => changeDraft({ customPrimary: event.currentTarget.value })}
                className="h-12 w-14 cursor-pointer rounded-lg border border-outline-variant bg-surface-container-low p-1"
              />
              <span className="font-body text-body-sm text-on-surface-variant">
                Custom color updates buttons, navigation, focus states, and shared components.
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Curated primary color presets">
              {colorPresets.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  aria-label={`${color.name} primary preset`}
                  aria-pressed={getHexColor(draft.customPrimary, colorPresets[0].value).toLowerCase() === color.value.toLowerCase()}
                  onClick={() => changeDraft({ customPrimary: color.value })}
                  className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-outline-variant transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-pressed:border-on-surface"
                  style={{ backgroundColor: color.value }}
                >
                  {getHexColor(draft.customPrimary, colorPresets[0].value).toLowerCase() === color.value.toLowerCase() && (
                    <MaterialIcon name="check" className="text-xl text-white" />
                  )}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-3 font-body text-label-md text-on-surface">Accent color</legend>
            <div className="flex items-center gap-3">
              <label htmlFor="appearance-accent-color" className="sr-only">Choose custom accent color</label>
              <input
                id="appearance-accent-color"
                type="color"
                value={getHexColor(draft.customAccent, '#0EA5E9')}
                onChange={(event) => changeDraft({ customAccent: event.currentTarget.value })}
                className="h-12 w-14 cursor-pointer rounded-lg border border-outline-variant bg-surface-container-low p-1"
              />
              <span className="font-body text-body-sm text-on-surface-variant">
                Used for accent badges and highlighted details.
              </span>
            </div>
          </fieldset>
        </div>

        <fieldset className="mt-6 flex flex-col gap-2">
          <legend className="mb-1 font-body text-label-md text-on-surface">Workspace density</legend>
          <label className="flex min-h-12 items-center gap-3 rounded-xl bg-surface-container-low p-3 font-body text-label-md text-on-surface">
            <input
              type="checkbox"
              checked={draft.largeButtons}
              onChange={(event) => changeDraft({ largeButtons: event.currentTarget.checked })}
              className="h-5 w-5 accent-primary"
            />
            <span>
              <span className="block">Large buttons</span>
              <span className="mt-1 block font-body text-body-sm text-on-surface-variant">Use larger product cards, quantity controls and action buttons in the POS.</span>
            </span>
          </label>
          <label className="desktop-density-option flex min-h-12 items-center gap-3 rounded-xl bg-surface-container-low p-3 font-body text-label-md text-on-surface">
            <input
              type="checkbox"
              checked={draft.compactDensity}
              onChange={(event) => changeDraft({ compactDensity: event.currentTarget.checked })}
              className="h-5 w-5 accent-primary"
            />
            <span>
              <span className="block">Compact density</span>
              <span className="mt-1 block font-body text-body-sm text-on-surface-variant">Reduce desktop card spacing and type size to show more information.</span>
            </span>
          </label>
        </fieldset>
      </section>

      <section aria-labelledby="appearance-preview-heading" className="rounded-2xl bg-surface-container-lowest p-4 shadow-card sm:p-6">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 id="appearance-preview-heading" className="font-display text-headline-md text-on-surface">Live preview</h2>
            <p className="mt-1 font-body text-body-sm text-on-surface-variant">Your selection updates these shared interface elements immediately.</p>
          </div>
          <span className="rounded-full bg-success-container px-3 py-1 font-body text-label-sm text-on-success-container">Preview only</span>
        </div>

        <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface">
          <nav aria-label="Preview navigation" className="flex items-center justify-between gap-3 border-b border-outline-variant bg-surface-container-lowest px-4 py-3">
            <span className="flex min-w-0 items-center gap-2 font-body text-label-md text-on-surface">
              <MaterialIcon name="storefront" className="text-primary" />
              <span className="truncate">Hanouti workspace</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="rounded-full bg-accent-container px-2.5 py-1 font-body text-label-sm text-on-accent">Open</span>
              <MaterialIcon name="account_circle" className="text-2xl text-on-surface-variant" />
            </span>
          </nav>

          <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4">
            <article className="rounded-xl bg-surface-container-lowest p-4 shadow-card">
              <p className="font-body text-body-sm text-on-surface-variant">Today&apos;s sales</p>
              <p className="mt-1 font-display text-headline-md text-on-surface">128.500 TND</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button className="min-h-10 px-3 text-label-md">New order</Button>
                <span className="rounded-full bg-accent-container px-2.5 py-1 font-body text-label-sm text-on-accent">+12%</span>
              </div>
            </article>

            <div className="flex flex-col justify-center gap-3 rounded-xl bg-surface-container-lowest p-4 shadow-card">
              <label htmlFor="appearance-preview-input" className="font-body text-label-sm text-on-surface-variant">Search products</label>
              <input id="appearance-preview-input" readOnly value="Espresso" className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 font-body text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary" />
            </div>

            <div className="overflow-hidden rounded-xl border border-outline-variant bg-surface-container-lowest sm:col-span-2">
              <table className="w-full text-start font-body text-body-sm">
                <thead className="bg-surface-container-low text-on-surface-variant">
                  <tr><th className="px-3 py-2 text-start text-label-md">Item</th><th className="px-3 py-2 text-end text-label-md">Qty</th><th className="px-3 py-2 text-end text-label-md">Total</th></tr>
                </thead>
                <tbody className="text-on-surface">
                  <tr><td className="border-t border-outline-variant px-3 py-2">Espresso</td><td className="border-t border-outline-variant px-3 py-2 text-end">2</td><td className="border-t border-outline-variant px-3 py-2 text-end">5.000 TND</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="border-t border-outline-variant bg-surface-container-low p-3 sm:p-4">
            <div className="mx-auto max-w-sm rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-overlay" aria-label="Dialog appearance preview">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-headline-sm text-on-surface">Confirm order</h3>
                  <p className="mt-1 font-body text-body-sm text-on-surface-variant">Review the total before completing the sale.</p>
                </div>
                <MaterialIcon name="close" className="text-on-surface-variant" />
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="secondary" className="min-h-10 px-3 text-label-md">Cancel</Button>
                <Button className="min-h-10 px-3 text-label-md">Confirm</Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="ghost" onClick={reset}>Reset to default</Button>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
          {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
          {notice && <p role="status" className="font-body text-body-sm text-success-dark">{notice}</p>}
          <Button onClick={save}>Save appearance</Button>
        </div>
      </div>
    </div>
  );
}
