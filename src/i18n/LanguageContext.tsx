import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  Language,
  LANGUAGES,
  LanguageOption,
  TranslationKeys,
  defaultTranslations,
  diccionarioCargado,
  loadLanguage,
} from './translations';
import { fijarDiccionarioActivo } from './mensajesDeError';
import {
  eleccionGuardada,
  guardarEleccion,
  idiomaInicial,
  recordarIdiomaDeLaCuenta,
} from './idiomaDeLaPersona';

interface LanguageContextType {
  language: Language;
  /**
   * Si la persona eligio el idioma (en este dispositivo, ahora o antes) o si
   * solo lo adivino el navegador. Un idioma adivinado no pisa el que la cuenta
   * ya tiene en el servidor (ver useIdiomaEnElServidor).
   */
  elegido: boolean;
  setLanguage: (lang: Language) => void;
  /**
   * La cuenta dice en que idioma usa la app la persona. Si no eligio ninguno en
   * este dispositivo, la pantalla pasa a ese (era el que adivino el navegador);
   * en cualquier caso el dispositivo lo recuerda para la pantalla de arranque
   * del proximo inicio, que corre antes de saber quien entra. Una eleccion de la
   * persona nunca se pisa.
   */
  adoptarIdiomaDeLaCuenta: (lang: Language) => void;
  t: (key: string) => string;
  languages: LanguageOption[];
  currentLanguage: LanguageOption;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>(idiomaInicial);
  const [elegido, setElegido] = useState<boolean>(() => eleccionGuardada() !== null);
  // Spanish is bundled (defaultTranslations); the other languages ship as their
  // own chunks and load on demand (index.tsx pide el del idioma de la persona
  // antes de pintar, asi que normalmente ya esta en el primer render). Until a
  // non-default chunk arrives, t() falls back to Spanish, then to the raw key.
  const [messages, setMessages] = useState<TranslationKeys>(
    () => diccionarioCargado(language) ?? defaultTranslations,
  );

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

  // Los mensajes de error que arma el cliente HTTP (fuera de React) salen del
  // mismo diccionario que la pantalla.
  useEffect(() => {
    fijarDiccionarioActivo(messages);
  }, [messages]);

  // Keep the document's lang attribute in sync so screen readers, hyphenation
  // and browser translation match the UI language (it otherwise stays "en").
  useEffect(() => {
    document.documentElement.lang = language === 'zh-cn' ? 'zh-CN' : language;
  }, [language]);

  // Si el diccionario del idioma nuevo ya llego, entra en el mismo render que el
  // idioma: sin eso, la pantalla pasaba un instante por el idioma anterior.
  const cambiarA = useCallback((lang: Language) => {
    setLanguageState(lang);
    const ya = diccionarioCargado(lang);
    if (ya) setMessages(ya);
  }, []);

  const setLanguage = (lang: Language) => {
    cambiarA(lang);
    setElegido(true);
    guardarEleccion(lang);
  };

  const adoptarIdiomaDeLaCuenta = useCallback(
    (lang: Language) => {
      recordarIdiomaDeLaCuenta(lang);
      if (eleccionGuardada() === null) cambiarA(lang);
    },
    [cambiarA],
  );

  const t = (key: string): string => {
    const active = messages as Record<string, string>;
    const fallback = defaultTranslations as Record<string, string>;
    return active[key] ?? fallback[key] ?? key;
  };

  const currentLanguage = LANGUAGES.find((l) => l.code === language) || LANGUAGES[0];

  return (
    <LanguageContext.Provider value={{
      language,
      elegido,
      setLanguage,
      adoptarIdiomaDeLaCuenta,
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
