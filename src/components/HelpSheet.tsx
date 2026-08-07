import React, { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { Icons } from './Icons';
import { useLanguage } from '@/i18n/LanguageContext';

/**
 * Ayuda contextual: un botón "?" junto a una función difícil de entender, que
 * abre una hoja explicándola.
 *
 * Se apoya en claves i18n con la convención `help_<tema>_title` / `help_<tema>_body`,
 * así que el texto sale siempre en el idioma del usuario. Eso es deliberado: la
 * alternativa —capturas de pantalla— quedaría en un solo idioma y envejecería con
 * cada cambio de interfaz, justo lo que esta app no puede permitirse teniendo
 * siete idiomas y una UI que se mueve.
 */
interface HelpButtonProps {
  /** Tema de ayuda: se traduce a las claves help_<topic>_title / _body. */
  topic: string;
  /** Etiqueta accesible; por defecto, "¿Qué es esto?" traducido. */
  label?: string;
  className?: string;
}

export const HelpButton: React.FC<HelpButtonProps> = ({ topic, label, className = '' }) => {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  const titleKey = `help_${topic}_title`;
  const bodyKey = `help_${topic}_body`;
  const accessibleLabel = label || t('help_what_is_this');

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // La ayuda suele vivir dentro de filas o tarjetas que ya son
          // pulsables; sin esto, pedir ayuda dispararía también la acción de
          // la fila.
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={accessibleLabel}
        className={`shrink-0 p-1.5 -m-1.5 rounded-full text-[var(--color-text-muted)] dark:text-[var(--color-text-muted-dark)] hover:text-[var(--color-primary)] hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors ${className}`}
      >
        <Icons.HelpCircle size={16} />
      </button>

      <BottomSheet isOpen={open} onClose={() => setOpen(false)} title={t(titleKey)}>
        <p className="text-[15px] leading-relaxed uv-text-secondary whitespace-pre-line">
          {t(bodyKey)}
        </p>
      </BottomSheet>
    </>
  );
};
