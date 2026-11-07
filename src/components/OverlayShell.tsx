import React from 'react';
import { Icons } from './Icons';
import { useLanguage } from '../i18n/LanguageContext';

interface OverlayShellProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * Elemento opcional al final de la cabecera, pensado para el boton de ayuda:
   * la ayuda de una pantalla tiene que estar EN la pantalla, no solo en el
   * mosaico de Inicio que lleva a ella.
   */
  accessory?: React.ReactNode;
  /**
   * Ancho de la columna en pantalla ancha (la regla de .kp-capa usa 42rem). Una
   * vista con rejilla, como el Mercado, la abre para usar dos o tres columnas.
   */
  columna?: string;
}

// Full-screen overlay wrapper with a sticky back-header, used to host views that
// render their own body but no chrome (e.g. Marketplace). Mirrors the header of
// the other overlay views (SavingsView, EscrowView, …) for a consistent feel.
export const OverlayShell: React.FC<OverlayShellProps> = ({ title, onClose, children, accessory, columna }) => {
  const { t } = useLanguage();
  return (
    <div
      className="fixed inset-0 kp-capa z-50 flex flex-col bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] animate-fade-in"
      style={columna ? ({ '--kp-columna': columna } as React.CSSProperties) : undefined}
    >
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-[var(--color-background-dark)]/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 min-h-14 pt-safe flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onClose}
          aria-label={t('back')}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors uv-text-secondary"
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <span className="font-bold text-lg tracking-tight uv-text-primary">{title}</span>
        {accessory && <div className="ml-auto flex items-center pr-1">{accessory}</div>}
      </div>
      {/* Lo que se desplaza ocupa todo el ancho, como en las demas capas: la
          barra queda en el borde de la ventana y la rueda funciona tambien en
          los costados. La columna la pone la regla de .kp-capa (index.css);
          con max-w-2xl aqui, la barra de desplazamiento quedaba en medio de
          la pantalla. */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
};
