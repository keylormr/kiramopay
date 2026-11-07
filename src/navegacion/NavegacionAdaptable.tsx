import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { MarcaKiramo } from '../components/MarcaKiramo';
import { IconosLinea } from '../components/Icons';
import { enfocablesDentro } from './enfocables';
import { esHojaSuperior, useCapa } from './pilaDeCapas';
import { bloquearDesplazamiento } from './bloqueoDeDesplazamiento';

/**
 * Navegacion principal segun el tamano de la ventana, con las clases de tamano
 * de Material 3:
 *
 *  - compacta  (< 600 px):   barra inferior, el telefono de siempre.
 *  - mediana   (600-839 px): riel lateral de 88 px (plegable abierto, tablet
 *                            vertical chica). El boton del menu abre el menu
 *                            completo como cajon modal.
 *  - expandida (>= 840 px):  menu lateral fijo de 256 px que se pliega a un
 *                            riel de 88 px con solo iconos (boton del menu o
 *                            Ctrl/Cmd + B). La eleccion queda en el dispositivo.
 *
 * Antes la app era el telefono estirado en cualquier pantalla. Android 16
 * ignora el bloqueo de orientacion desde 600 dp, asi que en tablets y
 * plegables la app SI se ve en horizontal: tiene que estar pensada para eso.
 *
 * Se decide en JavaScript (matchMedia) y no solo con CSS para que en el DOM
 * haya UNA sola navegacion: con dos (una oculta por CSS), un lector de pantalla
 * sin estilos o una prueba en jsdom verian los botones dos veces.
 *
 * El ancho del riel o del menu sale de una sola variable, --kp-nav-ancho
 * (`.kp-marco` en index.css): la navegacion la usa como ancho, las pantallas
 * completas (.kp-capa) como borde izquierdo y el contenido ocupa el resto.
 */

export type ClaseDeVentana = 'compacta' | 'mediana' | 'expandida';

/** Limites de Material 3, iguales a --breakpoint-medio y --breakpoint-expandido de index.css. */
export const ANCHO_MEDIANA = 600;
export const ANCHO_EXPANDIDA = 840;

/** Ids que el boton del menu nombra en aria-controls. */
export const ID_MENU_LATERAL = 'kp-menu-lateral';
export const ID_MENU_MODAL = 'kp-menu-modal';

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

function esCampoEditable(destino: EventTarget | null): boolean {
  if (!(destino instanceof HTMLElement)) return false;
  if (destino.isContentEditable) return true;
  return destino.tagName === 'INPUT' || destino.tagName === 'TEXTAREA' || destino.tagName === 'SELECT';
}

/** Hay otro dialogo modal abierto (una hoja, la verificacion): no el menu. */
function hayOtroModalAbierto(): boolean {
  return Array.from(document.querySelectorAll('[aria-modal="true"]:not([inert])')).some((el) => el.id !== ID_MENU_MODAL);
}

/**
 * Ctrl + B (Cmd + B en Mac) pliega o despliega el menu, como en los editores
 * y paneles de escritorio. Dentro de un campo de texto no hace nada: ahi la
 * combinacion es de quien escribe. Con una hoja abierta tampoco: abriria el
 * menu detras de ella y le quitaria el foco, Tab y Escape.
 */
export function useAtajoDelMenu(activo: boolean, accion: () => void): void {
  const accionRef = useRef(accion);
  useEffect(() => {
    accionRef.current = accion;
  });
  useEffect(() => {
    if (!activo) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.defaultPrevented || evento.repeat || evento.isComposing) return;
      if (evento.key.toLowerCase() !== 'b' || evento.altKey || evento.shiftKey) return;
      if (!evento.ctrlKey && !evento.metaKey) return;
      if (esCampoEditable(evento.target) || hayOtroModalAbierto()) return;
      evento.preventDefault();
      accionRef.current();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [activo]);
}

function teclaDelAtajo(): string {
  if (typeof navigator === 'undefined') return 'Ctrl+B';
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent) ? 'Cmd+B' : 'Ctrl+B';
}

export interface ElementoDeNavegacion {
  id: string;
  Icono: LucideIcon;
  etiqueta: string;
}

