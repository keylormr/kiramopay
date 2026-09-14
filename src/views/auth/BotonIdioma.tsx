import React, { useState } from 'react';
import { Icons } from '@/components/Icons';
import { LanguageSheet } from '@/components/LanguageSheet';
import { useLanguage } from '@/i18n/LanguageContext';

interface BotonIdiomaProps {
  /** Muestra el nombre del idioma junto al globo (hay espacio en el login). */
  conNombre?: boolean;
  className?: string;
}

/**
 * Selector de idioma para las pantallas previas a entrar (login y registro),
 * sobre fondo oscuro. Abre la misma hoja que la barra superior de la app.
 *
 * El idioma se detecta del navegador y hasta ahora solo se podia corregir ya
 * adentro: alguien con el telefono en otro idioma tenia que registrarse sin
 * entender la pantalla. El nombre va en su propio idioma ("Español",
 * "日本語"): es lo que reconoce quien no lee el idioma actual.
 */
export const BotonIdioma: React.FC<BotonIdiomaProps> = ({ conNombre = false, className = '' }) => {
  const { t, currentLanguage } = useLanguage();
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label={`${t('language')}: ${currentLanguage.nativeName}`}
        aria-haspopup="dialog"
        className={`inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-full px-3 text-[var(--color-text-secondary-dark)] transition-colors hover:bg-white/10 hover:text-white uv-focus-ring ${className}`}
      >
        <Icons.Globe size={20} aria-hidden="true" />
        {conNombre && <span className="text-sm font-semibold">{currentLanguage.nativeName}</span>}
      </button>
      <LanguageSheet isOpen={abierto} onClose={() => setAbierto(false)} />
    </>
  );
};
