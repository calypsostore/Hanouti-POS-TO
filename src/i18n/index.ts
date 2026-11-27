import { ar } from './locales/ar';
import { en } from './locales/en';
import { fr } from './locales/fr';
import { DEFAULT_LANGUAGE, DEVICE_LOGIN_LANGUAGE_STORAGE_KEY, getLanguageDirection, normalizeLanguage, type LanguageCode } from './languageConfig';
import type { TranslationDictionary, TranslationKey, TranslationValues } from './types';

export type { LanguageCode } from './languageConfig';
export type { TranslationDictionary, TranslationKey, TranslationValues } from './types';

const PROFILE_LANGUAGE_STORAGE_PREFIX = '7anouti-pos:profile-language:';
const catalogs: Readonly<Record<LanguageCode, TranslationDictionary>> = { en, fr, ar };
const listeners = new Set<() => void>();

function readSavedLanguage(): LanguageCode {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  try {
    return normalizeLanguage(window.localStorage.getItem(DEVICE_LOGIN_LANGUAGE_STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

let activeLanguage = readSavedLanguage();

function activateLanguage(language: LanguageCode): LanguageCode {
  if (activeLanguage === language) {
    updateDocumentLanguage(language);
    return language;
  }
  activeLanguage = language;
  updateDocumentLanguage(language);
  listeners.forEach((listener) => listener());
  return language;
}

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

export function setDeviceLoginLanguage(value: unknown): LanguageCode {
  const nextLanguage = normalizeLanguage(value);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(DEVICE_LOGIN_LANGUAGE_STORAGE_KEY, nextLanguage);
  }
  return activateLanguage(nextLanguage);
}

export function activateProfileLanguage(profileId: string): LanguageCode {
  let language: LanguageCode = DEFAULT_LANGUAGE;
  if (profileId && typeof window !== 'undefined') {
    try {
      language = normalizeLanguage(window.localStorage.getItem(`${PROFILE_LANGUAGE_STORAGE_PREFIX}${profileId}`));
    } catch {
      language = DEFAULT_LANGUAGE;
    }
  }
  return activateLanguage(language);
}

export function setProfileLanguage(profileId: string, value: unknown): LanguageCode {
  if (!profileId) throw new Error('A signed-in profile is required to save its language preference.');
  const nextLanguage = normalizeLanguage(value);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(`${PROFILE_LANGUAGE_STORAGE_PREFIX}${profileId}`, nextLanguage);
  }
  return activateLanguage(nextLanguage);
}

export function activateDeviceLoginLanguage(): LanguageCode {
  return activateLanguage(readSavedLanguage());
}

export function t(key: TranslationKey, values: TranslationValues = {}): string {
  const template = catalogs[activeLanguage][key] ?? en[key] ?? String(key);
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
}

export function localizeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message.trim()) return fallback;
  if (activeLanguage === 'en' || !/[A-Za-z]/.test(error.message)) return error.message;
  return fallback;
}

export const translations = catalogs;
