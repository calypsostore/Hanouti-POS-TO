import { getLanguage as getCurrentLanguage, setLanguage as setCurrentLanguage, type LanguageCode } from '../i18n';

export type AppLanguage = LanguageCode;

export const settingsService = {
  async getLanguage(): Promise<AppLanguage> {
    return getCurrentLanguage();
  },

  async setLanguage(language: AppLanguage): Promise<void> {
    setCurrentLanguage(language);
  },
};
