import { useEffect, useState } from 'react';
import { hexToRgbTriplet, resolveStoreAppearance, type ColorMode, type StoreAppearance } from '../theme/themeRegistry';
import type { DesignTokens, ThemePalette } from '../theme/designTokens';
import { applyStoreAppearance } from '../lib/storeAppearance';
import { MaterialIcon } from './MaterialIcon';
import { SettingsGlassSection } from './settings/SettingsGlassSection';

interface AppearanceSettingsProps {
  appearance: StoreAppearance;
  canEdit: boolean;
  onSave: (appearance: StoreAppearance) => Promise<StoreAppearance>;
}

const paletteFields: Array<{ key: keyof ThemePalette; label: string; group: string }> = [
  { key: 'primary', label: 'Primary', group: 'Brand' },
  { key: 'primaryPressed', label: 'Primary active', group: 'Brand' },
  { key: 'primaryDark', label: 'Primary dark', group: 'Brand' },
  { key: 'onPrimary', label: 'Text on primary', group: 'Brand' },
  { key: 'primaryFixed', label: 'Primary fixed', group: 'Brand' },
  { key: 'primaryFixedDim', label: 'Primary fixed dim', group: 'Brand' },
  { key: 'secondary', label: 'Secondary', group: 'Brand' },
  { key: 'secondaryContainer', label: 'Secondary container', group: 'Brand' },
  { key: 'accent', label: 'Accent', group: 'Brand' },
  { key: 'accentContainer', label: 'Accent container', group: 'Brand' },
  { key: 'onAccent', label: 'Text on accent', group: 'Brand' },
  { key: 'surface', label: 'Page background', group: 'Surfaces' },
  { key: 'surfaceDim', label: 'Dim surface', group: 'Surfaces' },
  { key: 'surfaceContainer', label: 'Section background', group: 'Surfaces' },
  { key: 'surfaceContainerLow', label: 'Low surface', group: 'Surfaces' },
  { key: 'surfaceContainerHigh', label: 'High surface', group: 'Surfaces' },
  { key: 'surfaceContainerHighest', label: 'Highest surface', group: 'Surfaces' },
  { key: 'surfaceContainerLowest', label: 'Card background', group: 'Surfaces' },
  { key: 'onSurface', label: 'Text', group: 'Surfaces' },
  { key: 'onSurfaceVariant', label: 'Muted text', group: 'Surfaces' },
  { key: 'outline', label: 'Borders', group: 'Surfaces' },
  { key: 'outlineVariant', label: 'Dividers', group: 'Surfaces' },
  { key: 'success', label: 'Success', group: 'Feedback' },
  { key: 'successDark', label: 'Success dark', group: 'Feedback' },
  { key: 'successForeground', label: 'Success text', group: 'Feedback' },
  { key: 'successContainer', label: 'Success background', group: 'Feedback' },
  { key: 'onSuccess', label: 'Text on success', group: 'Feedback' },
  { key: 'onSuccessContainer', label: 'Text on success background', group: 'Feedback' },
  { key: 'warning', label: 'Warning', group: 'Feedback' },
  { key: 'warningDark', label: 'Warning dark', group: 'Feedback' },
  { key: 'warningContainer', label: 'Warning background', group: 'Feedback' },
  { key: 'onWarningContainer', label: 'Text on warning background', group: 'Feedback' },
  { key: 'info', label: 'Information', group: 'Feedback' },
  { key: 'infoDark', label: 'Information dark', group: 'Feedback' },
  { key: 'infoContainer', label: 'Information background', group: 'Feedback' },
  { key: 'onInfoContainer', label: 'Text on information background', group: 'Feedback' },
  { key: 'error', label: 'Error', group: 'Feedback' },
  { key: 'errorDark', label: 'Error dark', group: 'Feedback' },
  { key: 'errorContainer', label: 'Error background', group: 'Feedback' },
  { key: 'onErrorContainer', label: 'Text on error background', group: 'Feedback' },
];

