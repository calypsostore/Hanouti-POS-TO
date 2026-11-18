export type AppLanguage = 'en';

const LANGUAGE_KEY = '7anouti-pos:language';

export const settingsService = {
  getLanguage(): AppLanguage {
    const savedLanguage = localStorage.getItem(LANGUAGE_KEY);
    return savedLanguage === 'en' ? savedLanguage : 'en';
  },

  setLanguage(language: AppLanguage): void {
    localStorage.setItem(LANGUAGE_KEY, language);
    document.documentElement.lang = language;
    document.documentElement.dir = 'ltr';
  },
};
