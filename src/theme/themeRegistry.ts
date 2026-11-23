import type { DesignTokens, RGB } from './designTokens';

export type ThemeId = 'hanouti-crystal-glass' | (string & {});

export type ColorMode = 'light' | 'dark' | 'system';

export interface ThemeOverrides {
  primary?: string;
  accent?: string;
}

export interface ThemePreference {
  theme: ThemeId;
  mode: ColorMode;
  overrides: ThemeOverrides;
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
    successContainer: '209 250 229',
    onSuccess: '6 46 28',
    onSuccessContainer: '6 95 70',
    warning: '245 158 11',
    warningDark: '180 83 9',
    warningContainer: '254 243 199',
    onWarningContainer: '133 77 14',
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
  gradients: { page: 'radial-gradient(circle at top left, rgba(170, 237, 255, 0.32), transparent 28%)' },
  typography: { fontDisplay: 'Plus Jakarta Sans, sans-serif', fontBody: 'Inter, sans-serif' },
  spacing: { xs: '0.25rem', sm: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.5rem' },
  dimensions: { buttonHeight: '3rem', inputHeight: '3rem', iconSmall: '1rem', iconMedium: '1.5rem' },
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
    successContainer: '18 56 45',
    onSuccess: '236 253 245',
    onSuccessContainer: '167 243 208',
    warning: '146 64 14',
    warningDark: '251 191 36',
    warningContainer: '59 46 16',
    onWarningContainer: '253 230 138',
    error: '153 27 27',
    errorDark: '252 165 165',
    errorContainer: '63 30 34',
    onErrorContainer: '254 202 202',
  },
};

function blend(color: RGB, target: RGB, amount: number): RGB {
  const sourceChannels = color.split(' ').map(Number);
  const targetChannels = target.split(' ').map(Number);
  return sourceChannels
    .map((channel, index) => Math.round(channel + ((targetChannels[index] ?? channel) - channel) * amount))
    .join(' ') as RGB;
}

function luminance(color: RGB): number {
  const channels = color.split(' ').map((channel) => Number(channel) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function readableForeground(color: RGB): RGB {
  return luminance(color) > 0.179 ? '16 27 32' : '255 255 255';
}

function withBrandColors(tokens: DesignTokens, primaryHex: string, accentHex: string, dark: boolean): DesignTokens {
  const primary = hexToRgbTriplet(primaryHex);
  const accent = hexToRgbTriplet(accentHex);
  if (!primary || !accent) throw new Error('Registered theme colors must use six-digit hex values.');
  const adjustedPrimary = dark && luminance(primary) < 0.3 ? blend(primary, '255 255 255', 0.34) : primary;
  const palette = tokens.palette;
  return {
    ...tokens,
    palette: {
      ...palette,
      primary: adjustedPrimary,
      primaryPressed: blend(adjustedPrimary, dark ? '255 255 255' : '0 0 0', 0.16),
      onPrimary: readableForeground(adjustedPrimary),
      primaryFixed: blend(adjustedPrimary, dark ? '0 0 0' : '255 255 255', dark ? 0.64 : 0.82),
      primaryFixedDim: blend(adjustedPrimary, dark ? '0 0 0' : '255 255 255', dark ? 0.48 : 0.7),
      accent,
      accentContainer: blend(accent, dark ? '0 0 0' : '255 255 255', dark ? 0.7 : 0.86),
      onAccent: readableForeground(accent),
    },
  };
}

function createColorway(id: string, name: string, primary: string, accent: string): ThemeRegistration {
  return {
    id,
    name,
    light: withBrandColors(CRYSTAL_LIGHT, primary, accent, false),
    dark: withBrandColors(CRYSTAL_DARK, primary, accent, true),
  };
}

export const themeRegistry = new Map<ThemeId, ThemeRegistration>([
  ['hanouti-crystal-glass', {
    id: 'hanouti-crystal-glass',
    name: 'Hanouti Crystal Glass',
    light: CRYSTAL_LIGHT,
    dark: CRYSTAL_DARK,
  }],
  ['mediterranean-harbor', createColorway('mediterranean-harbor', 'Mediterranean Harbor', '#2563EB', '#38BDF8')],
  ['olive-market', createColorway('olive-market', 'Olive Market', '#5B6F28', '#84CC16')],
  ['terracotta-souk', createColorway('terracotta-souk', 'Terracotta Souk', '#C24132', '#F97316')],
]);

export function registerTheme(registration: ThemeRegistration): void {
  themeRegistry.set(registration.id, registration);
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
