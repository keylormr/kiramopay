import { useEffect, useSyncExternalStore } from 'react';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Las barras del sistema siguen a lo que muestra la APP, no al tema del
 * telefono.
 *
 * Lo nativo arranca siempre oscuro (el splash, la ventana y los iconos claros
 * de las barras: res/values/styles.xml, Info.plist y capacitor.config.ts). Si
 * la persona eligio el tema claro hay que oscurecer la tinta de los iconos,
 * pero solo si la pagina pasa POR DEBAJO de las barras:
 *
 * - iOS: siempre (el WebView ocupa toda la pantalla, contentInset 'never').
 * - Android: las barras son transparentes y SystemBars de Capacitor 8 deja
 *   pasar la pagina por debajo de todas con un WebView 140 o posterior; con uno
 *   anterior rellena el WebView y detras de las barras queda la ventana nativa,
 *   que es oscura (kiramo_fondo). Es todo o nada, y se sabe por las variables
 *   --safe-area-inset-* que inyecta en la raiz: en el primer caso alguna trae
 *   alto (la de arriba, o la del lado donde este la barra de navegacion) y en
 *   el segundo todas valen 0. Una vez que alguna trajo alto, la pagina pasa por
 *   debajo para toda la sesion (el teclado abierto pone la de abajo en 0 sin
 *   que eso cambie).
 *
 * En la web solo cambia el theme-color, que pinta la barra del navegador y la
 * de la PWA instalada.
 *
 * "Oscuro" es lo que se VE: el tema oscuro, o una pantalla que es oscura con
 * cualquier tema (useSuperficieOscura).
 */

/** --color-background-dark y --color-background de src/index.css. */
export const FONDO_OSCURO = '#050B18';
export const FONDO_CLARO = '#F2F5FA';

/** 'DARK' son iconos claros, para un fondo oscuro; 'LIGHT', iconos oscuros. */
export type TintaDeBarra = 'DARK' | 'LIGHT';

/** La tinta de las dos barras (estado y navegacion), que siempre es la misma. */
export function tintaDeLasBarras(oscuro: boolean, plataforma: string, paginaBajoLasBarras: boolean): TintaDeBarra {
  if (oscuro) return 'DARK';
  if (plataforma !== 'android') return 'LIGHT';
  return paginaBajoLasBarras ? 'LIGHT' : 'DARK';
}

let paginaBajoLasBarras = false;
const LADOS = ['top', 'right', 'bottom', 'left'];

/** Lee las variables que inyecta SystemBars. Devuelve true solo la vez que se entera de que la pagina pasa por debajo. */
function leerPaginaBajoLasBarras(): boolean {
  if (paginaBajoLasBarras) return false;
  const estilo = document.documentElement.style;
  paginaBajoLasBarras = LADOS.some((l) => (parseFloat(estilo.getPropertyValue(`--safe-area-inset-${l}`)) || 0) > 0);
  return paginaBajoLasBarras;
}

const ESTILO_SISTEMA: Record<TintaDeBarra, SystemBarsStyle> = {
  DARK: SystemBarsStyle.Dark,
  LIGHT: SystemBarsStyle.Light,
};
const ESTILO_STATUS_BAR: Record<TintaDeBarra, Style> = { DARK: Style.Dark, LIGHT: Style.Light };

export async function aplicarColoresDelSistema(oscuro: boolean): Promise<void> {
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', oscuro ? FONDO_OSCURO : FONDO_CLARO);

  if (!Capacitor.isNativePlatform()) return;
  leerPaginaBajoLasBarras();
  const tinta = tintaDeLasBarras(oscuro, Capacitor.getPlatform(), paginaBajoLasBarras);
  try {
    // Sin `bar`: la misma tinta para la barra de estado y la de navegacion.
    await SystemBars.setStyle({ style: ESTILO_SISTEMA[tinta] });
    // El plugin viejo guarda su propio estilo y lo vuelve a aplicar en cada
    // cambio de configuracion (girar, abrir el plegable): tiene que coincidir.
    await StatusBar.setStyle({ style: ESTILO_STATUS_BAR[tinta] });
  } catch {
    // Un binario sin alguno de los plugins: queda la tinta del tema nativo
    // (iconos claros), que es la del tema por defecto.
  }
}

// Pantallas que son oscuras con cualquier tema (el arranque, el login, la
// recuperacion de contrasena, el bloqueo): mientras alguna esta a la vista, las
// barras van como en oscuro aunque la persona haya elegido el claro.
let superficiesOscuras = 0;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());
const suscribir = (f: () => void) => {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
};
const haySuperficieOscura = () => superficiesOscuras > 0;

/** La llama una pantalla oscura con cualquier tema mientras esta montada (y `activa`). */
export function useSuperficieOscura(activa = true): void {
  useEffect(() => {
    if (!activa) return;
    superficiesOscuras += 1;
    avisar();
    return () => {
      superficiesOscuras -= 1;
      avisar();
    };
  }, [activa]);
}

export function useBarrasDelSistema(temaOscuro: boolean): void {
  const superficieOscura = useSyncExternalStore(suscribir, haySuperficieOscura, haySuperficieOscura);
  const oscuro = temaOscuro || superficieOscura;
  useEffect(() => {
    void aplicarColoresDelSistema(oscuro);
    // En oscuro la tinta no depende de por donde pase la pagina.
    if (oscuro || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
    // SystemBars inyecta las variables cuando la pagina ya esta visible y cada
    // vez que cambian los margenes: puede llegar despues de este efecto.
    const observador = new MutationObserver(() => {
      if (leerPaginaBajoLasBarras()) void aplicarColoresDelSistema(oscuro);
    });
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observador.disconnect();
  }, [oscuro]);
}

/** Solo para las pruebas: vuelve al estado de un arranque. */
export function reiniciarBarrasParaPruebas(): void {
  paginaBajoLasBarras = false;
  superficiesOscuras = 0;
}
