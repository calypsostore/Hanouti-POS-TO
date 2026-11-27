import {
  getLanguage as getCurrentLanguage,
  setDeviceLoginLanguage as saveDeviceLoginLanguage,
  setProfileLanguage as saveProfileLanguage,
  type LanguageCode,
} from '../i18n';

export type AppLanguage = LanguageCode;

export const settingsService = {
  async getLanguage(): Promise<AppLanguage> {
    return getCurrentLanguage();
  },

  async setDeviceLoginLanguage(language: AppLanguage): Promise<void> {
    saveDeviceLoginLanguage(language);
  },

  async setProfileLanguage(profileId: string, language: AppLanguage): Promise<void> {
    saveProfileLanguage(profileId, language);
  },
};
