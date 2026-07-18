import { LANGUAGES, type Language } from '../translations';
import es from '../languages/es';
import en from '../languages/en';
import fr from '../languages/fr';
import pt from '../languages/pt';
import zhCn from '../languages/zh-cn';
import ja from '../languages/ja';
import hi from '../languages/hi';

// The languages are now split into lazily-loaded chunks; import them directly
// here so the cross-language key-consistency checks still cover all of them.
const translations: Record<Language, Record<string, string>> = {
  es,
  en,
  fr,
  pt,
  'zh-cn': zhCn,
  ja,
  hi,
};

describe('Translations', () => {
  const languages = LANGUAGES.map((l) => l.code);

  it('should have all 7 language codes defined', () => {
    expect(languages).toEqual(['es', 'en', 'fr', 'pt', 'zh-cn', 'ja', 'hi']);
  });

  it('should have translations for all 7 languages', () => {
    for (const lang of languages) {
      expect(translations[lang]).toBeDefined();
    }
  });

  it('should have the same keys across all languages', () => {
    const esKeys = Object.keys(translations['es']).sort();

    for (const lang of languages) {
      const langKeys = Object.keys(translations[lang as Language]).sort();
      expect(langKeys).toEqual(esKeys);
    }
  });

  it('should not have empty string values', () => {
    for (const lang of languages) {
      const entries = Object.entries(translations[lang as Language]);
      for (const [key, value] of entries) {
        expect(value, `${lang}.${key} should not be empty`).not.toBe('');
      }
    }
  });

  it('should have app_name as KiramoPay in all languages', () => {
    for (const lang of languages) {
      expect(translations[lang as Language].app_name).toBe('KiramoPay');
    }
  });
});