const dimensionFields: Array<{ key: keyof DesignTokens['dimensions']; label: string }> = [
  { key: 'buttonHeightSmall', label: 'Small button height' },
  { key: 'buttonHeightMedium', label: 'Medium button height' },
  { key: 'buttonHeightLarge', label: 'Large button height' },
  { key: 'buttonRadius', label: 'Button radius' },
  { key: 'buttonPaddingSmall', label: 'Small button padding' },
  { key: 'buttonPaddingMedium', label: 'Medium button padding' },
  { key: 'buttonPaddingLarge', label: 'Large button padding' },
  { key: 'inputHeight', label: 'Input height' },
  { key: 'inputRadius', label: 'Input radius' },
  { key: 'cardRadius', label: 'Card radius' },
  { key: 'cardPadding', label: 'Card padding' },
  { key: 'tableHeaderHeight', label: 'Table header height' },
  { key: 'tableRowHeight', label: 'Table row height' },
  { key: 'tableCellPaddingX', label: 'Table horizontal padding' },
  { key: 'tableCellPaddingY', label: 'Table vertical padding' },
  { key: 'pageMaxWidth', label: 'Page maximum width' },
  { key: 'pageGutterMobile', label: 'Mobile page gutter' },
  { key: 'pageGutterTablet', label: 'Tablet page gutter' },
  { key: 'pageGutterDesktop', label: 'Desktop page gutter' },
  { key: 'sectionGap', label: 'Section spacing' },
  { key: 'cardGap', label: 'Card spacing' },
  { key: 'iconSmall', label: 'Small icon size' },
  { key: 'iconMedium', label: 'Medium icon size' },
];

const radiusFields: Array<{ key: keyof DesignTokens['radius']; label: string }> = [
  { key: 'small', label: 'Small radius' },
  { key: 'medium', label: 'Medium radius' },
  { key: 'large', label: 'Large radius' },
  { key: 'pill', label: 'Pill radius' },
];

const textStyles: Array<{ key: keyof DesignTokens['typography']['sizes']; label: string }> = [
  { key: 'headlineXl', label: 'Headline XL' },
  { key: 'headlineLg', label: 'Headline large' },
  { key: 'headlineMd', label: 'Headline medium' },
  { key: 'headlineSm', label: 'Headline small' },
  { key: 'titleMd', label: 'Title medium' },
  { key: 'bodyLg', label: 'Body large' },
  { key: 'bodyMd', label: 'Body medium' },
  { key: 'bodySm', label: 'Body small' },
  { key: 'labelLg', label: 'Label large' },
  { key: 'labelMd', label: 'Label medium' },
  { key: 'labelSm', label: 'Label small' },
  { key: 'currencyDisplay', label: 'Currency display' },
];

