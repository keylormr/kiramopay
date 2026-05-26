import React, { createContext, useContext, useState, ReactNode } from 'react';
import translations, { Language, LANGUAGES, LanguageOption } from './translations';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  languages: LanguageOption[];
  currentLanguage: LanguageOption;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

const STORAGE_KEY = 'kiramopay_language';

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(() => {
    // Try to load from localStorage
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some(l => l.code === saved)) {
      return saved as Language;
    }
    // Try to detect from browser
    const browserLang = navigator.language.toLowerCase();
    if (browserLang.startsWith('es')) return 'es';
    if (browserLang.startsWith('en')) return 'en';
    if (browserLang.startsWith('zh')) return 'zh-tw';
    if (browserLang.startsWith('ja')) return 'ja';
    if (browserLang.startsWith('hi')) return 'hi';
    return 'es'; // Default to Spanish
  });

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem(STORAGE_KEY, lang);
  };

  const t = (key: string): string => {
    const langTranslations = translations[language];
    return (langTranslations as Record<string, string>)[key] || key;
  };

  const currentLanguage = LANGUAGES.find(l => l.code === language) || LANGUAGES[0];

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
