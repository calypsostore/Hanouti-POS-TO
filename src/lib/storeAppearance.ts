import { useSyncExternalStore } from 'react';
import { DEFAULT_STORE_APPEARANCE, resolveStoreAppearance, type StoreAppearance } from '../theme/themeRegistry';
import type { DesignTokens } from '../theme/designTokens';

const listeners = new Set<() => void>();
let currentAppearance = resolveStoreAppearance(DEFAULT_STORE_APPEARANCE);
let initialized = false;
let colorSchemeQuery: MediaQueryList | undefined;

function toCssName(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function setDesignTokens(tokens: DesignTokens, root: HTMLElement): void {
  Object.entries(tokens.palette).forEach(([name, value]) => {
    root.style.setProperty(`--color-${toCssName(name)}`, value);
  });
  root.style.setProperty('--glass-surface-alpha', String(tokens.glass.surfaceAlpha));
  root.style.setProperty('--glass-high-surface-alpha', String(tokens.glass.highSurfaceAlpha));
  root.style.setProperty('--glass-blur', `${tokens.glass.blurPx}px`);
  root.style.setProperty('--glass-saturation', String(tokens.glass.saturation));

  Object.entries(tokens.radius).forEach(([name, value]) => {
    root.style.setProperty(`--radius-${toCssName(name)}`, value);
  });
  Object.entries(tokens.shadows).forEach(([name, value]) => {
    root.style.setProperty(`--shadow-${toCssName(name)}`, value);
  });
  root.style.setProperty('--page-gradient', tokens.gradients.page);
  root.style.setProperty('--font-display', tokens.typography.fontDisplay);
  root.style.setProperty('--font-body', tokens.typography.fontBody);

  Object.entries(tokens.typography.sizes).forEach(([name, value]) => {
    root.style.setProperty(`--font-size-${toCssName(name)}`, value);
  });
  Object.entries(tokens.typography.lineHeights).forEach(([name, value]) => {
    root.style.setProperty(`--line-height-${toCssName(name)}`, value);
  });
  Object.entries(tokens.typography.weights).forEach(([name, value]) => {
    root.style.setProperty(`--font-weight-${toCssName(name)}`, String(value));
  });
  Object.entries(tokens.spacing).forEach(([name, value]) => {
    root.style.setProperty(`--space-${toCssName(name)}`, value);
  });
  Object.entries(tokens.dimensions).forEach(([name, value]) => {
    root.style.setProperty(`--${toCssName(name)}`, value);
  });
  root.style.setProperty('--button-height', tokens.dimensions.buttonHeightMedium);
  root.style.setProperty('--input-height', tokens.dimensions.inputHeight);
  root.style.setProperty('--motion-fast-ms', String(tokens.animation.fastMs));
  root.style.setProperty('--motion-normal-ms', String(tokens.animation.normalMs));
  root.style.setProperty('--motion-slow-ms', String(tokens.animation.slowMs));
  Object.entries(tokens.zIndex).forEach(([name, value]) => {
    root.style.setProperty(`--z-${toCssName(name)}`, String(value));
  });
}

function isDarkMode(appearance: StoreAppearance): boolean {
  return appearance.mode === 'dark'
    || (appearance.mode === 'system' && colorSchemeQuery?.matches === true);
}

function applyAppearance(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const dark = isDarkMode(currentAppearance);
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
  root.classList.toggle('compact-density', currentAppearance.compactDensity);
  root.classList.toggle('large-buttons', currentAppearance.largeButtons);
  root.classList.add('theme-hanouti-crystal-glass');
  setDesignTokens(dark ? currentAppearance.dark : currentAppearance.light, root);

  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const surface = (dark ? currentAppearance.dark : currentAppearance.light).palette.surface;
  if (themeColor) {
    const [red, green, blue] = surface.split(' ').map(Number);
    themeColor.content = `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
  }
}

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export function initializeThemeSystem(): void {
  if (initialized) return;
  initialized = true;
  if (typeof window !== 'undefined') {
    colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    colorSchemeQuery.addEventListener('change', () => {
      if (currentAppearance.mode === 'system') applyAppearance();
    });
  }
  applyAppearance();
}

export function applyStoreAppearance(value: unknown): StoreAppearance {
  currentAppearance = resolveStoreAppearance(value);
  applyAppearance();
  notifyListeners();
  return currentAppearance;
}

export function resetStoreAppearance(): void {
  applyStoreAppearance(DEFAULT_STORE_APPEARANCE);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useStoreAppearance(): StoreAppearance {
  return useSyncExternalStore(subscribe, () => currentAppearance, () => DEFAULT_STORE_APPEARANCE);
}
