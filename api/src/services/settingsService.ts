export type AppLanguage = 'en' | 'ar';

const LANGUAGE_KEY = '7anouti-pos:language';

export const settingsService = {
  async getLanguage(): Promise<AppLanguage> {
    const savedLanguage = localStorage.getItem(LANGUAGE_KEY);
    const language = savedLanguage === 'ar' ? 'ar' : 'en';
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    return language;
  },

  async setLanguage(language: AppLanguage): Promise<void> {
    localStorage.setItem(LANGUAGE_KEY, language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  },
};
