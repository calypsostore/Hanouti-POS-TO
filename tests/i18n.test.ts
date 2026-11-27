import { beforeEach, describe, expect, it, vi } from 'vitest';

const LANGUAGE_KEY = '7anouti-pos:language';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  vi.stubGlobal('window', { localStorage });
  vi.stubGlobal('document', { documentElement: { lang: 'en', dir: 'ltr' } });
  document.documentElement.lang = 'en';
  document.documentElement.dir = 'ltr';
});

describe('internationalization', () => {
  it('keeps all locale keys and interpolation placeholders aligned', async () => {
    const { translations } = await import('../src/i18n');
    const keys = Object.keys(translations.en).sort();

    expect(Object.keys(translations.fr).sort()).toEqual(keys);
    expect(Object.keys(translations.ar).sort()).toEqual(keys);

    for (const key of keys as Array<keyof typeof translations.en>) {
      const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
      expect(placeholders(translations.fr[key]), `French placeholders for ${key}`).toEqual(placeholders(translations.en[key]));
      expect(placeholders(translations.ar[key]), `Arabic placeholders for ${key}`).toEqual(placeholders(translations.en[key]));
    }
  }, 15_000);

  it('persists language switches and updates translations and document direction immediately', async () => {
    const { settingsService } = await import('../src/services/settingsService');
    const { getLanguage, localizeErrorMessage, subscribeToLanguage, t } = await import('../src/i18n');
    let notifications = 0;
    const unsubscribe = subscribeToLanguage(() => { notifications += 1; });

    await settingsService.setLanguage('fr');
    expect(getLanguage()).toBe('fr');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(document.documentElement.dir).toBe('ltr');
    expect(t('settings.title')).toBe('Paramètres');
    expect(localizeErrorMessage(new Error('Service error'), t('common.loadFailed'))).toBe(t('common.loadFailed'));

    await settingsService.setLanguage('ar');
    expect(getLanguage()).toBe('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(t('settings.title')).toBe('الإعدادات');
    expect(localizeErrorMessage(new Error('خطأ'), t('common.loadFailed'))).toBe('خطأ');
    expect(notifications).toBe(2);
    unsubscribe();
  });

  it('restores a saved language at startup and falls back safely for unsupported values and missing keys', async () => {
    localStorage.setItem(LANGUAGE_KEY, 'fr');
    vi.resetModules();
    const { getLanguage, t } = await import('../src/i18n');
    expect(getLanguage()).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(document.documentElement.dir).toBe('ltr');

    expect(t('unknown.translation.key' as keyof typeof import('../src/i18n/locales/en').en)).toBe('unknown.translation.key');

    localStorage.setItem(LANGUAGE_KEY, 'de');
    vi.resetModules();
    const fallbackI18n = await import('../src/i18n');
    expect(fallbackI18n.getLanguage()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
    expect(fallbackI18n.t('settings.title')).toBe('Settings');

    expect(fallbackI18n.setLanguage('unsupported')).toBe('en');
    expect(localStorage.getItem(LANGUAGE_KEY)).toBe('en');
  });
});
