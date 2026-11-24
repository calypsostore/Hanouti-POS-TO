import type { DesignTokens, RGB } from './designTokens';

export type ThemeId = 'hanouti-crystal-glass';

export type ColorMode = 'light' | 'dark' | 'system';

export interface StoreAppearance {
  themeId: ThemeId;
  mode: ColorMode;
  light: DesignTokens;
  dark: DesignTokens;
  largeButtons: boolean;
  compactDensity: boolean;
}

export interface ThemeRegistration {
  id: ThemeId;
  name: string;
  light: DesignTokens;
  dark: DesignTokens;
}

export const CRYSTAL_LIGHT: DesignTokens = {
  palette: {
    primary: '15 95 110',
    primaryPressed: '9 63 74',
    primaryDark: '16 27 32',
    onPrimary: '255 255 255',
    primaryFixed: '170 237 255',
    primaryFixedDim: '142 209 226',
    secondary: '133 83 0',
    secondaryContainer: '254 166 25',
    accent: '14 165 233',
    accentContainer: '224 242 254',
    onAccent: '255 255 255',
    surface: '244 248 249',
    surfaceDim: '234 242 244',
    surfaceContainer: '234 242 244',
    surfaceContainerLow: '238 245 246',
    surfaceContainerHigh: '220 233 236',
    surfaceContainerHighest: '209 221 224',
    surfaceContainerLowest: '255 255 255',
    onSurface: '16 27 32',
    onSurfaceVariant: '63 72 75',
    outline: '111 121 123',
    outlineVariant: '225 236 238',
    success: '16 185 129',
    successDark: '5 150 105',
    successForeground: '5 150 105',
    successContainer: '209 250 229',
    onSuccess: '6 46 28',
    onSuccessContainer: '6 95 70',
    warning: '245 158 11',
    warningDark: '180 83 9',
    warningContainer: '254 243 199',
    onWarningContainer: '133 77 14',
    info: '37 99 235',
    infoDark: '30 64 175',
    infoContainer: '219 234 254',
    onInfoContainer: '30 58 138',
    error: '239 68 68',
    errorDark: '220 38 38',
    errorContainer: '254 226 226',
    onErrorContainer: '153 27 27',
  },
  glass: { surfaceAlpha: 0.78, highSurfaceAlpha: 0.92, blurPx: 16, saturation: 1.15 },
  radius: { small: '0.25rem', medium: '0.75rem', large: '1.5rem', pill: '9999px' },
  shadows: {
    card: '0 2px 6px -1px rgba(15, 95, 110, 0.06), 0 1px 3px -1px rgba(0, 0, 0, 0.04)',
    sheet: '0 10px 25px -4px rgba(15, 95, 110, 0.12), 0 4px 6px -2px rgba(15, 95, 110, 0.04)',
    overlay: '0 20px 30px -6px rgba(16, 27, 32, 0.22)',
  },
  gradients: {
    page: 'radial-gradient(ellipse at 100% 100%, rgba(91, 226, 231, 0.18), transparent 42%), radial-gradient(ellipse at 0% 0%, rgba(128, 195, 255, 0.16), transparent 44%), linear-gradient(135deg, rgba(239, 249, 255, 0.92), rgba(239, 242, 255, 0.86) 54%, rgba(233, 250, 251, 0.92))',
  },
  typography: {
    fontDisplay: 'Plus Jakarta Sans, sans-serif',
    fontBody: 'Inter, sans-serif',
    sizes: {
      headlineXl: '32px',
      headlineLg: '24px',
      headlineMd: '20px',
      headlineSm: '16px',
      titleMd: '18px',
      bodyLg: '16px',
      bodyMd: '14px',
      bodySm: '12px',
      labelLg: '14px',
      labelMd: '12px',
      labelSm: '10px',
      currencyDisplay: '30px',
    },
    lineHeights: {
      headlineXl: '40px',
      headlineLg: '32px',
      headlineMd: '28px',
      headlineSm: '24px',
      titleMd: '24px',
      bodyLg: '24px',
      bodyMd: '20px',
      bodySm: '16px',
      labelLg: '20px',
      labelMd: '16px',
      labelSm: '14px',
      currencyDisplay: '36px',
    },
    weights: { regular: 400, medium: 500, semibold: 600, bold: 700, extraBold: 800 },
  },
  spacing: { xs: '0.25rem', sm: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.5rem', xxl: '2rem' },
  dimensions: {
    buttonHeightSmall: '2.25rem',
    buttonHeightMedium: '3rem',
    buttonHeightLarge: '3.5rem',
    buttonRadius: '1rem',
    buttonPaddingSmall: '0.75rem',
    buttonPaddingMedium: '1rem',
    buttonPaddingLarge: '1.25rem',
    inputHeight: '3rem',
    inputRadius: '0.75rem',
    cardRadius: '1rem',
    cardPadding: '1rem',
    tableHeaderHeight: '2.75rem',
    tableRowHeight: '2.75rem',
    tableCellPaddingX: '0.75rem',
    tableCellPaddingY: '0.5rem',
    pageMaxWidth: '90rem',
    pageGutterMobile: '1rem',
    pageGutterTablet: '1.5rem',
    pageGutterDesktop: '2rem',
    sectionGap: '1rem',
    cardGap: '1rem',
    iconSmall: '1rem',
    iconMedium: '1.5rem',
  },
  animation: { fastMs: 140, normalMs: 180, slowMs: 300 },
  zIndex: { navigation: 30, popover: 300, dialog: 200, prompt: 500, critical: 600, toast: 400 },
};

export const CRYSTAL_DARK: DesignTokens = {
  ...CRYSTAL_LIGHT,
  palette: {
    ...CRYSTAL_LIGHT.palette,
    primary: '112 213 230',
    primaryPressed: '142 225 238',
    primaryDark: '16 27 32',
    onPrimary: '0 54 64',
    primaryFixed: '23 62 70',
    primaryFixedDim: '42 89 97',
    secondary: '255 182 92',
    secondaryContainer: '85 51 0',
    accent: '56 189 248',
    accentContainer: '12 74 110',
    onAccent: '8 47 73',
    surface: '16 23 25',
    surfaceDim: '16 23 25',
    surfaceContainer: '23 33 36',
    surfaceContainerLow: '29 42 45',
    surfaceContainerHigh: '41 56 59',
    surfaceContainerHighest: '53 71 74',
    surfaceContainerLowest: '32 45 48',
    onSurface: '230 240 241',
    onSurfaceVariant: '180 195 197',
    outline: '137 153 155',
    outlineVariant: '58 75 78',
    success: '22 101 52',
    successDark: '6 95 70',
    successForeground: '74 222 128',
    successContainer: '18 56 45',
    onSuccess: '236 253 245',
    onSuccessContainer: '167 243 208',
    warning: '146 64 14',
    warningDark: '251 191 36',
    warningContainer: '59 46 16',
    onWarningContainer: '253 230 138',
    info: '56 189 248',
    infoDark: '14 165 233',
    infoContainer: '12 74 110',
    onInfoContainer: '224 242 254',
    error: '153 27 27',
    errorDark: '252 165 165',
    errorContainer: '63 30 34',
    onErrorContainer: '254 202 202',
  },
};

export const themeRegistry = new Map<ThemeId, ThemeRegistration>([
  ['hanouti-crystal-glass', {
    id: 'hanouti-crystal-glass',
    name: 'Hanouti Crystal Glass',
    light: CRYSTAL_LIGHT,
    dark: CRYSTAL_DARK,
  }],
]);

export const DEFAULT_STORE_APPEARANCE: StoreAppearance = {
  themeId: 'hanouti-crystal-glass',
  mode: 'system',
  light: CRYSTAL_LIGHT,
  dark: CRYSTAL_DARK,
  largeButtons: false,
  compactDensity: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRgb(value: unknown): value is RGB {
  if (typeof value !== 'string' || !/^\d{1,3} \d{1,3} \d{1,3}$/.test(value)) return false;
  return value.split(' ').every((channel) => Number(channel) <= 255);
}

function isCssLength(value: unknown): value is string {
  return typeof value === 'string'
    && /^(?:0|(?:\d+|\d*\.\d+)(?:px|rem|em|%|vw|vh|dvh|svh))$/.test(value.trim());
}

function isSafeCssValue(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 240
    && /^[a-z\d.,%() #/-]+$/i.test(value)
    && !/(?:url|var|expression)\s*\(/i.test(value);
}

function isSafeGradient(value: unknown): value is string {
  return value === 'none'
    || (isSafeCssValue(value)
      && /^(?:(?:radial|linear)-gradient\([a-z\d.,% #()/-]+\)\s*,?\s*)+$/i.test(value));
}

function mergeLengths<T extends Record<string, string>>(fallback: T, value: unknown): T {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(Object.entries(fallback).map(([key, defaultValue]) => [
    key,
    isCssLength(source[key]) ? source[key] : defaultValue,
  ])) as T;
}

function mergeNumbers<T extends Record<string, number>>(
  fallback: T,
  value: unknown,
  min: number,
  max: number,
  integer = false,
): T {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(Object.entries(fallback).map(([key, defaultValue]) => {
    const candidate = source[key];
    return [key, typeof candidate === 'number' && Number.isFinite(candidate)
      && candidate >= min && candidate <= max && (!integer || Number.isInteger(candidate))
      ? candidate
      : defaultValue];
  })) as T;
}

function resolveDesignTokens(value: unknown, fallback: DesignTokens): DesignTokens {
  const source = isRecord(value) ? value : {};
  const paletteSource = isRecord(source.palette) ? source.palette : {};
  const palette = Object.fromEntries(Object.entries(fallback.palette).map(([key, defaultValue]) => [
    key,
    isRgb(paletteSource[key]) ? paletteSource[key] : defaultValue,
  ])) as DesignTokens['palette'];
  const glassSource = isRecord(source.glass) ? source.glass : {};
  const shadowSource = isRecord(source.shadows) ? source.shadows : {};
  const gradientSource = isRecord(source.gradients) ? source.gradients : {};
  const typographySource = isRecord(source.typography) ? source.typography : {};
  const typographySizes = isRecord(typographySource.sizes) ? typographySource.sizes : {};
  const typographyLineHeights = isRecord(typographySource.lineHeights) ? typographySource.lineHeights : {};
  const typographyWeights = isRecord(typographySource.weights) ? typographySource.weights : {};
  const dimensionsSource = isRecord(source.dimensions) ? source.dimensions : {};
  const spacingSource = isRecord(source.spacing) ? source.spacing : {};
  const animationSource = isRecord(source.animation) ? source.animation : {};
  const zIndexSource = isRecord(source.zIndex) ? source.zIndex : {};

  const numeric = (input: unknown, fallbackValue: number, min: number, max: number) =>
    typeof input === 'number' && Number.isFinite(input) && input >= min && input <= max ? input : fallbackValue;
  const font = (input: unknown, fallbackValue: string) =>
    isSafeCssValue(input) ? input : fallbackValue;

  return {
    palette,
    glass: {
      surfaceAlpha: numeric(glassSource.surfaceAlpha, fallback.glass.surfaceAlpha, 0, 1),
      highSurfaceAlpha: numeric(glassSource.highSurfaceAlpha, fallback.glass.highSurfaceAlpha, 0, 1),
      blurPx: numeric(glassSource.blurPx, fallback.glass.blurPx, 0, 64),
      saturation: numeric(glassSource.saturation, fallback.glass.saturation, 0, 3),
    },
    radius: mergeLengths(fallback.radius, source.radius),
    shadows: Object.fromEntries(Object.entries(fallback.shadows).map(([key, defaultValue]) => [
      key,
      isSafeCssValue(shadowSource[key]) ? shadowSource[key] : defaultValue,
    ])) as DesignTokens['shadows'],
    gradients: {
      page: isSafeGradient(gradientSource.page) ? gradientSource.page : fallback.gradients.page,
    },
    typography: {
      fontDisplay: font(typographySource.fontDisplay, fallback.typography.fontDisplay),
      fontBody: font(typographySource.fontBody, fallback.typography.fontBody),
      sizes: mergeLengths(fallback.typography.sizes, typographySizes),
      lineHeights: mergeLengths(fallback.typography.lineHeights, typographyLineHeights),
      weights: mergeNumbers(fallback.typography.weights, typographyWeights, 100, 900, true),
    },
    spacing: mergeLengths(fallback.spacing, spacingSource),
    dimensions: mergeLengths(fallback.dimensions, dimensionsSource),
    animation: mergeNumbers(fallback.animation, animationSource, 0, 2_000),
    zIndex: mergeNumbers(fallback.zIndex, zIndexSource, 0, 9_999, true),
  };
}

export function resolveStoreAppearance(value: unknown): StoreAppearance {
  const source = isRecord(value) ? value : {};
  const mode = source.mode === 'light' || source.mode === 'dark' || source.mode === 'system'
    ? source.mode
    : DEFAULT_STORE_APPEARANCE.mode;
  return {
    themeId: 'hanouti-crystal-glass',
    mode,
    light: resolveDesignTokens(source.light, CRYSTAL_LIGHT),
    dark: resolveDesignTokens(source.dark, CRYSTAL_DARK),
    largeButtons: typeof source.largeButtons === 'boolean' ? source.largeButtons : DEFAULT_STORE_APPEARANCE.largeButtons,
    compactDensity: typeof source.compactDensity === 'boolean' ? source.compactDensity : DEFAULT_STORE_APPEARANCE.compactDensity,
  };
}

function mergeDesignTokens(base: DesignTokens, value: unknown): DesignTokens {
  const source = isRecord(value) ? value : {};
  const mergeSection = (key: string, baseSection: object) => ({
    ...baseSection,
    ...(isRecord(source[key]) ? source[key] : {}),
  });
  const baseTypography = base.typography;
  const sourceTypography = isRecord(source.typography) ? source.typography : {};
  return resolveDesignTokens({
    ...base,
    ...source,
    palette: mergeSection('palette', base.palette),
    glass: mergeSection('glass', base.glass),
    radius: mergeSection('radius', base.radius),
    shadows: mergeSection('shadows', base.shadows),
    gradients: mergeSection('gradients', base.gradients),
    spacing: mergeSection('spacing', base.spacing),
    dimensions: mergeSection('dimensions', base.dimensions),
    animation: mergeSection('animation', base.animation),
    zIndex: mergeSection('zIndex', base.zIndex),
    typography: {
      ...baseTypography,
      ...sourceTypography,
      sizes: {
        ...baseTypography.sizes,
        ...(isRecord(sourceTypography.sizes) ? sourceTypography.sizes : {}),
      },
      lineHeights: {
        ...baseTypography.lineHeights,
        ...(isRecord(sourceTypography.lineHeights) ? sourceTypography.lineHeights : {}),
      },
      weights: {
        ...baseTypography.weights,
        ...(isRecord(sourceTypography.weights) ? sourceTypography.weights : {}),
      },
    },
  }, base);
}

export function mergeStoreAppearance(current: unknown, changes: unknown): StoreAppearance {
  const base = resolveStoreAppearance(current);
  const source = isRecord(changes) ? changes : {};
  return resolveStoreAppearance({
    ...base,
    ...source,
    themeId: 'hanouti-crystal-glass',
    light: mergeDesignTokens(base.light, source.light),
    dark: mergeDesignTokens(base.dark, source.dark),
  });
}

export function getTheme(themeId: ThemeId): ThemeRegistration {
  const theme = themeRegistry.get(themeId);
  if (!theme) throw new Error(`Unknown Hanouti theme: ${themeId}`);
  return theme;
}

export function getRegisteredThemeIds(): ThemeId[] {
  return Array.from(themeRegistry.keys());
}

export function hexToRgbTriplet(hex: string): RGB | null {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
  const value = Number.parseInt(normalized, 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}
