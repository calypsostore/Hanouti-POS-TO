import type { en } from './locales/en';
import type { LanguageCode } from './languageConfig';

export type { LanguageCode };
export type TranslationKey = keyof typeof en;
export type TranslationDictionary = Readonly<Record<TranslationKey, string>>;
export type TranslationValues = Record<string, string | number>;
