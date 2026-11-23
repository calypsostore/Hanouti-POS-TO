import { useSyncExternalStore } from 'react';
import { getRegisteredThemeIds, getTheme, hexToRgbTriplet, type ColorMode, type ThemeId } from '../theme/themeRegistry';
import type { DesignTokens, ThemePalette } from '../theme/designTokens';

export type DisplayTheme = ColorMode;

export interface DisplaySettings {
  theme: DisplayTheme;
  largeButtons: boolean;
  compactDensity: boolean;
  paletteId: ThemeId;
  customPrimary?: string;
  customAccent?: string;
}

const STORAGE_KEY = 'hanouti.display-settings.v1';
const USER_STORAGE_PREFIX = 'hanouti.display-settings.user.v1:';
const DEFAULT_SETTINGS: DisplaySettings = {
  theme: 'system',
  largeButtons: false,
  compactDensity: false,
  paletteId: 'hanouti-crystal-glass',
};
const listeners = new Set<() => void>();

function isTheme(value: unknown): value is DisplayTheme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function isPalette(value: unknown): value is ThemeId {
  return typeof value === 'string' && getRegisteredThemeIds().includes(value);
}

function sanitizeSettings(value: Partial<DisplaySettings> | null): DisplaySettings {
  if (!value) return DEFAULT_SETTINGS;
  return {
    theme: isTheme(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    largeButtons: typeof value.largeButtons === 'boolean' ? value.largeButtons : DEFAULT_SETTINGS.largeButtons,
    compactDensity: typeof value.compactDensity === 'boolean' ? value.compactDensity : DEFAULT_SETTINGS.compactDensity,
    paletteId: isPalette(value.paletteId) ? value.paletteId : DEFAULT_SETTINGS.paletteId,
    customPrimary: typeof value.customPrimary === 'string' ? value.customPrimary : undefined,
    customAccent: typeof value.customAccent === 'string' ? value.customAccent : undefined,
  };
}

function readStoredSettings(storageKey = STORAGE_KEY): DisplaySettings {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? 'null');
    return sanitizeSettings(typeof stored === 'object' && stored !== null ? stored as Partial<DisplaySettings> : null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let currentSettings = readStoredSettings();
let initialized = false;
let activeUserStorageKey: string | null = null;
let previewSettings: DisplaySettings | null = null;

function setRgbVariable(root: HTMLElement, name: string, value: string) {
  root.style.setProperty(`--color-${name}`, value);
}

function blendRgb(color: string, target: string, amount: number): string {
  const channels = color.split(' ').map(Number);
  const targetChannels = target.split(' ').map(Number);
  return channels.map((channel, index) => Math.round(channel + ((targetChannels[index] ?? channel) - channel) * amount)).join(' ');
}

function colorLuminance(color: string): number {
  const channels = color.split(' ').map((channel) => Number(channel) / 255);
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function readableForeground(color: string): string {
  return colorLuminance(color) > 0.179 ? '16 27 32' : '255 255 255';
}

function applyDesignTokens(tokens: DesignTokens, root: HTMLElement) {
  const palette: ThemePalette = tokens.palette;
  setRgbVariable(root, 'primary', palette.primary);
  setRgbVariable(root, 'primary-pressed', palette.primaryPressed);
  setRgbVariable(root, 'primary-dark', palette.primaryDark);
  setRgbVariable(root, 'on-primary', palette.onPrimary);
  setRgbVariable(root, 'primary-fixed', palette.primaryFixed);
  setRgbVariable(root, 'primary-fixed-dim', palette.primaryFixedDim);
  setRgbVariable(root, 'secondary', palette.secondary);
  setRgbVariable(root, 'secondary-container', palette.secondaryContainer);
  setRgbVariable(root, 'accent', palette.accent);
  setRgbVariable(root, 'accent-container', palette.accentContainer);
  setRgbVariable(root, 'on-accent', palette.onAccent);
  setRgbVariable(root, 'surface', palette.surface);
  setRgbVariable(root, 'surface-dim', palette.surfaceDim);
  setRgbVariable(root, 'surface-container', palette.surfaceContainer);
  setRgbVariable(root, 'surface-container-low', palette.surfaceContainerLow);
  setRgbVariable(root, 'surface-container-high', palette.surfaceContainerHigh);
  setRgbVariable(root, 'surface-container-highest', palette.surfaceContainerHighest);
  setRgbVariable(root, 'surface-container-lowest', palette.surfaceContainerLowest);
  setRgbVariable(root, 'on-surface', palette.onSurface);
  setRgbVariable(root, 'on-surface-variant', palette.onSurfaceVariant);
  setRgbVariable(root, 'outline', palette.outline);
  setRgbVariable(root, 'outline-variant', palette.outlineVariant);
  setRgbVariable(root, 'success', palette.success);
  setRgbVariable(root, 'success-dark', palette.successDark);
  setRgbVariable(root, 'success-container', palette.successContainer);
  setRgbVariable(root, 'on-success', palette.onSuccess);
  setRgbVariable(root, 'on-success-container', palette.onSuccessContainer);
  setRgbVariable(root, 'warning', palette.warning);
  setRgbVariable(root, 'warning-dark', palette.warningDark);
  setRgbVariable(root, 'warning-container', palette.warningContainer);
  setRgbVariable(root, 'on-warning-container', palette.onWarningContainer);
  setRgbVariable(root, 'error', palette.error);
  setRgbVariable(root, 'error-dark', palette.errorDark);
  setRgbVariable(root, 'error-container', palette.errorContainer);
  setRgbVariable(root, 'on-error-container', palette.onErrorContainer);
  root.style.setProperty('--glass-surface-alpha', String(tokens.glass.surfaceAlpha));
  root.style.setProperty('--glass-high-surface-alpha', String(tokens.glass.highSurfaceAlpha));
  root.style.setProperty('--glass-blur', `${tokens.glass.blurPx}px`);
  root.style.setProperty('--glass-saturation', String(tokens.glass.saturation));
  root.style.setProperty('--radius-small', tokens.radius.small);
  root.style.setProperty('--radius-medium', tokens.radius.medium);
  root.style.setProperty('--radius-large', tokens.radius.large);
  root.style.setProperty('--radius-pill', tokens.radius.pill);
  root.style.setProperty('--shadow-card', tokens.shadows.card);
  root.style.setProperty('--shadow-sheet', tokens.shadows.sheet);
  root.style.setProperty('--shadow-overlay', tokens.shadows.overlay);
  root.style.setProperty('--page-gradient', tokens.gradients.page);
  root.style.setProperty('--font-display', tokens.typography.fontDisplay);
  root.style.setProperty('--font-body', tokens.typography.fontBody);
  root.style.setProperty('--motion-fast-ms', String(tokens.animation.fastMs));
  root.style.setProperty('--motion-normal-ms', String(tokens.animation.normalMs));
  root.style.setProperty('--motion-slow-ms', String(tokens.animation.slowMs));
  root.style.setProperty('--z-navigation', String(tokens.zIndex.navigation));
  root.style.setProperty('--z-popover', String(tokens.zIndex.popover));
  root.style.setProperty('--z-dialog', String(tokens.zIndex.dialog));
  root.style.setProperty('--z-prompt', String(tokens.zIndex.prompt));
  root.style.setProperty('--z-critical', String(tokens.zIndex.critical));
  root.style.setProperty('--z-toast', String(tokens.zIndex.toast));
}

function applyThemeOverrides(settings: DisplaySettings, isDark: boolean) {
  const root = document.documentElement;
  const theme = getTheme(settings.paletteId);
  applyDesignTokens(isDark ? theme.dark : theme.light, root);

  if (settings.customPrimary) {
    const primary = hexToRgbTriplet(settings.customPrimary);
    if (primary) {
      setRgbVariable(root, 'primary', primary);
      setRgbVariable(root, 'primary-pressed', blendRgb(primary, isDark ? '255 255 255' : '0 0 0', 0.16));
      setRgbVariable(root, 'on-primary', readableForeground(primary));
      setRgbVariable(root, 'primary-fixed', blendRgb(primary, isDark ? '0 0 0' : '255 255 255', isDark ? 0.64 : 0.82));
      setRgbVariable(root, 'primary-fixed-dim', blendRgb(primary, isDark ? '0 0 0' : '255 255 255', isDark ? 0.48 : 0.7));
    }
  }
  if (settings.customAccent) {
    const accent = hexToRgbTriplet(settings.customAccent);
    if (accent) {
      setRgbVariable(root, 'accent', accent);
      setRgbVariable(root, 'accent-container', blendRgb(accent, isDark ? '0 0 0' : '255 255 255', isDark ? 0.7 : 0.86));
      setRgbVariable(root, 'on-accent', readableForeground(accent));
    }
  }
}

function applyDisplaySettings(settings: DisplaySettings) {
  const isDark = settings.theme === 'dark'
    || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
  root.classList.toggle('light', !isDark);
  root.classList.toggle('compact-density', settings.compactDensity);
  applyThemeOverrides(settings, isDark);
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = isDark ? '#101719' : '#F4F8F9';
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function handleStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== activeUserStorageKey && event.key !== null) return;
  previewSettings = null;
  currentSettings = activeUserStorageKey
    ? readStoredSettings(activeUserStorageKey)
    : readStoredSettings(STORAGE_KEY);
  applyDisplaySettings(currentSettings);
  notifyListeners();
}

export function initializeDisplaySettings() {
  if (initialized) return;
  initialized = true;
  currentSettings = readStoredSettings();
  applyDisplaySettings(currentSettings);
  window.addEventListener('storage', handleStorage);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((previewSettings ?? currentSettings).theme === 'system') applyDisplaySettings(previewSettings ?? currentSettings);
  });
}

