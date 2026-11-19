import { useSyncExternalStore } from 'react';

export type DisplayTheme = 'light' | 'dark' | 'system';

export interface DisplaySettings {
  theme: DisplayTheme;
  largeButtons: boolean;
  compactDensity: boolean;
}

const STORAGE_KEY = 'hanouti.display-settings.v1';
const DEFAULT_SETTINGS: DisplaySettings = { theme: 'system', largeButtons: false, compactDensity: false };
const listeners = new Set<() => void>();

function isTheme(value: unknown): value is DisplayTheme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function readStoredSettings(): DisplaySettings {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (typeof stored !== 'object' || stored === null) return DEFAULT_SETTINGS;
    const value = stored as Partial<DisplaySettings>;
    return {
      theme: isTheme(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
      largeButtons: typeof value.largeButtons === 'boolean' ? value.largeButtons : DEFAULT_SETTINGS.largeButtons,
      compactDensity: typeof value.compactDensity === 'boolean' ? value.compactDensity : DEFAULT_SETTINGS.compactDensity,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let currentSettings = readStoredSettings();
let initialized = false;

function applyDisplaySettings(settings: DisplaySettings) {
  const isDark = settings.theme === 'dark'
    || (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.toggle('dark', isDark);
  root.classList.toggle('light', !isDark);
  root.classList.toggle('compact-density', settings.compactDensity);
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) themeColor.content = isDark ? '#101719' : '#F4F8F9';
}

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function handleStorage(event: StorageEvent) {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  currentSettings = readStoredSettings();
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
    if (currentSettings.theme === 'system') applyDisplaySettings(currentSettings);
  });
}

export function updateDisplaySettings(changes: Partial<DisplaySettings>) {
  const nextSettings = { ...currentSettings, ...changes };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
  currentSettings = nextSettings;
  applyDisplaySettings(currentSettings);
  notifyListeners();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDisplaySettings() {
  return useSyncExternalStore(subscribe, () => currentSettings, () => DEFAULT_SETTINGS);
}
