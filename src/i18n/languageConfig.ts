export const DEFAULT_LANGUAGE = 'en' as const;
export const DEVICE_LOGIN_LANGUAGE_STORAGE_KEY = '7anouti-pos:language';

export const LANGUAGE_OPTIONS = [
  { code: 'en', name: 'English', direction: 'ltr' },
  { code: 'fr', name: 'Français', direction: 'ltr' },
  { code: 'ar', name: 'العربية', direction: 'rtl' },
] as const;

export type LanguageCode = (typeof LANGUAGE_OPTIONS)[number]['code'];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return LANGUAGE_OPTIONS.some((language) => language.code === value);
}

export function normalizeLanguage(value: unknown): LanguageCode {
  return isLanguageCode(value) ? value : DEFAULT_LANGUAGE;
}

export function getLanguageDirection(language: LanguageCode): 'ltr' | 'rtl' {
  return LANGUAGE_OPTIONS.find((option) => option.code === language)?.direction ?? 'ltr';
}
