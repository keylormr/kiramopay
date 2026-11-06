import React, { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { MarcaKiramo } from '../components/MarcaKiramo';

/**
 * Navegacion principal segun el tamano de la ventana, con las clases de tamano
 * de Material 3:
 *
 *  - compacta  (< 600 px):   barra inferior, el telefono de siempre.
 *  - mediana   (600-839 px): riel lateral de 88 px (plegable abierto, tablet
 *                            vertical chica).
 *  - expandida (>= 840 px):  menu lateral fijo de 256 px (tablet horizontal,
 *                            escritorio).
 *
 * Antes la app era el telefono estirado en cualquier pantalla. Android 16
 * ignora el bloqueo de orientacion desde 600 dp, asi que en tablets y
 * plegables la app SI se ve en horizontal: tiene que estar pensada para eso.
 *
 * Se decide en JavaScript (matchMedia) y no solo con CSS para que en el DOM
 * haya UNA sola navegacion: con dos (una oculta por CSS), un lector de pantalla
 * sin estilos o una prueba en jsdom verian los botones dos veces.
 */

export type ClaseDeVentana = 'compacta' | 'mediana' | 'expandida';

/** Limites de Material 3, iguales a --breakpoint-medio y --breakpoint-expandido de index.css. */
export const ANCHO_MEDIANA = 600;
export const ANCHO_EXPANDIDA = 840;

const CONSULTA_MEDIANA = `(min-width: ${ANCHO_MEDIANA}px)`;
const CONSULTA_EXPANDIDA = `(min-width: ${ANCHO_EXPANDIDA}px)`;

function claseActual(): ClaseDeVentana {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'compacta';
  if (window.matchMedia(CONSULTA_EXPANDIDA).matches) return 'expandida';
  if (window.matchMedia(CONSULTA_MEDIANA).matches) return 'mediana';
  return 'compacta';
}

/** La clase de tamano de la ventana; cambia al girar, plegar o redimensionar. */
export function useClaseDeVentana(): ClaseDeVentana {
  const [clase, setClase] = useState<ClaseDeVentana>(claseActual);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const consultas = [window.matchMedia(CONSULTA_MEDIANA), window.matchMedia(CONSULTA_EXPANDIDA)];
    const alCambiar = () => setClase(claseActual());
    consultas.forEach((c) => c.addEventListener?.('change', alCambiar));
    // Por si cambio entre el primer render y la suscripcion.
    alCambiar();
    return () => consultas.forEach((c) => c.removeEventListener?.('change', alCambiar));
  }, []);
  return clase;
}

export interface ElementoDeNavegacion {
  id: string;
  Icono: LucideIcon;
  etiqueta: string;
}

interface PropsComunes {
  elementos: ElementoDeNavegacion[];
  actual: string;
  onElegir: (id: string) => void;
  ariaLabel: string;
}

// El activo sube el relleno del icono al 22 % (el resto, 16 %).
const RELLENO_ACTIVO = '[--kp-icono-relleno:0.22]';

