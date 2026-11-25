import { ar } from './locales/ar';
import { en } from './locales/en';
import { fr } from './locales/fr';
import { DEFAULT_LANGUAGE, getLanguageDirection, LANGUAGE_STORAGE_KEY, normalizeLanguage, type LanguageCode } from './languageConfig';
import type { TranslationDictionary, TranslationKey, TranslationValues } from './types';

export type { LanguageCode } from './languageConfig';
export type { TranslationDictionary, TranslationKey, TranslationValues } from './types';

const catalogs: Readonly<Record<LanguageCode, TranslationDictionary>> = { en, fr, ar };
const listeners = new Set<() => void>();

function readSavedLanguage(): LanguageCode {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  try {
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

let activeLanguage = readSavedLanguage();

function updateDocumentLanguage(language: LanguageCode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language;
  document.documentElement.dir = getLanguageDirection(language);
}

updateDocumentLanguage(activeLanguage);

export function getLanguage(): LanguageCode {
  return activeLanguage;
}

export function subscribeToLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLanguage(value: unknown): LanguageCode {
  const nextLanguage = normalizeLanguage(value);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
  }
  if (activeLanguage === nextLanguage) {
    updateDocumentLanguage(nextLanguage);
    return nextLanguage;
  }
  activeLanguage = nextLanguage;
  updateDocumentLanguage(nextLanguage);
  listeners.forEach((listener) => listener());
  return nextLanguage;
}

export function t(key: TranslationKey, values: TranslationValues = {}): string {
  const template = catalogs[activeLanguage][key] ?? en[key] ?? String(key);
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
}

export const translations = catalogs;
