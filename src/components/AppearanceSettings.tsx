import { useEffect, useState } from 'react';
import { hexToRgbTriplet, resolveStoreAppearance, type ColorMode, type StoreAppearance } from '../theme/themeRegistry';
import type { DesignTokens, ThemePalette } from '../theme/designTokens';
import { applyStoreAppearance } from '../lib/storeAppearance';
import { t, type TranslationKey } from '../i18n/translations';
import { MaterialIcon } from './MaterialIcon';
import { SettingsGlassSection } from './settings/SettingsGlassSection';
import { localizeErrorMessage } from '../i18n';

interface AppearanceSettingsProps {
  appearance: StoreAppearance;
  canEdit: boolean;
  onSave: (appearance: StoreAppearance) => Promise<StoreAppearance>;
}

const paletteFields: Array<{ key: keyof ThemePalette; label: TranslationKey; group: TranslationKey }> = [
  { key: 'primary', label: 'settings.palettePrimary', group: 'settings.paletteBrand' },
  { key: 'primaryPressed', label: 'settings.palettePrimaryActive', group: 'settings.paletteBrand' },
  { key: 'primaryDark', label: 'settings.palettePrimaryDark', group: 'settings.paletteBrand' },
  { key: 'onPrimary', label: 'settings.paletteOnPrimary', group: 'settings.paletteBrand' },
  { key: 'primaryFixed', label: 'settings.palettePrimaryFixed', group: 'settings.paletteBrand' },
  { key: 'primaryFixedDim', label: 'settings.palettePrimaryFixedDim', group: 'settings.paletteBrand' },
  { key: 'secondary', label: 'settings.paletteSecondary', group: 'settings.paletteBrand' },
  { key: 'secondaryContainer', label: 'settings.paletteSecondaryContainer', group: 'settings.paletteBrand' },
  { key: 'accent', label: 'settings.paletteAccent', group: 'settings.paletteBrand' },
  { key: 'accentContainer', label: 'settings.paletteAccentContainer', group: 'settings.paletteBrand' },
  { key: 'onAccent', label: 'settings.paletteOnAccent', group: 'settings.paletteBrand' },
  { key: 'surface', label: 'settings.palettePageBackground', group: 'settings.paletteSurfaces' },
  { key: 'surfaceDim', label: 'settings.paletteDimSurface', group: 'settings.paletteSurfaces' },
  { key: 'surfaceContainer', label: 'settings.paletteSectionBackground', group: 'settings.paletteSurfaces' },
  { key: 'surfaceContainerLow', label: 'settings.paletteLowSurface', group: 'settings.paletteSurfaces' },
  { key: 'surfaceContainerHigh', label: 'settings.paletteHighSurface', group: 'settings.paletteSurfaces' },
  { key: 'surfaceContainerHighest', label: 'settings.paletteHighestSurface', group: 'settings.paletteSurfaces' },
  { key: 'surfaceContainerLowest', label: 'settings.paletteCardBackground', group: 'settings.paletteSurfaces' },
  { key: 'onSurface', label: 'settings.paletteText', group: 'settings.paletteSurfaces' },
  { key: 'onSurfaceVariant', label: 'settings.paletteMutedText', group: 'settings.paletteSurfaces' },
  { key: 'outline', label: 'settings.paletteBorders', group: 'settings.paletteSurfaces' },
  { key: 'outlineVariant', label: 'settings.paletteDividers', group: 'settings.paletteSurfaces' },
  { key: 'success', label: 'settings.paletteSuccess', group: 'settings.paletteFeedback' },
  { key: 'successDark', label: 'settings.paletteSuccessDark', group: 'settings.paletteFeedback' },
  { key: 'successForeground', label: 'settings.paletteSuccessText', group: 'settings.paletteFeedback' },
  { key: 'successContainer', label: 'settings.paletteSuccessBackground', group: 'settings.paletteFeedback' },
  { key: 'onSuccess', label: 'settings.paletteOnSuccess', group: 'settings.paletteFeedback' },
  { key: 'onSuccessContainer', label: 'settings.paletteOnSuccessBackground', group: 'settings.paletteFeedback' },
  { key: 'warning', label: 'settings.paletteWarning', group: 'settings.paletteFeedback' },
  { key: 'warningDark', label: 'settings.paletteWarningDark', group: 'settings.paletteFeedback' },
  { key: 'warningContainer', label: 'settings.paletteWarningBackground', group: 'settings.paletteFeedback' },
  { key: 'onWarningContainer', label: 'settings.paletteOnWarningBackground', group: 'settings.paletteFeedback' },
  { key: 'info', label: 'settings.paletteInformation', group: 'settings.paletteFeedback' },
  { key: 'infoDark', label: 'settings.paletteInformationDark', group: 'settings.paletteFeedback' },
  { key: 'infoContainer', label: 'settings.paletteInformationContainer', group: 'settings.paletteFeedback' },
  { key: 'onInfoContainer', label: 'settings.paletteOnInformation', group: 'settings.paletteFeedback' },
  { key: 'error', label: 'settings.paletteError', group: 'settings.paletteFeedback' },
  { key: 'errorDark', label: 'settings.paletteErrorDark', group: 'settings.paletteFeedback' },
  { key: 'errorContainer', label: 'settings.paletteErrorBackground', group: 'settings.paletteFeedback' },
  { key: 'onErrorContainer', label: 'settings.paletteOnError', group: 'settings.paletteFeedback' },
];