export function updateDisplaySettings(changes: Partial<DisplaySettings>) {
  const nextSettings = { ...currentSettings, ...changes };
  window.localStorage.setItem(activeUserStorageKey ?? STORAGE_KEY, JSON.stringify(nextSettings));
  currentSettings = nextSettings;
  previewSettings = null;
  applyDisplaySettings(currentSettings);
  notifyListeners();
}

export function activateDisplaySettingsForUser(userId: string) {
  const nextStorageKey = `${USER_STORAGE_PREFIX}${userId}`;
  activeUserStorageKey = nextStorageKey;
  previewSettings = null;
  const deviceSettings = readStoredSettings(STORAGE_KEY);
  const cached = window.localStorage.getItem(nextStorageKey);
  currentSettings = cached
    ? readStoredSettings(nextStorageKey)
    : sanitizeSettings({
        ...DEFAULT_SETTINGS,
        largeButtons: deviceSettings.largeButtons,
        compactDensity: deviceSettings.compactDensity,
      });
  applyDisplaySettings(currentSettings);
  notifyListeners();
}

export function clearDisplaySettingsForUser() {
  activeUserStorageKey = null;
  previewSettings = null;
  const deviceSettings = readStoredSettings(STORAGE_KEY);
  currentSettings = sanitizeSettings({
    ...deviceSettings,
    theme: 'system',
    paletteId: 'hanouti-crystal-glass',
    customPrimary: undefined,
    customAccent: undefined,
  });
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
  applyDisplaySettings(currentSettings);
  notifyListeners();
}

export function resetDisplaySettings() {
  const nextSettings = sanitizeSettings(DEFAULT_SETTINGS);
  window.localStorage.setItem(activeUserStorageKey ?? STORAGE_KEY, JSON.stringify(nextSettings));
  currentSettings = nextSettings;
  previewSettings = null;
  applyDisplaySettings(nextSettings);
  notifyListeners();
}

export function previewDisplaySettings(changes: Partial<DisplaySettings>) {
  previewSettings = sanitizeSettings({ ...currentSettings, ...changes });
  applyDisplaySettings(previewSettings);
}

export function discardDisplaySettingsPreview() {
  previewSettings = null;
  applyDisplaySettings(currentSettings);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDisplaySettings() {
  return useSyncExternalStore(subscribe, () => currentSettings, () => DEFAULT_SETTINGS);
}