/** La cuenta activa, al pie del riel y del menu; tocarla cambia de perfil. */
export interface PieDeNavegacion {
  /** Iniciales, el icono del comercio o el de perfil. */
  avatar: React.ReactNode;
  titulo: string;
  subtitulo: string;
  ariaLabel: string;
  onElegir: () => void;
}

interface PropsComunes {
  elementos: ElementoDeNavegacion[];
  actual: string;
  onElegir: (id: string) => void;
  ariaLabel: string;
}

// El activo sube el relleno del icono al 22 % (el resto, 16 %).
const RELLENO_ACTIVO = '[--kp-icono-relleno:0.22]';
const HOVER_SUAVE = 'hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]';
const BORDE = 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]';

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

/* ─── Piezas del menu (menu fijo, menu plegado y cajon modal) ────────────── */

interface OpcionesDePista {
  /** Tecla del atajo, al lado del nombre (el boton del menu). */
  atajo?: string;
  /** Debajo del elemento en vez de a su derecha (el boton con el menu abierto). */
  abajo?: boolean;
}

interface Pista extends OpcionesDePista {
  texto: string;
  detalle?: string;
  top: number;
  left: number;
}

type MostrarPista = (el: HTMLElement, texto: string, detalle?: string, opciones?: OpcionesDePista) => void;

/** Solo con foco de teclado: un clic tambien enfoca, y ahi ya esta el puntero. */
function tieneFocoVisible(el: HTMLElement): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * Manejadores de la pista de un elemento del riel; sin riel, ninguno. Solo con
 * raton o teclado: con el dedo la pista quedaria pegada (un toque no tiene
 * salida del cursor) encima de la pantalla que se abre.
 */
function manejadoresDePista(plegado: boolean, mostrar: MostrarPista, ocultar: () => void, texto: string, detalle?: string, opciones?: OpcionesDePista) {
  if (!plegado) return {};
  return {
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'touch' || e.pointerType === 'pen') return;
      mostrar(e.currentTarget, texto, detalle, opciones);
    },
    onPointerLeave: ocultar,
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      if (tieneFocoVisible(e.currentTarget)) mostrar(e.currentTarget, texto, detalle, opciones);
    },
    onBlur: ocultar,
  };
}

interface PropsItem {
  elemento: ElementoDeNavegacion;
  activo: boolean;
  plegado: boolean;
  onElegir: (id: string) => void;
  mostrarPista: MostrarPista;
  ocultarPista: () => void;
}

/**
 * Un elemento del menu. El hueco del icono mide 56 px, lo mismo que el
 * interior del riel plegado: al plegar, el icono no se mueve y solo se recorta
 * la etiqueta. aria-label lleva el nombre tambien con la etiqueta oculta.
 */
const ItemDeMenu: React.FC<PropsItem> = ({ elemento: { id, Icono, etiqueta }, activo, plegado, onElegir, mostrarPista, ocultarPista }) => (
  <button
    type="button"
    onClick={() => {
      // La pantalla que se abre queda debajo de la pista: se va antes.
      ocultarPista();
      onElegir(id);
    }}
    aria-current={activo ? 'page' : undefined}
    aria-label={etiqueta}
    {...manejadoresDePista(plegado, mostrarPista, ocultarPista, etiqueta)}
    className={`kp-toque kp-foco flex h-11 w-full shrink-0 items-center overflow-hidden rounded-xl text-left text-sm ${
      activo
        ? `bg-[var(--color-primary-soft)] font-semibold text-[var(--color-primary)] dark:bg-[rgba(45,123,255,0.16)] dark:text-[var(--color-text-primary-dark)] ${RELLENO_ACTIVO}`
        : `font-medium uv-text-secondary ${HOVER_SUAVE}`
    }`}
  >
    <span className="flex w-14 shrink-0 items-center justify-center">
      <Icono size={21} className={activo ? 'text-[var(--color-primary)] dark:text-[var(--color-primary-light)]' : undefined} />
    </span>
    <span
      className={`min-w-0 whitespace-nowrap pr-3 transition-opacity duration-[var(--kp-mov-estado)] ease-kp ${plegado ? 'opacity-0' : 'opacity-100'}`}
    >
      {etiqueta}
    </span>
  </button>
);