const dimensionFields: Array<{ key: keyof DesignTokens['dimensions']; label: TranslationKey }> = [
  { key: 'buttonHeightSmall', label: 'settings.dimensionSmallButtonHeight' },
  { key: 'buttonHeightMedium', label: 'settings.dimensionMediumButtonHeight' },
  { key: 'buttonHeightLarge', label: 'settings.dimensionLargeButtonHeight' },
  { key: 'buttonRadius', label: 'settings.dimensionButtonRadius' },
  { key: 'buttonPaddingSmall', label: 'settings.dimensionSmallButtonPadding' },
  { key: 'buttonPaddingMedium', label: 'settings.dimensionMediumButtonPadding' },
  { key: 'buttonPaddingLarge', label: 'settings.dimensionLargeButtonPadding' },
  { key: 'inputHeight', label: 'settings.dimensionInputHeight' },
  { key: 'inputRadius', label: 'settings.dimensionInputRadius' },
  { key: 'cardRadius', label: 'settings.dimensionCardRadius' },
  { key: 'cardPadding', label: 'settings.dimensionCardPadding' },
  { key: 'tableHeaderHeight', label: 'settings.dimensionTableHeaderHeight' },
  { key: 'tableRowHeight', label: 'settings.dimensionTableRowHeight' },
  { key: 'tableCellPaddingX', label: 'settings.dimensionTableHorizontalPadding' },
  { key: 'tableCellPaddingY', label: 'settings.dimensionTableVerticalPadding' },
  { key: 'pageMaxWidth', label: 'settings.dimensionPageMaxWidth' },
  { key: 'pageGutterMobile', label: 'settings.dimensionMobileGutter' },
  { key: 'pageGutterTablet', label: 'settings.dimensionTabletGutter' },
  { key: 'pageGutterDesktop', label: 'settings.dimensionDesktopGutter' },
  { key: 'sectionGap', label: 'settings.dimensionSectionGap' },
  { key: 'cardGap', label: 'settings.dimensionCardGap' },
  { key: 'iconSmall', label: 'settings.dimensionSmallIcon' },
  { key: 'iconMedium', label: 'settings.dimensionMediumIcon' },
];

const radiusFields: Array<{ key: keyof DesignTokens['radius']; label: TranslationKey }> = [
  { key: 'small', label: 'settings.radiusSmall' },
  { key: 'medium', label: 'settings.radiusMedium' },
  { key: 'large', label: 'settings.radiusLarge' },
  { key: 'pill', label: 'settings.radiusPill' },
];

