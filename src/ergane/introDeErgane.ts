// La intro de marca de Ergane al abrir la web: la E tejida se arma en 3D y se
// reteje en el icono de KiramoPay, con la firma "Desarrollado por Ergane".
//
// ergane-intro.js, ergane-intro.d.ts y trama.svg son la copia, sin cambios, de la
// fuente unica de Ergane (athena-marca/ergane/intro). Si hace falta ajustar la
// animacion se hace alla y se vuelve a copiar; aca solo van los datos de
// KiramoPay y cuando se llama. three se baja con el import() del propio modulo,
// en su bloque aparte: no pesa en la carga inicial.
import { Capacitor } from '@capacitor/core';
// `no-inline`: la Trama SIEMPRE sale como archivo, pese lo que pese (el logo
// limpio pesa menos de los 4 KB que Vite incrusta como data:). La intro la pide
// con fetch(), y el CSP de nginx.conf (`connect-src 'self'`) no deja pasar una
// URL data:. Vale igual en la build y en las pruebas.
import trama from './trama.svg?url&no-inline';
import type { DestinoErgane } from './ergane-intro';

/** Donde se recuerda que este navegador ya la vio (es la clave de siempre del modulo). */
export const CLAVE_INTRO_ERGANE = 'ergane-intro-vista';

/** Cuanto se espera el modulo antes de dejar pintar la app sin intro. */
const ESPERA_MAXIMA_MS = 2500;

// Todo sale del propio codigo: el fondo y las tintas son los del tema oscuro de
// index.css (la app abre oscura), la letra es la de la app y la marca es el
// icono del sitio. Una prueba compara estos colores con los de index.css.
export const DESTINO_KIRAMOPAY: DestinoErgane = {
  nombre: 'KiramoPay',
  area: 'Pagos',
  dominio: 'kiramopay.com',
  marca: { tipo: 'svg', url: '/icon.svg' },
  fondo: '#050B18', // --color-background-dark
  tinta: '#EEF2F8', // --color-text-primary-dark
  tintaSuave: '#A7B4CB', // --color-text-secondary-dark
  fuente: 'var(--font-sans)',
};

function yaLaVio(): boolean {
  try {
    return window.localStorage.getItem(CLAVE_INTRO_ERGANE) === '1';
  } catch {
    return false;
  }
}

function pedidaEnLaUrl(): boolean {
  return new URLSearchParams(window.location.search).get('intro-ergane') === '1';
}

/**
 * Si esta apertura puede mostrar la intro. Solo en la web: en Android e iOS la
 * app instalada ya tiene su propia intro de la K (components/intro) y no se
 * duplica. A quien ya la vio no se le baja ni el modulo. Lo demas (menos
 * movimiento, sin WebGL, un three que tarda) lo resuelve el propio modulo.
 */
export function laIntroDeErganeAplica(): boolean {
  if (typeof window === 'undefined') return false;
  if (Capacitor.isNativePlatform()) return false;
  return pedidaEnLaUrl() || !yaLaVio();
}

/**
 * Arma la capa de la intro ANTES de que la app pinte su primer cuadro: la
 * pantalla de arranque o el login quedan debajo y nunca se ven ni un instante
 * antes. Resuelve cuando la capa ya esta puesta, o sin intro si el modulo no
 * llega a tiempo: la app jamas queda esperando, y una intro tardia no aparece
 * encima de una pantalla que la persona ya esta usando.
 */
export function armarIntroDeErgane(): Promise<void> {
  if (!laIntroDeErganeAplica()) return Promise.resolve();

  let vencida = false;
  let reloj: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<void>((resolver) => {
    reloj = setTimeout(() => {
      vencida = true;
      resolver();
    }, ESPERA_MAXIMA_MS);
  });
  const cargada = import('./ergane-intro.js')
    .then(({ mostrarIntroErgane }) => {
      if (vencida) return;
      // La capa queda puesta en el acto; la promesa solo dice cuando se fue.
      void mostrarIntroErgane({ destino: DESTINO_KIRAMOPAY, marcaErgane: trama, clave: CLAVE_INTRO_ERGANE }).catch(
        () => undefined,
      );
    })
    // Un trozo que no baja no puede dejar la app sin pintar.
    .catch(() => undefined);

  return Promise.race([cargada, tope]).finally(() => clearTimeout(reloj));
}