const MarcaDelMenu: React.FC<{ nombre: string; plegado: boolean }> = ({ nombre, plegado }) => (
  <>
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl uv-gradient-brand">
      <MarcaKiramo size={22} />
    </span>
    <span
      aria-hidden={plegado || undefined}
      className={`whitespace-nowrap text-[17px] font-semibold tracking-[-0.01em] uv-text-primary transition-opacity duration-[var(--kp-mov-estado)] ease-kp ${plegado ? 'opacity-0' : 'opacity-100'}`}
    >
      {nombre}
    </span>
  </>
);

interface PropsListaDelMenu {
  elementos: ElementoDeNavegacion[];
  atajos: ElementoDeNavegacion[];
  actual: string;
  plegado: boolean;
  onElegir: (id: string) => void;
  mostrarPista: MostrarPista;
  ocultarPista: () => void;
}

/** Pestanas y, separados por una linea, los accesos del menu. */
const ListaDelMenu: React.FC<PropsListaDelMenu> = ({ elementos, atajos, actual, plegado, onElegir, mostrarPista, ocultarPista }) => {
  const item = (elemento: ElementoDeNavegacion) => (
    <ItemDeMenu
      key={elemento.id}
      elemento={elemento}
      activo={actual === elemento.id}
      plegado={plegado}
      onElegir={onElegir}
      mostrarPista={mostrarPista}
      ocultarPista={ocultarPista}
    />
  );
  return (
    // La lista se desplaza sola si no entra (telefono en horizontal): la marca
    // y la cuenta quedan fijas arriba y abajo.
    <div onScroll={ocultarPista} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-4 pt-3 [scrollbar-width:none]">
      {elementos.map(item)}
      {atajos.length > 0 && <div className={`mt-3 flex flex-col gap-0.5 border-t pt-3 ${BORDE}`}>{atajos.map(item)}</div>}
    </div>
  );
};

const PieDelMenu: React.FC<{ pie: PieDeNavegacion; plegado: boolean; mostrarPista: MostrarPista; ocultarPista: () => void }> = ({ pie, plegado, mostrarPista, ocultarPista }) => (
  <div className={`mx-4 mt-3 shrink-0 border-t pt-3 ${BORDE}`}>
    <button
      type="button"
      onClick={() => {
        ocultarPista();
        pie.onElegir();
      }}
      aria-label={pie.ariaLabel}
      {...manejadoresDePista(plegado, mostrarPista, ocultarPista, pie.titulo, pie.subtitulo)}
      className={`kp-toque kp-foco flex w-full items-center gap-2.5 overflow-hidden rounded-xl p-2 text-left ${HOVER_SUAVE}`}
    >
      {pie.avatar}
      <span className={`min-w-0 transition-opacity duration-[var(--kp-mov-estado)] ease-kp ${plegado ? 'opacity-0' : 'opacity-100'}`}>
        <span className="block truncate text-sm font-semibold uv-text-primary">{pie.titulo}</span>
        <span className="block truncate text-xs uv-text-secondary">{pie.subtitulo}</span>
      </span>
    </button>
  </div>
);

/**
 * Pista con el nombre de un icono del riel. Va en un portal a <body>: dentro
 * del menu la cortaria su overflow y quedaria debajo de las pantallas
 * completas (el menu es sticky con z-30 y su z-index no sale de ahi). El nombre
 * accesible ya lo da el aria-label del boton, asi que la pista es solo visual.
 * Escape la cierra sin cerrar la pantalla de abajo (WCAG 1.4.13).
 */