const textStyles: Array<{ key: keyof DesignTokens['typography']['sizes']; label: TranslationKey }> = [
  { key: 'headlineXl', label: 'settings.textHeadlineXl' },
  { key: 'headlineLg', label: 'settings.textHeadlineLg' },
  { key: 'headlineMd', label: 'settings.textHeadlineMd' },
  { key: 'headlineSm', label: 'settings.textHeadlineSm' },
  { key: 'titleMd', label: 'settings.textTitleMd' },
  { key: 'bodyLg', label: 'settings.textBodyLg' },
  { key: 'bodyMd', label: 'settings.textBodyMd' },
  { key: 'bodySm', label: 'settings.textBodySm' },
  { key: 'labelLg', label: 'settings.textLabelLg' },
  { key: 'labelMd', label: 'settings.textLabelMd' },
  { key: 'labelSm', label: 'settings.textLabelSm' },
  { key: 'currencyDisplay', label: 'settings.textCurrency' },
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

function validateAppearance(appearance: StoreAppearance): TranslationKey | null {
  for (const mode of ['light', 'dark'] as const) {
    const tokens = appearance[mode];
    const lengths = [
      ...Object.values(tokens.radius),
      ...Object.values(tokens.spacing),
      ...Object.values(tokens.dimensions),
      ...Object.values(tokens.typography.sizes),
      ...Object.values(tokens.typography.lineHeights),
    ];
    if (lengths.some((value) => !lengthPattern.test(value))) return 'settings.validationMeasurements';
    if (Object.values(tokens.typography.weights).some((value) => !Number.isInteger(value) || value < 100 || value > 900)) {
      return 'settings.validationWeights';
    }
    if (tokens.glass.surfaceAlpha < 0 || tokens.glass.surfaceAlpha > 1
      || tokens.glass.highSurfaceAlpha < 0 || tokens.glass.highSurfaceAlpha > 1
      || tokens.glass.blurPx < 0 || tokens.glass.blurPx > 64
      || tokens.glass.saturation < 0 || tokens.glass.saturation > 3) {
      return 'settings.validationGlass';
    }
    if (Object.values(tokens.shadows).some((value) =>
      value.length === 0 || value.length > 240 || !safeCssPattern.test(value) || /(?:url|var|expression)\s*\(/i.test(value))) {
      return 'settings.validationShadows';
    }
    if (tokens.gradients.page !== 'none' && (tokens.gradients.page.length > 240
      || !safeCssPattern.test(tokens.gradients.page) || !gradientPattern.test(tokens.gradients.page))
      || /(?:url|var|expression)\s*\(/i.test(tokens.gradients.page)) {
      return 'settings.validationGradient';
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

  async function save(appearanceToSave: StoreAppearance = draft) {
    if (!canEdit || saving) return;
    setError('');
    setNotice('');
    const validationError = validateAppearance(appearanceToSave);
    if (validationError) {
      setError(t(validationError));
      return;
    }
    setSaving(true);
    try {
      const saved = await onSave(resolveStoreAppearance(appearanceToSave));
      setDraft(resolveStoreAppearance(saved));
      applyStoreAppearance(saved);
      setNotice(t('settings.themeSaved'));
    } catch (saveError) {
      console.error('Unable to save the store theme.', saveError);
      if (appearanceToSave.mode !== appearance.mode) {
        setDraft((current) => ({ ...current, mode: appearance.mode }));
      }
      setError(localizeErrorMessage(saveError, t('settings.unableSaveTheme')));
    } finally {
      setSaving(false);
    }
  }

  async function changeMode(mode: ColorMode) {
    if (!canEdit || saving || mode === draft.mode) return;
    const nextAppearance = { ...draft, mode };
    setDraft(nextAppearance);
    await save(nextAppearance);
  }

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      <SettingsGlassSection
        heading={t('settings.themeTitle')}
        description={t('settings.themeDescription')}
        icon="palette"
        headingId="store-theme-settings-heading"
      >
        <p className="rounded-xl bg-surface-container-low p-3 font-body text-body-sm text-on-surface-variant">
          {t('settings.activeTheme')} <strong className="text-on-surface">{t('settings.themeName')}</strong>
          {!canEdit && t('settings.ownerOnlyAppearance')}
        </p>

        <label htmlFor="store-theme-mode" className="font-body text-label-md text-on-surface">{t('settings.colorMode')}</label>
        <select
          id="store-theme-mode"
          value={draft.mode}
          disabled={!canEdit || saving}
          onChange={(event) => {
            const mode = event.currentTarget.value as ColorMode;
            void changeMode(mode);
          }}
          className="w-full bg-surface-container-low px-3 font-body text-body-md text-on-surface outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
        >
          <option value="light">{t('settings.light')}</option>
          <option value="dark">{t('settings.dark')}</option>
          <option value="system">{t('settings.system')}</option>
        </select>

        <div className="flex flex-wrap gap-2" aria-label={t('settings.choosePalette')}>
          {(['light', 'dark'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={!canEdit}
              aria-pressed={editingMode === mode}
              onClick={() => setEditingMode(mode)}
              className={`min-h-10 rounded-lg px-3 font-body text-label-md ${editingMode === mode ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface'} disabled:opacity-60`}
            >
              {t('settings.editPalette', { mode: t(mode === 'light' ? 'settings.light' : 'settings.dark') })}
            </button>
          ))}
        </div>

        {(['settings.paletteBrand', 'settings.paletteSurfaces', 'settings.paletteFeedback'] as const).map((group) => (
          <fieldset key={group} className="min-w-0 rounded-xl border border-outline-variant p-3">
            <legend className="px-1 font-body text-label-md text-on-surface">{t(group)}{t('settings.colorsSuffix')}</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {paletteFields.filter((field) => field.group === group).map(({ key, label }) => (
                <label key={key} className="flex min-w-0 items-center justify-between gap-3 font-body text-body-sm text-on-surface">
                  <span>{t(label)}</span>
                  <input
                    type="color"
                    aria-label={t('settings.colorAria', { mode: t(editingMode === 'light' ? 'settings.light' : 'settings.dark'), label: t(label) })}
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
          <legend className="px-1 font-body text-label-md text-on-surface">{t('settings.typography')}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(['fontDisplay', 'fontBody'] as const).map((key) => (
              <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                {key === 'fontDisplay' ? t('settings.displayFont') : t('settings.bodyFont')}
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
                {t('settings.sizePx', { label: t(label) })}
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
                {t('settings.lineHeightPx', { label: t(label) })}
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
                {t('settings.weight', { name: t(`settings.weight${key[0].toUpperCase()}${key.slice(1)}` as TranslationKey) })}
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
          <summary className="cursor-pointer font-body text-label-md text-on-surface">{t('settings.advancedStyling')}</summary>
          <div className="mt-3 flex flex-col gap-4">
            <div>
              <h3 className="mb-2 font-body text-label-md text-on-surface">{t('settings.glassValues')}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([
                  { key: 'surfaceAlpha', label: 'settings.surfaceOpacity', min: 0, max: 1, step: 0.01 },
                  { key: 'highSurfaceAlpha', label: 'settings.highSurfaceOpacity', min: 0, max: 1, step: 0.01 },
                  { key: 'blurPx', label: 'settings.blur', min: 0, max: 64, step: 1 },
                  { key: 'saturation', label: 'settings.saturation', min: 0, max: 3, step: 0.05 },
                ] as const).map(({ key, label, min, max, step }) => (
                  <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                    {t(label)}
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
              <h3 className="mb-2 font-body text-label-md text-on-surface">{t('settings.componentDimensions')}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {dimensionFields.map(({ key, label }) => (
                  <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                    {t(label)}
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
                    {t('settings.sizePx', { label: t(label) })}
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
              <h3 className="mb-2 font-body text-label-md text-on-surface">{t('settings.shadowsBackground')}</h3>
              <div className="grid grid-cols-1 gap-3">
                {(Object.keys(draft[editingMode].shadows) as Array<keyof DesignTokens['shadows']>).map((key) => (
                  <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                    {t('settings.shadow', { name: t(`settings.shadow${key[0].toUpperCase()}${key.slice(1)}` as TranslationKey) })}
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
                  {t('settings.pageGradient')}
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
              <h3 className="mb-2 font-body text-label-md text-on-surface">{t('settings.spacingScale')}</h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(Object.keys(draft[editingMode].spacing) as Array<keyof DesignTokens['spacing']>).map((key) => (
                  <label key={key} className="flex flex-col gap-1 font-body text-body-sm text-on-surface">
                    {t(`settings.spacing${key.toUpperCase()}` as TranslationKey)}
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
            <span className="block">{t('settings.largePosControls')}</span>
            <span className="mt-1 block font-body text-body-sm text-on-surface-variant">
              {t('settings.largePosControlsHelp')}
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
            <span className="block">{t('settings.compactDensity')}</span>
            <span className="mt-1 block font-body text-body-sm text-on-surface-variant">
              {t('settings.compactDensityHelp')}
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
            {saving ? t('settings.savingTheme') : t('settings.saveTheme')}
          </button>
        )}
      </SettingsGlassSection>
    </div>
  );
}