/** Barra inferior (clase compacta). Opaca a proposito: ver __tests__/barraInferior.test.ts. */
export const BarraInferior: React.FC<PropsComunes> = ({ elementos, actual, onElegir, ariaLabel }) => (
  <nav role="navigation" aria-label={ariaLabel} data-navegacion="barra" className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--color-surface-1)] dark:bg-[var(--color-surface-1-dark)] border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] pb-safe pl-safe pr-safe">
    <div className="mx-auto flex h-16 max-w-2xl items-stretch justify-around px-1">
      {elementos.map(({ id, Icono, etiqueta }) => {
        const activo = actual === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onElegir(id)}
            aria-current={activo ? 'page' : undefined}
            className={`kp-toque kp-foco group flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl ${
              activo ? 'text-[var(--color-primary)] dark:text-[var(--color-text-primary-dark)]' : 'uv-text-muted'
            }`}
          >
            <span
              className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-[var(--kp-mov-estado)] ease-kp ${
                activo ? `bg-[var(--color-primary-soft)] dark:bg-[rgba(45,123,255,0.22)] ${RELLENO_ACTIVO}` : 'group-hover:bg-[var(--color-surface-muted)] dark:group-hover:bg-[var(--color-surface-muted-dark)]'
              }`}
            >
              <Icono size={22} />
            </span>
            {/* Una linea siempre: en 344 px (plegable cerrado) no se parte. */}
            <span className={`max-w-full truncate text-[11px] leading-none ${activo ? 'font-semibold' : 'font-medium'}`}>{etiqueta}</span>
          </button>
        );
      })}
    </div>
  </nav>
);

interface PropsLaterales extends PropsComunes {
  clase: Exclude<ClaseDeVentana, 'compacta'>;
  /** Accesos extra que solo caben en el menu lateral (expandida). */
  atajos?: ElementoDeNavegacion[];
  /** Lo que va al pie del menu lateral (la identidad de la cuenta). */
  pie?: React.ReactNode;
  nombreDeLaApp: string;
}

/** Riel (mediana) o menu lateral fijo (expandida). */
export const NavegacionLateral: React.FC<PropsLaterales> = ({ clase, elementos, atajos = [], actual, onElegir, ariaLabel, pie, nombreDeLaApp }) => {
  const esMenu = clase === 'expandida';
  const boton = ({ id, Icono, etiqueta }: ElementoDeNavegacion) => {
    const activo = actual === id;
    if (esMenu) {
      return (
        <button
          key={id}
          type="button"
          onClick={() => onElegir(id)}
          aria-current={activo ? 'page' : undefined}
          className={`kp-toque kp-foco flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm ${
            activo
              ? `bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary)] dark:bg-[rgba(45,123,255,0.16)] dark:text-[var(--color-text-primary-dark)] ${RELLENO_ACTIVO}`
              : 'font-medium uv-text-secondary hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]'
          }`}
        >
          <Icono size={21} className={activo ? 'text-[var(--color-primary)] dark:text-[var(--color-primary-light)]' : undefined} />
          <span className="truncate">{etiqueta}</span>
        </button>
      );
    }
    return (
      <button
        key={id}
        type="button"
        onClick={() => onElegir(id)}
        aria-current={activo ? 'page' : undefined}
        className={`kp-toque kp-foco group flex w-[72px] flex-col items-center gap-1 rounded-xl py-1.5 ${
          activo ? 'text-[var(--color-primary)] dark:text-[var(--color-text-primary-dark)]' : 'uv-text-muted'
        }`}
      >
        <span
          className={`flex h-8 w-13 items-center justify-center rounded-full transition-colors duration-[var(--kp-mov-estado)] ease-kp ${
            activo ? `bg-[var(--color-primary-soft)] dark:bg-[rgba(45,123,255,0.22)] ${RELLENO_ACTIVO}` : 'group-hover:bg-[var(--color-surface-muted)] dark:group-hover:bg-[var(--color-surface-muted-dark)]'
          }`}
        >
          <Icono size={22} />
        </span>
        <span className={`max-w-full truncate text-[11px] leading-tight ${activo ? 'font-semibold' : 'font-medium'}`}>{etiqueta}</span>
      </button>
    );
  };

  return (
    <nav
      role="navigation"
      aria-label={ariaLabel}
      data-navegacion={esMenu ? 'menu' : 'riel'}
      // Los margenes seguros van sumados al relleno y al ancho (no con
      // .pt-safe/.pl-safe, que reemplazarian el relleno): en un telefono en
      // horizontal, la muesca queda del lado del riel. El ancho total es el
      // mismo --kp-nav-ancho de index.css.
      className={`sticky top-0 z-30 flex h-dvh shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface-1)] dark:border-[var(--color-border-dark)] dark:bg-[var(--color-surface-1-dark)] pt-[calc(1.25rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] ${
        esMenu
          ? 'w-[calc(16rem+env(safe-area-inset-left))] pl-[calc(1rem+env(safe-area-inset-left))] pr-4'
          : 'w-[calc(88px+env(safe-area-inset-left))] pl-[env(safe-area-inset-left)] items-center'
      }`}
    >
      <div className={`flex items-center gap-2.5 ${esMenu ? 'px-2 pb-6' : 'pb-5'}`}>
        <span className="flex h-10 w-10 items-center justify-center rounded-xl uv-gradient-brand">
          <MarcaKiramo size={22} />
        </span>
        {esMenu && <span className="text-[17px] font-semibold tracking-[-0.01em] uv-text-primary">{nombreDeLaApp}</span>}
      </div>
      <div className={`flex flex-col ${esMenu ? 'gap-0.5' : 'items-center gap-1'}`}>{elementos.map(boton)}</div>
      {esMenu && atajos.length > 0 && (
        <div className="mt-4 flex flex-col gap-0.5 border-t border-[var(--color-border)] pt-4 dark:border-[var(--color-border-dark)]">{atajos.map(boton)}</div>
      )}
      {pie && <div className={`mt-auto ${esMenu ? 'border-t border-[var(--color-border)] pt-3 dark:border-[var(--color-border-dark)]' : ''}`}>{pie}</div>}
    </nav>
  );
};