function usePista(plegado: boolean) {
  const [pista, setPista] = useState<Pista | null>(null);
  // Al plegar o desplegar, la pista se olvida: el elemento cambio de forma, y
  // al volver a plegar reapareceria la ultima en su lugar viejo sin que el
  // cursor este encima.
  const [plegadoAntes, setPlegadoAntes] = useState(plegado);
  if (plegadoAntes !== plegado) {
    setPlegadoAntes(plegado);
    setPista(null);
  }
  const mostrar = useCallback<MostrarPista>((el, texto, detalle, opciones) => {
    const caja = el.getBoundingClientRect();
    // A la derecha, centrada en el alto del elemento; abajo, alineada con su
    // borde izquierdo (centrada se saldria de la ventana por la izquierda).
    const punto = opciones?.abajo
      ? { top: caja.bottom + 6, left: caja.left }
      : { top: caja.top + caja.height / 2, left: caja.right + 12 };
    setPista({ texto, detalle, ...opciones, ...punto });
  }, []);
  const ocultar = useCallback(() => setPista(null), []);
  const visible = pista;
  useEffect(() => {
    if (!visible) return;
    const alTeclear = (evento: KeyboardEvent) => {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      setPista(null);
    };
    // En captura: corre antes que el Escape de pilaDeCapas, que mira defaultPrevented.
    window.addEventListener('keydown', alTeclear, true);
    return () => window.removeEventListener('keydown', alTeclear, true);
  }, [visible]);
  // El ancla es un punto sin tamano: a la derecha, una fila de alto 0 que
  // centra la burbuja en vertical; abajo, la burbuja cuelga de el. Sin
  // translate: la animacion de entrada usa transform y lo pisaria.
  const nodo = visible ? createPortal(
    <span
      aria-hidden="true"
      data-pista=""
      data-lado={visible.abajo ? 'abajo' : 'derecha'}
      style={{ top: visible.top, left: visible.left }}
      className={`pointer-events-none fixed z-[70] flex ${visible.abajo ? 'items-start' : 'h-0 items-center'}`}
    >
      <span className="kp-pista whitespace-nowrap rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-3)] px-2.5 py-1.5 text-xs font-medium uv-text-primary uv-shadow-floating dark:border-[var(--color-border-strong-dark)] dark:bg-[var(--color-surface-3-dark)]">
        {visible.texto}
        {visible.atajo && (
          <kbd className="ml-2 rounded-md border border-[var(--color-border-strong)] px-1.5 py-px font-sans text-[11px] font-medium uv-text-secondary dark:border-[var(--color-border-strong-dark)]">
            {visible.atajo}
          </kbd>
        )}
        {visible.detalle && <span className="block font-normal uv-text-secondary">{visible.detalle}</span>}
      </span>
    </span>,
    document.body,
  ) : null;
  return { mostrar, ocultar, nodo };
}

/* ─── Riel y menu lateral ────────────────────────────────────────────────── */

interface PropsLaterales extends PropsComunes {
  clase: Exclude<ClaseDeVentana, 'compacta'>;
  /** Solo en expandida: el menu plegado a riel con solo iconos. */
  plegado?: boolean;
  /** Accesos extra que caben en el menu (expandida, plegado o no). */
  atajos?: ElementoDeNavegacion[];
  /** La cuenta activa, al pie. */
  pie?: PieDeNavegacion;
  nombreDeLaApp: string;
  /**
   * Boton del menu, arriba a la izquierda de la propia navegacion: pliega el
   * menu (expandida) o abre el cajon (mediana). Va aqui y no en la barra
   * superior porque las pantallas completas tapan esa barra, y la navegacion
   * sigue a la vista con cualquier pantalla abierta.
   */
  control?: ControlDelMenu;
  /** El cajon devuelve el foco a este boton al cerrarse. */
  refDelBoton?: React.Ref<HTMLButtonElement>;
}

export interface ControlDelMenu {
  modalAbierto: boolean;
  onAlternar: () => void;
  etiquetas: { plegar: string; desplegar: string; abrir: string };
}

