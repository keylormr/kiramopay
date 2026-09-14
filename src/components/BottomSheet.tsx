import React, { useEffect, useId, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { useLanguage } from '@/i18n/LanguageContext';
import { esHojaSuperior, useCapa } from '@/navegacion/pilaDeCapas';

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  /**
   * Elemento opcional que se dibuja pegado al titulo, antes del boton de
   * cerrar. Pensado para el boton de ayuda: la hoja no siempre renderiza su
   * propio encabezado, asi que sin esto no habria donde colgarlo. Si no se
   * pasa, la cabecera queda exactamente igual que antes.
   */
  titleAccessory?: React.ReactNode;
  /**
   * Cuando es false, ni el click en el fondo, ni Escape, ni el boton Atras del
   * navegador cierran la hoja: una operacion en vuelo (p.ej. una transferencia)
   * no debe perder su hoja por un toque accidental. Por defecto true.
   */
  dismissable?: boolean;
}

const ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function enfocablesDentro(contenedor: HTMLElement): HTMLElement[] {
  return Array.from(contenedor.querySelectorAll<HTMLElement>(ENFOCABLES)).filter((el) => {
    if (el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    // checkVisibility no existe en todos los motores (jsdom): ahi cuenta como visible.
    const conVisibilidad = el as HTMLElement & { checkVisibility?: () => boolean };
    return typeof conVisibilidad.checkVisibility === 'function' ? conVisibilidad.checkVisibility() : true;
  });
}

export const BottomSheet: React.FC<BottomSheetProps> = ({ isOpen, onClose, children, title, titleAccessory, dismissable = true }) => {
  const { t } = useLanguage();
  const idTitulo = useId();
  const hojaRef = useRef<HTMLDivElement>(null);
  const viewportHeight = CSS.supports?.('height', '100dvh') ? '100dvh' : '100vh';
  const [visible, setVisible] = useState(isOpen);

  if (isOpen && !visible) {
    setVisible(true);
  }

  // Escape y el boton Atras del navegador cierran la hoja de arriba, y solo esa
  // (antes Escape cerraba de un golpe todas las hojas anidadas). La pila vive en
  // navegacion/pilaDeCapas para que pantallas y hojas compartan un solo orden.
  const idCapa = useCapa(isOpen, 'hoja', onClose, () => dismissable);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Foco: la hoja declara aria-modal, asi que al abrirse el foco entra en ella
  // (salvo que un campo con autoFocus ya lo haya tomado) y al cerrarse vuelve a
  // quien la abrio. Antes el foco se quedaba detras y Tab recorria la pantalla
  // tapada, activando controles que la persona no veia.
  useEffect(() => {
    if (!isOpen) return;
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const hoja = hojaRef.current;
    const temporizador = setTimeout(() => {
      if (hoja && !hoja.contains(document.activeElement)) hoja.focus({ preventScroll: true });
    }, 0);
    return () => {
      clearTimeout(temporizador);
      const activo = document.activeElement;
      const focoPerdido = !activo || activo === document.body || (hoja !== null && hoja.contains(activo));
      if (previo && previo !== document.body && previo.isConnected && focoPerdido) {
        previo.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  // Tab y Shift+Tab ciclan dentro de la hoja de arriba.
  useEffect(() => {
    if (!isOpen) return;
    const alTabular = (evento: KeyboardEvent) => {
      if (evento.key !== 'Tab' || !esHojaSuperior(idCapa.current)) return;
      const hoja = hojaRef.current;
      if (!hoja) return;
      const enfocables = enfocablesDentro(hoja);
      if (enfocables.length === 0) {
        evento.preventDefault();
        hoja.focus({ preventScroll: true });
        return;
      }
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      const activo = document.activeElement;
      if (!(activo instanceof Node) || !hoja.contains(activo)) {
        evento.preventDefault();
        (evento.shiftKey ? ultimo : primero).focus();
        return;
      }
      if (evento.shiftKey && (activo === primero || activo === hoja)) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && activo === ultimo) {
        evento.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', alTabular);
    return () => document.removeEventListener('keydown', alTabular);
  }, [isOpen, idCapa]);

  if (!visible && !isOpen) return null;

  return ReactDOM.createPortal(
    <div
      className="flex items-end justify-center sm:items-center"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: '100vw',
        height: viewportHeight,
        zIndex: 9999,
      }}
    >
      {/* Backdrop */}
      <div
        role="presentation"
        onClick={dismissable ? onClose : undefined}
        className={`transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
        style={{
          position: 'absolute',
          top: '-100px',
          left: '-100px',
          right: '-100px',
          bottom: '-100px',
          backgroundColor: 'rgba(6, 14, 31, 0.55)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      />

      {/* Sheet */}
      <div
        ref={hojaRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        {...(title ? { 'aria-labelledby': idTitulo } : {})}
        className={`
          relative w-full max-w-md uv-surface-1 uv-shadow-floating outline-none
          rounded-t-[2.25rem] sm:rounded-3xl p-6 transform transition-transform duration-300
          ${isOpen ? 'translate-y-0 scale-100' : 'translate-y-full sm:translate-y-10 sm:scale-95'}
        `}
        style={{ maxHeight: '85vh', paddingBottom: 'calc(1.5rem + env(safe-area-inset-bottom))' }}
      >
        {/* Drag handle (mobile only) */}
        <div className="w-10 h-1.5 bg-[var(--color-border-strong)] dark:bg-[var(--color-border-strong-dark)] rounded-full mx-auto mb-5 sm:hidden" />

        {title && (
          <div className="flex justify-between items-center mb-5">
            <div className="flex items-center gap-1.5 min-w-0">
              <h2
                id={idTitulo}
                className="text-xl font-bold tracking-tight uv-text-primary truncate"
              >
                {title}
              </h2>
              {titleAccessory}
            </div>
            <button
              onClick={onClose}
              aria-label={t('close')}
              className="w-11 h-11 flex items-center justify-center bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-full uv-text-secondary hover:bg-[var(--color-border)] dark:hover:bg-[var(--color-border-dark)] transition-colors text-base"
            >
              ✕
            </button>
          </div>
        )}

        <div className="max-h-[70vh] overflow-y-auto no-scrollbar">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
};