const fontOptions = ['Inter, sans-serif', 'Plus Jakarta Sans, sans-serif', 'Arial, sans-serif', 'system-ui, sans-serif'];
const lengthPattern = /^(?:0|(?:\d+|\d*\.\d+)(?:px|rem|em|%|vw|vh|dvh|svh))$/;
const safeCssPattern = /^[a-z\d.,%() #/-]+$/i;
const gradientPattern = /^(?:(?:radial|linear)-gradient\([a-z\d.,% #()/-]+\)\s*,?\s*)+$/i;

function colorToHex(value: string): string {
  return `#${value.split(' ').map((channel) => Number(channel).toString(16).padStart(2, '0')).join('')}`;
}

function lengthAsPixels(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(px|rem|em|%)$/.exec(value);
  if (!match) return 0;
  const amount = Number(match[1]);
  return match[2] === 'rem' || match[2] === 'em' ? amount * 16 : match[2] === '%' ? amount : amount;
}

function updateTokens(
  appearance: StoreAppearance,
  mode: 'light' | 'dark',
  update: (tokens: DesignTokens) => DesignTokens,
): StoreAppearance {
  return { ...appearance, [mode]: update(appearance[mode]) };
}

function validateAppearance(appearance: StoreAppearance): string | null {
  for (const mode of ['light', 'dark'] as const) {
    const tokens = appearance[mode];
    const lengths = [
      ...Object.values(tokens.radius),
      ...Object.values(tokens.spacing),
      ...Object.values(tokens.dimensions),
      ...Object.values(tokens.typography.sizes),
      ...Object.values(tokens.typography.lineHeights),
    ];
    if (lengths.some((value) => !lengthPattern.test(value))) return 'Design measurements must use px, rem, em, or percent units.';
    if (Object.values(tokens.typography.weights).some((value) => !Number.isInteger(value) || value < 100 || value > 900)) {
      return 'Font weights must be whole numbers from 100 to 900.';
    }
    if (tokens.glass.surfaceAlpha < 0 || tokens.glass.surfaceAlpha > 1
      || tokens.glass.highSurfaceAlpha < 0 || tokens.glass.highSurfaceAlpha > 1
      || tokens.glass.blurPx < 0 || tokens.glass.blurPx > 64
      || tokens.glass.saturation < 0 || tokens.glass.saturation > 3) {
      return 'Surface transparency, blur, and saturation are outside the allowed range.';
    }
    if (Object.values(tokens.shadows).some((value) =>
      value.length === 0 || value.length > 240 || !safeCssPattern.test(value) || /(?:url|var|expression)\s*\(/i.test(value))) {
      return 'Shadow values may contain only safe CSS color and measurement values.';
    }
    if (tokens.gradients.page !== 'none' && (tokens.gradients.page.length > 240
      || !safeCssPattern.test(tokens.gradients.page) || !gradientPattern.test(tokens.gradients.page))
      || /(?:url|var|expression)\s*\(/i.test(tokens.gradients.page)) {
      return 'The page background gradient is invalid.';
    }
  }
  return null;
}

export function AppearanceSettings({ appearance, canEdit, onSave }: AppearanceSettingsProps) {
  const [draft, setDraft] = useState(() => resolveStoreAppearance(appearance));
  const [editingMode, setEditingMode] = useState<'light' | 'dark'>('light');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => setDraft(resolveStoreAppearance(appearance)), [appearance]);

  function updatePalette(key: keyof ThemePalette, hex: string) {
    const rgb = hexToRgbTriplet(hex);
    if (!rgb) return;
    setDraft((current) => updateTokens(current, editingMode, (tokens) => ({
      ...tokens,
      palette: { ...tokens.palette, [key]: rgb },
    })));
    setNotice('');
  }

  function updateDimension(key: keyof DesignTokens['dimensions'], pixels: number) {
    setDraft((current) => updateTokens(current, editingMode, (tokens) => ({
      ...tokens,
      dimensions: { ...tokens.dimensions, [key]: `${pixels}px` },
    })));
    setNotice('');
  }

  async function save() {
    if (!canEdit || saving) return;
    setError('');
    setNotice('');
    const validationError = validateAppearance(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave(resolveStoreAppearance(draft));
      setDraft(resolveStoreAppearance(saved));
      applyStoreAppearance(saved);
      setNotice('The store theme has been saved and applied to this device.');
    } catch (saveError) {
      console.error('Unable to save the store theme.', saveError);
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the store theme. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <SettingsGlassSection
        heading="Theme settings"
        description="Hanouti Crystal Glass is the single official theme. Owners control the shared appearance for this store."
        icon="palette"
        headingId="store-theme-settings-heading"
      >
        <p className="rounded-xl bg-surface-container-low p-3 font-body text-body-sm text-on-surface-variant">
          Active theme: <strong className="text-on-surface">Hanouti Crystal Glass</strong>
          {!canEdit && ' — only the store owner can change shared appearance settings.'}
        </p>

        <label htmlFor="store-theme-mode" className="font-body text-label-md text-on-surface">Color mode</label>
        <select
          id="store-theme-mode"
          value={draft.mode}
          disabled={!canEdit}
          onChange={(event) => {
            const mode = event.currentTarget.value as ColorMode;
            setDraft((current) => ({ ...current, mode }));
            setNotice('');
          }}
          className="w-full bg-surface-container-low px-3 font-body text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>

        <div className="flex flex-wrap gap-2" aria-label="Choose which palette to edit">
          {(['light', 'dark'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={!canEdit}
              aria-pressed={editingMode === mode}
              onClick={() => setEditingMode(mode)}
              className={`min-h-10 rounded-lg px-3 font-body text-label-md ${editingMode === mode ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface'} disabled:opacity-60`}
            >
              Edit {mode} palette
            </button>
          ))}
        </div>

        {(['Brand', 'Surfaces', 'Feedback'] as const).map((group) => (
          <fieldset key={group} className="min-w-0 rounded-xl border border-outline-variant p-3">
            <legend className="px-1 font-body text-label-md text-on-surface">{group} colors</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {paletteFields.filter((field) => field.group === group).map(({ key, label }) => (
                <label key={key} className="flex min-w-0 items-center justify-between gap-3 font-body text-body-sm text-on-surface">
                  <span>{label}</span>
                  <input
                    type="color"
                    aria-label={`${editingMode} ${label} color`}
                    disabled={!canEdit}
                    value={colorToHex(draft[editingMode].palette[key])}
                    onChange={(event) => updatePalette(key, event.currentTarget.value)}
                    className="h-10 w-14 min-w-14 cursor-pointer rounded-md border border-outline-variant bg-surface-container-low p-1 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <fieldset className="min-w-0 rounded-xl border border-outline-variant p-3">
          <legend className="px-1 font-body text-label-md text-on-surface">Typography</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(['fontDisplay', 'fontBody'] as const).map((key) => (
              <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                {key === 'fontDisplay' ? 'Display font' : 'Body font'}
                <select
                  disabled={!canEdit}
                  value={draft[editingMode].typography[key]}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setDraft((current) => updateTokens(current, editingMode, (tokens) => ({
                      ...tokens,
                      typography: { ...tokens.typography, [key]: value },
                    })));
                    setNotice('');
                  }}
                  className="w-full bg-surface-container-low px-3 text-body-md disabled:opacity-60"
                >
                  {fontOptions.map((font) => <option key={font} value={font}>{font.split(',')[0]}</option>)}
                </select>
              </label>
            ))}
            {textStyles.map(({ key, label }) => (
              <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                {label} size (px)
                <input
                  type="number"
                  min="8"
                  max="96"
                  step="1"
                  disabled={!canEdit}
                  value={lengthAsPixels(draft[editingMode].typography.sizes[key])}
                  onChange={(event) => {
                    const value = `${event.currentTarget.value}px`;
                    setDraft((current) => updateTokens(current, editingMode, (tokens) => ({
                      ...tokens,
                      typography: { ...tokens.typography, sizes: { ...tokens.typography.sizes, [key]: value } },
                    })));
                    setNotice('');
                  }}
                  className="w-full px-3 disabled:opacity-60"
                />
              </label>
            ))}
            {textStyles.map(({ key, label }) => (
              <label key={`line-${key}`} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                {label} line height (px)
                <input
                  type="number"
                  min="8"
                  max="128"
                  step="1"
                  disabled={!canEdit}
                  value={lengthAsPixels(draft[editingMode].typography.lineHeights[key])}
                  onChange={(event) => {
                    const value = `${event.currentTarget.value}px`;
                    setDraft((current) => updateTokens(current, editingMode, (tokens) => ({
                      ...tokens,
                      typography: { ...tokens.typography, lineHeights: { ...tokens.typography.lineHeights, [key]: value } },
                    })));
                    setNotice('');
                  }}
                  className="w-full px-3 disabled:opacity-60"
                />
              </label>
            ))}
            {(Object.keys(draft[editingMode].typography.weights) as Array<keyof DesignTokens['typography']['weights']>).map((key) => (
              <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                {key} weight
                <input
                  type="number"
                  min="100"
                  max="900"
                  step="100"
                  disabled={!canEdit}
                  value={draft[editingMode].typography.weights[key]}
                  onChange={(event) => {
                    const value = Number(event.currentTarget.value);
                    setDraft((current) => updateTokens(current, editingMode, (tokens) => ({
                      ...tokens,
                      typography: { ...tokens.typography, weights: { ...tokens.typography.weights, [key]: value } },
                    })));
                    setNotice('');
                  }}
                  className="w-full px-3 disabled:opacity-60"
                />
              </label>
            ))}
          </div>
        </fieldset>

        <details className="rounded-xl border border-outline-variant p-3">
          <summary className="cursor-pointer font-body text-label-md text-on-surface">Buttons, cards, tables, spacing, and advanced styling</summary>
          <div className="mt-3 flex flex-col gap-4">
            <div>
              <h3 className="mb-2 font-body text-label-md text-on-surface">Glass surface values</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([
                  { key: 'surfaceAlpha', label: 'Surface opacity', min: 0, max: 1, step: 0.01 },
                  { key: 'highSurfaceAlpha', label: 'High surface opacity', min: 0, max: 1, step: 0.01 },
                  { key: 'blurPx', label: 'Blur (px)', min: 0, max: 64, step: 1 },
                  { key: 'saturation', label: 'Saturation', min: 0, max: 3, step: 0.05 },
                ] as const).map(({ key, label, min, max, step }) => (
                  <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                    {label}
                    <input
                      type="number"
                      min={min}
                      max={max}
                      step={step}
                      disabled={!canEdit}
                      value={draft[editingMode].glass[key]}
                      onChange={(event) => {
                        const value = Number(event.currentTarget.value);
                        setDraft((current) => updateTokens(current, editingMode, (tokens) => ({
                          ...tokens,
                          glass: { ...tokens.glass, [key]: value },
                        })));
                        setNotice('');
                      }}
                      className="w-full px-3 disabled:opacity-60"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 font-body text-label-md text-on-surface">Component dimensions (px)</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {dimensionFields.map(({ key, label }) => (
                  <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                    {label}
                    <input
                      type="number"
                      min="0"
                      max="2400"
                      step="1"
                      disabled={!canEdit}
                      value={lengthAsPixels(draft[editingMode].dimensions[key])}
                      onChange={(event) => updateDimension(key, Number(event.currentTarget.value))}
                      className="w-full px-3 disabled:opacity-60"
                    />
                  </label>
                ))}
                {radiusFields.map(({ key, label }) => (
                  <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                    {label} (px)
                    <input
                      type="number"
                      min="0"
                      max="9999"
                      step="1"
                      disabled={!canEdit}
                      value={lengthAsPixels(draft[editingMode].radius[key])}
                      onChange={(event) => {
                        const value = `${event.currentTarget.value}px`;
                        setDraft((current) => updateTokens(current, editingMode, (tokens) => ({
                          ...tokens,
                          radius: { ...tokens.radius, [key]: value },
                        })));
                        setNotice('');
                      }}
                      className="w-full px-3 disabled:opacity-60"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div>
              <h3 className="mb-2 font-body text-label-md text-on-surface">Shadows and page background</h3>
              <div className="grid grid-cols-1 gap-3">
                {(Object.keys(draft[editingMode].shadows) as Array<keyof DesignTokens['shadows']>).map((key) => (
                  <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                    {key} shadow
                    <input
                      type="text"
                      disabled={!canEdit}
                      value={draft[editingMode].shadows[key]}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setDraft((current) => updateTokens(current, editingMode, (tokens) => ({
                          ...tokens,
                          shadows: { ...tokens.shadows, [key]: value },
                        })));
                        setNotice('');
                      }}
                      className="w-full px-3 font-mono text-body-sm disabled:opacity-60"
                    />
                  </label>
                ))}
                <label className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                  Page background gradient
                  <textarea
                    rows={3}
                    disabled={!canEdit}
                    value={draft[editingMode].gradients.page}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDraft((current) => updateTokens(current, editingMode, (tokens) => ({
                        ...tokens,
                        gradients: { ...tokens.gradients, page: value },
                      })));
                      setNotice('');
                    }}
                    className="w-full p-3 font-mono text-body-sm disabled:opacity-60"
                  />
                </label>
              </div>
            </div>

            <div>
              <h3 className="mb-2 font-body text-label-md text-on-surface">Spacing scale (px)</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(Object.keys(draft[editingMode].spacing) as Array<keyof DesignTokens['spacing']>).map((key) => (
                  <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                    {key}
                    <input
                      type="number"
                      min="0"
                      max="256"
                      step="1"
                      disabled={!canEdit}
                      value={lengthAsPixels(draft[editingMode].spacing[key])}
                      onChange={(event) => {
                        const value = `${event.currentTarget.value}px`;
                        setDraft((current) => updateTokens(current, editingMode, (tokens) => ({
                          ...tokens,
                          spacing: { ...tokens.spacing, [key]: value },
                        })));
                        setNotice('');
                      }}
                      className="w-full px-3 disabled:opacity-60"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </details>

        <label className="flex min-h-12 items-center gap-3 rounded-xl bg-surface-container-low p-3 font-body text-label-md text-on-surface">
          <input
            type="checkbox"
            checked={draft.largeButtons}
            disabled={!canEdit}
            onChange={(event) => setDraft((current) => ({ ...current, largeButtons: event.currentTarget.checked }))}
            className="h-5 w-5 accent-primary"
          />
          <span>
            <span className="block">Large POS controls</span>
            <span className="mt-1 block font-body text-body-sm text-on-surface-variant">
              Share larger product cards and quantity controls across this store.
            </span>
          </span>
        </label>

        <label className="desktop-density-option flex min-h-12 items-center gap-3 rounded-xl bg-surface-container-low p-3 font-body text-label-md text-on-surface">
          <input
            type="checkbox"
            checked={draft.compactDensity}
            disabled={!canEdit}
            onChange={(event) => setDraft((current) => ({ ...current, compactDensity: event.currentTarget.checked }))}
            className="h-5 w-5 accent-primary"
          />
          <span>
            <span className="block">Compact density</span>
            <span className="mt-1 block font-body text-body-sm text-on-surface-variant">
              Reduce desktop spacing throughout the store workspace.
            </span>
          </span>
        </label>

        {error && <p role="alert" className="font-body text-body-sm text-error-dark">{error}</p>}
        {notice && <p role="status" className="flex items-center gap-1 font-body text-body-sm text-success-dark"><MaterialIcon name="check_circle" />{notice}</p>}
        {canEdit && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-4 font-body text-label-lg text-on-primary shadow-card disabled:cursor-wait disabled:opacity-60"
          >
            <MaterialIcon name={saving ? 'hourglass_empty' : 'save'} />
            {saving ? 'Saving shared theme…' : 'Save shared theme'}
          </button>
        )}
      </SettingsGlassSection>
    </div>
  );
}