/** Riel (mediana) o menu lateral fijo, abierto o plegado (expandida). */
export const NavegacionLateral: React.FC<PropsLaterales> = ({ clase, plegado = false, elementos, atajos = [], actual, onElegir, ariaLabel, pie, nombreDeLaApp, control, refDelBoton }) => {
  const esMenu = clase === 'expandida';
  const plegadoAqui = esMenu && plegado;
  const pista = usePista(plegadoAqui);

  // El boton queda siempre en el mismo punto (centrado sobre la columna de
  // iconos), abierto o plegado: volver a tocarlo no obliga a buscarlo. Su
  // pista sale a la derecha sobre el riel y debajo con el menu abierto, para
  // no tapar la marca.
  const boton = control ? (
    <BotonDelMenu
      ref={refDelBoton}
      clase={clase}
      plegado={plegadoAqui}
      modalAbierto={control.modalAbierto}
      onAlternar={() => {
        pista.ocultar();
        control.onAlternar();
      }}
      etiquetas={control.etiquetas}
      mostrarPista={pista.mostrar}
      ocultarPista={pista.ocultar}
      pistaAbajo={esMenu && !plegadoAqui}
    />
  ) : null;

  // Comun a los tres: el ancho es --kp-nav-ancho y cambia con la curva de hoja;
  // los margenes seguros se suman al relleno (no con .pt-safe/.pl-safe, que
  // reemplazarian el relleno): en un telefono en horizontal, la muesca queda
  // del lado del riel.
  const marco = `sticky top-0 z-30 flex h-dvh w-[var(--kp-nav-ancho)] shrink-0 flex-col overflow-hidden border-r ${BORDE} bg-[var(--color-surface-1)] dark:bg-[var(--color-surface-1-dark)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] pb-[calc(1rem+env(safe-area-inset-bottom))] transition-[width] duration-[var(--kp-mov-hoja)] ease-kp-hoja`;

  if (esMenu) {
    return (
      <nav id={ID_MENU_LATERAL} role="navigation" aria-label={ariaLabel} data-navegacion="menu" data-plegado={plegadoAqui ? 'si' : 'no'} className={marco}>
        {/* Alto de la barra superior: la marca queda a la altura del titulo. */}
        {boton ? (
          <div className="flex h-14 shrink-0 items-center overflow-hidden px-4">
            <span className="flex w-14 shrink-0 justify-center">{boton}</span>
            {/* Plegado, la marca se va entera: el riel empieza con el boton. */}
            <span
              aria-hidden={plegadoAqui || undefined}
              className={`flex items-center gap-2.5 transition-opacity duration-[var(--kp-mov-estado)] ease-kp ${plegadoAqui ? 'opacity-0' : 'opacity-100'}`}
            >
              <MarcaDelMenu nombre={nombreDeLaApp} plegado={false} />
            </span>
          </div>
        ) : (
          <div className="flex h-14 shrink-0 items-center gap-2.5 overflow-hidden px-6">
            <MarcaDelMenu nombre={nombreDeLaApp} plegado={plegadoAqui} />
          </div>
        )}
        <ListaDelMenu
          elementos={elementos}
          atajos={atajos}
          actual={actual}
          plegado={plegadoAqui}
          onElegir={onElegir}
          mostrarPista={pista.mostrar}
          ocultarPista={pista.ocultar}
        />
        {pie && <PieDelMenu pie={pie} plegado={plegadoAqui} mostrarPista={pista.mostrar} ocultarPista={pista.ocultar} />}
        {pista.nodo}
      </nav>
    );
  }

  return (
    <nav id={ID_MENU_LATERAL} role="navigation" aria-label={ariaLabel} data-navegacion="riel" className={`${marco} items-center`}>
      {/* Riel de Material 3: el boton del menu arriba y los destinos debajo.
          El cajon abre con su propio boton de cerrar en este mismo punto. */}
      <div className="flex h-14 shrink-0 items-center">
        {boton ?? (
          <span className="flex h-10 w-10 items-center justify-center rounded-xl uv-gradient-brand">
            <MarcaKiramo size={22} />
          </span>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto pt-3 [scrollbar-width:none]">
        {elementos.map(({ id, Icono, etiqueta }) => {
          const activo = actual === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onElegir(id)}
              aria-current={activo ? 'page' : undefined}
              className={`kp-toque kp-foco group flex w-[72px] shrink-0 flex-col items-center gap-1 rounded-xl py-1.5 ${
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
        })}
      </div>
      {pie && (
        <div className="mt-3 shrink-0">
          <button type="button" onClick={pie.onElegir} aria-label={pie.ariaLabel} title={pie.titulo} className={`kp-toque kp-foco rounded-xl p-1 ${HOVER_SUAVE}`}>
            {pie.avatar}
          </button>
        </div>
      )}
      {pista.nodo}
    </nav>
  );
};

/* ─── Boton del menu ─────────────────────────────────────────────────────── */

interface PropsBoton {
  clase: Exclude<ClaseDeVentana, 'compacta'>;
  plegado: boolean;
  modalAbierto: boolean;
  onAlternar: () => void;
  etiquetas: { plegar: string; desplegar: string; abrir: string };
  /** Pista con el nombre y el atajo (raton y teclado). */
  mostrarPista?: MostrarPista;
  ocultarPista?: () => void;
  pistaAbajo?: boolean;
}

const ningunaPista = () => {};

/**
 * En expandida pliega o despliega el menu fijo; en mediana abre el menu
 * completo como cajon modal. La flecha del icono dice lo que va a pasar, y la
 * pista lo dice con palabras y con el atajo de teclado.
 */
export const BotonDelMenu = forwardRef<HTMLButtonElement, PropsBoton>(function BotonDelMenu(
  { clase, plegado, modalAbierto, onAlternar, etiquetas, mostrarPista, ocultarPista = ningunaPista, pistaAbajo = false },
  ref,
) {
  const esModal = clase === 'mediana';
  const abierto = esModal ? modalAbierto : !plegado;
  const etiqueta = esModal ? etiquetas.abrir : plegado ? etiquetas.desplegar : etiquetas.plegar;
  const Icono = abierto && !esModal ? IconosLinea.MenuPlegar : IconosLinea.MenuDesplegar;
  const pista = mostrarPista
    ? manejadoresDePista(true, mostrarPista, ocultarPista, etiqueta, undefined, { atajo: teclaDelAtajo(), abajo: pistaAbajo })
    : {};
  return (
    <button
      ref={ref}
      type="button"
      onClick={onAlternar}
      aria-label={etiqueta}
      aria-expanded={abierto}
      aria-controls={esModal ? ID_MENU_MODAL : ID_MENU_LATERAL}
      aria-haspopup={esModal ? 'dialog' : undefined}
      aria-keyshortcuts="Control+B Meta+B"
      data-boton-menu=""
      {...pista}
      className={`kp-toque kp-foco flex h-11 w-11 shrink-0 items-center justify-center rounded-full uv-text-secondary ${HOVER_SUAVE}`}
    >
      <Icono size={22} />
    </button>
  );
});

/* ─── Menu modal (mediana) ───────────────────────────────────────────────── */

interface PropsModal extends PropsComunes {
  abierto: boolean;
  onCerrar: () => void;
  atajos?: ElementoDeNavegacion[];
  pie?: PieDeNavegacion;
  nombreDeLaApp: string;
  etiquetaCerrar: string;
  /** A donde vuelve el foco al cerrar (el boton del menu). */
  devolverFocoA?: React.RefObject<HTMLElement | null>;
}

/**
 * Cajon modal de Material 3 para la ventana mediana: el menu completo (con los
 * accesos y la cuenta) entra desde el borde sobre el riel y el contenido, con
 * el fondo atenuado. Escape, el boton Atras, tocar el fondo, la X o elegir un
 * destino lo cierran; mientras esta abierto el foco no sale de el.
 *
 * Queda montado (invisible e inerte) para que aria-controls del boton apunte
 * siempre a algo y para animar la salida.
 */
export const MenuModal: React.FC<PropsModal> = ({ abierto, onCerrar, elementos, atajos = [], actual, onElegir, ariaLabel, pie, nombreDeLaApp, etiquetaCerrar, devolverFocoA }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  // Escape y Atras cierran la hoja de arriba (pilaDeCapas).
  const idCapa = useCapa(abierto, 'hoja', onCerrar);
  const sinPista = useCallback(() => {}, []);

  useEffect(() => (abierto ? bloquearDesplazamiento() : undefined), [abierto]);

  // Foco: entra al destino actual (o al primero) y al cerrar vuelve al boton.
  useEffect(() => {
    if (!abierto) return;
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const boton = devolverFocoA?.current ?? null;
    const panel = panelRef.current;
    // La pantalla completa que ya estaba abierta antes del cajon.
    const capaAntes = document.querySelector<HTMLElement>('.kp-capa');
    const temporizador = setTimeout(() => {
      if (!panel || panel.contains(document.activeElement)) return;
      const destino = panel.querySelector<HTMLElement>('[aria-current="page"]') ?? enfocablesDentro(panel)[0] ?? panel;
      destino.focus({ preventScroll: true });
    }, 0);
    return () => {
      clearTimeout(temporizador);
      const activo = document.activeElement;
      const focoPerdido = !activo || activo === document.body || (panel !== null && panel.contains(activo));
      if (!focoPerdido) return;
      // Si el destino abrio una pantalla completa, el foco entra a ella: es lo
      // que la persona eligio. Si la pantalla ya estaba abierta (cerrar el
      // cajon con Escape o la X encima de Tarjetas), vuelve al boton del riel,
      // que sigue a la vista.
      const capa = document.querySelector<HTMLElement>('.kp-capa');
      const enCapa = capa && capa !== capaAntes ? enfocablesDentro(capa)[0] : undefined;
      if (enCapa) {
        enCapa.focus({ preventScroll: true });
        return;
      }
      const vuelta = boton ?? previo;
      if (vuelta && vuelta !== document.body && vuelta.isConnected) vuelta.focus({ preventScroll: true });
    };
  }, [abierto, devolverFocoA]);

  // Tab y Shift+Tab ciclan dentro del menu mientras es la hoja de arriba.
  useEffect(() => {
    if (!abierto) return;
    const alTabular = (evento: KeyboardEvent) => {
      if (evento.key !== 'Tab' || !esHojaSuperior(idCapa.current)) return;
      const panel = panelRef.current;
      if (!panel) return;
      const enfocables = enfocablesDentro(panel);
      if (enfocables.length === 0) {
        evento.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      const activo = document.activeElement;
      if (!(activo instanceof Node) || !panel.contains(activo)) {
        evento.preventDefault();
        (evento.shiftKey ? ultimo : primero).focus();
      } else if (evento.shiftKey && (activo === primero || activo === panel)) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && activo === ultimo) {
        evento.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', alTabular);
    return () => document.removeEventListener('keydown', alTabular);
  }, [abierto, idCapa]);

  const elegir = (id: string) => {
    onElegir(id);
    onCerrar();
  };
  const elegirPie = pie ? { ...pie, onElegir: () => { onCerrar(); pie.onElegir(); } } : undefined;

  return (
    <div className={`fixed inset-0 z-[60] ${abierto ? '' : 'pointer-events-none'}`} data-menu-modal={abierto ? 'abierto' : 'cerrado'}>
      <div
        aria-hidden="true"
        onClick={onCerrar}
        className={`absolute inset-0 bg-[rgba(5,11,24,0.62)] transition-opacity duration-[var(--kp-mov-hoja)] ease-kp ${abierto ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        ref={panelRef}
        id={ID_MENU_MODAL}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        inert={!abierto}
        className={`absolute inset-y-0 left-0 flex w-[calc(16rem+env(safe-area-inset-left))] max-w-[85vw] flex-col overflow-hidden rounded-r-[var(--radius-2xl)] border-r ${BORDE} bg-[var(--color-surface-1)] dark:bg-[var(--color-surface-1-dark)] uv-shadow-floating pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)] pb-[calc(1rem+env(safe-area-inset-bottom))] outline-none duration-[var(--kp-mov-hoja)] ease-kp-hoja ${
          // Al abrir, la visibilidad cambia en el acto (si no, el panel sigue
          // oculto en el primer cuadro y no puede recibir el foco); al cerrar,
          // espera a que termine de salir.
          abierto ? 'visible translate-x-0 transition-transform' : 'invisible -translate-x-full transition-[transform,visibility]'
        }`}
      >
        {/* La misma cabecera que el menu fijo: cerrar queda justo encima del
            boton del riel que lo abrio, y la marca a su derecha. */}
        <div className="flex h-14 shrink-0 items-center px-4">
          <span className="flex w-14 shrink-0 justify-center">
            <button
              type="button"
              onClick={onCerrar}
              aria-label={etiquetaCerrar}
              className={`kp-toque kp-foco flex h-11 w-11 shrink-0 items-center justify-center rounded-full uv-text-secondary ${HOVER_SUAVE}`}
            >
              <IconosLinea.MenuPlegar size={22} />
            </button>
          </span>
          <span className="flex min-w-0 items-center gap-2.5">
            <MarcaDelMenu nombre={nombreDeLaApp} plegado={false} />
          </span>
        </div>
        <ListaDelMenu elementos={elementos} atajos={atajos} actual={actual} plegado={false} onElegir={elegir} mostrarPista={sinPista} ocultarPista={sinPista} />
        {elegirPie && <PieDelMenu pie={elegirPie} plegado={false} mostrarPista={sinPista} ocultarPista={sinPista} />}
      </div>
    </div>
  );
};
