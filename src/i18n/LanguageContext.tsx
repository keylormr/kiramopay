import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import {
  Language,
  LANGUAGES,
  LanguageOption,
  TranslationKeys,
  defaultTranslations,
  loadLanguage,
} from './translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  languages: LanguageOption[];
  currentLanguage: LanguageOption;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'kiramopay_language';

function detectInitialLanguage(): Language {
  const saved = localStorage.getItem(STORAGE_KEY);
  // Migrate users who picked the now-removed Traditional Chinese to Simplified.
  if (saved === 'zh-tw') return 'zh-cn';
  if (saved && LANGUAGES.some((l) => l.code === saved)) {
    return saved as Language;
  }
  const browserLang = navigator.language.toLowerCase();
  if (browserLang.startsWith('es')) return 'es';
  if (browserLang.startsWith('en')) return 'en';
  if (browserLang.startsWith('fr')) return 'fr';
  if (browserLang.startsWith('pt')) return 'pt';
  if (browserLang.startsWith('zh')) return 'zh-cn';
  if (browserLang.startsWith('ja')) return 'ja';
  if (browserLang.startsWith('hi')) return 'hi';
  return 'es'; // Default to Spanish
}

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(detectInitialLanguage);
  // Spanish is bundled (defaultTranslations); the other languages ship as their
  // own chunks and load on demand. Until a non-default chunk arrives, t() falls
  // back to Spanish, then to the raw key.
  const [messages, setMessages] = useState<TranslationKeys>(defaultTranslations);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const loaded = await loadLanguage(language);
      if (!cancelled) {
        setMessages(loaded);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [language]);

  // Keep the document's lang attribute in sync so screen readers, hyphenation
  // and browser translation match the UI language (it otherwise stays "en").
  useEffect(() => {
    document.documentElement.lang = language === 'zh-cn' ? 'zh-CN' : language;
  }, [language]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  };

  const t = (key: string): string => {
    const active = messages as Record<string, string>;
    const fallback = defaultTranslations as Record<string, string>;
    return active[key] ?? fallback[key] ?? key;
  };

  const currentLanguage = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  return (
    <LanguageContext.Provider value={{
      language,
      setLanguage,
      t,
      languages: LANGUAGES,
      currentLanguage,
    }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageContextType => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

export { LANGUAGES };
export type { Language };
