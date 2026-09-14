/**
 * Capas abiertas (hojas, pantallas completas, pestanas) y su espejo en el
 * historial del navegador.
 *
 * La aplicacion no tiene rutas: pestanas, pantallas y hojas son estado de React.
 * Nada tocaba `window.history`, asi que el documento ocupaba UNA sola entrada y
 * el boton Atras del navegador (o el gesto de retroceso del telefono) sacaba de
 * la aplicacion desde cualquier punto — en una pestana nueva, a una pagina en
 * blanco, incluso con la confirmacion de un envio abierta. El boton fisico de
 * Android ya tenia un arreglo propio, pero no conocia las hojas de cada vista.
 *
 * Aqui cada capa abierta se apila y la pila se refleja en el historial: una
 * entrada por capa. Atras cierra la capa de arriba (sin enviar nada: cierra como
 * lo haria "Cancelar"); con la pila vacia el navegador sale como siempre.
 *
 * Reglas que sostienen esto:
 *  - El historial se reconcilia por CANTIDAD, en un microtask. Cerrar una hoja y
 *    abrir otra en el mismo toque (confirmar -> exito) no toca el historial.
 *    `history.back()` es asincrono: un `pushState` inmediatamente despues se
 *    aplica ANTES del retroceso y el retroceso se lleva la entrada nueva
 *    (comprobado en Chrome). Por eso, mientras hay un retroceso propio en vuelo,
 *    no se escribe nada hasta que llega su `popstate`.
 *  - Cerrar por la X (o por cualquier via propia) consume la entrada: no quedan
 *    entradas huerfanas que obliguen a tocar Atras dos veces.
 *  - Una capa que no se puede cerrar (una hoja con una operacion en vuelo)
 *    detiene el retroceso y su entrada se repone.
 *  - Recargar en medio de una pantalla deja entradas de la carga anterior; al
 *    arrancar se vuelve a la base (en Chrome es un recorrido del mismo documento,
 *    sin recargar).
 *  - Escape cierra la hoja o la pantalla de arriba. Las pestanas y las secciones
 *    con datos a medio llenar (el registro) solo responden a Atras.
 */
import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';

/**
 * hoja: BottomSheet. pantalla: vista de pantalla completa (Escape la cierra).
 * seccion: cambio de pestana o flujo largo; Atras la cierra, Escape no.
 */
export type TipoCapa = 'hoja' | 'pantalla' | 'seccion';

interface Capa {
  id: number;
  tipo: TipoCapa;
  cerrar: () => void;
  puedeCerrar: () => boolean;
  /** Se le pidio cerrarse (Atras o Escape) y todavia no se desmonto. */
  cerrando: boolean;
}

const CLAVE_ESTADO = 'kiramopayCapas';
// Cota para un popstate propio que no llega (historial no disponible, pestana
// en segundo plano). Pasada, se toma lo que diga el historial y no se reintenta.
const ESPERA_POP_MS = 1000;
// Cota para una capa a la que se le pidio cerrarse y siguio abierta: su onClose
// decidio no cerrar. Vuelve a contar y su entrada se repone.
const ESPERA_CIERRE_MS = 500;

const pila: Capa[] = [];
let siguienteId = 1;
let profundidad = 0;
let esperandoPop = false;
let temporizadorPop: ReturnType<typeof setTimeout> | undefined;
let sincronizacionProgramada = false;
let instalada = false;

function hayHistorial(): boolean {
  return typeof window !== 'undefined' && typeof window.history?.pushState === 'function';
}

function profundidadDe(estado: unknown): number {
  if (!estado || typeof estado !== 'object') return 0;
  const valor = (estado as Record<string, unknown>)[CLAVE_ESTADO];
  return typeof valor === 'number' && Number.isInteger(valor) && valor > 0 ? valor : 0;
}

function capasVivas(): Capa[] {
  return pila.filter((c) => !c.cerrando);
}

function programarSincronizacion(): void {
  if (sincronizacionProgramada) return;
  sincronizacionProgramada = true;
  queueMicrotask(sincronizar);
}

function sincronizar(): void {
  sincronizacionProgramada = false;
  if (!hayHistorial() || esperandoPop) return;
  const objetivo = capasVivas().length;
  if (objetivo > profundidad) {
    for (let d = profundidad + 1; d <= objetivo; d++) {
      window.history.pushState({ [CLAVE_ESTADO]: d }, '');
    }
    profundidad = objetivo;
  } else if (objetivo < profundidad) {
    esperandoPop = true;
    clearTimeout(temporizadorPop);
    temporizadorPop = setTimeout(() => {
      esperandoPop = false;
      profundidad = profundidadDe(window.history.state);
    }, ESPERA_POP_MS);
    window.history.go(objetivo - profundidad);
  }
}

function solicitarCierre(capa: Capa): void {
  capa.cerrando = true;
  capa.cerrar();
  setTimeout(() => {
    if (capa.cerrando && pila.includes(capa)) {
      capa.cerrando = false;
      programarSincronizacion();
    }
  }, ESPERA_CIERRE_MS);
}

/** Cierra, desde arriba, las capas que sobran para quedar en `cuantas`. */
function cerrarHasta(cuantas: number): void {
  const vivas = capasVivas();
  for (let i = vivas.length - 1; i >= cuantas; i--) {
    const capa = vivas[i];
    if (!capa.puedeCerrar()) break;
    solicitarCierre(capa);
  }
}

function alCambiarHistorial(evento: PopStateEvent): void {
  profundidad = profundidadDe(evento.state);
  if (esperandoPop) {
    // El retroceso lo pidio la pila (una capa se cerro por su cuenta).
    esperandoPop = false;
    clearTimeout(temporizadorPop);
    programarSincronizacion();
    return;
  }
  // Atras (o Adelante) de la persona. Adelante no reabre nada: la
  // sincronizacion devuelve el historial a donde esta la pila.
  cerrarHasta(profundidad);
  programarSincronizacion();
}

function alTeclear(evento: KeyboardEvent): void {
  if (evento.key !== 'Escape' || evento.defaultPrevented || evento.isComposing) return;
  const candidatas = capasVivas().filter((c) => c.tipo !== 'seccion');
  const capa = candidatas[candidatas.length - 1];
  if (!capa || !capa.puedeCerrar()) return;
  evento.preventDefault();
  solicitarCierre(capa);
  programarSincronizacion();
}

/** Idempotente. La registra la aplicacion al montar y cualquier capa por las dudas. */
export function instalarNavegacionPorCapas(): void {
  if (instalada || !hayHistorial()) return;
  instalada = true;
  profundidad = profundidadDe(window.history.state);
  window.addEventListener('popstate', alCambiarHistorial);
  document.addEventListener('keydown', alTeclear);
  // Recarga con capas abiertas: sus entradas quedaron de la carga anterior.
  if (profundidad > 0) programarSincronizacion();
}

export function registrarCapa(
  tipo: TipoCapa,
  cerrar: () => void,
  puedeCerrar: () => boolean = () => true,
): { id: number; quitar: () => void } {
  instalarNavegacionPorCapas();
  const capa: Capa = { id: siguienteId++, tipo, cerrar, puedeCerrar, cerrando: false };
  pila.push(capa);
  programarSincronizacion();
  return {
    id: capa.id,
    quitar: () => {
      const i = pila.indexOf(capa);
      if (i === -1) return;
      pila.splice(i, 1);
      programarSincronizacion();
    },
  };
}

/** La hoja abierta mas reciente: la unica que atrapa el foco del teclado. */
export function esHojaSuperior(id: number): boolean {
  for (let i = pila.length - 1; i >= 0; i--) {
    const capa = pila[i];
    if (capa.tipo === 'hoja' && !capa.cerrando) return capa.id === id;
  }
  return false;
}

/**
 * Atras programatico (boton fisico de Android). Devuelve false cuando no hay
 * nada abierto, para que quien llama decida salir.
 */
export function retroceder(): boolean {
  const vivas = capasVivas().length;
  if (vivas === 0) return false;
  if (hayHistorial() && profundidad > 0 && !esperandoPop) {
    window.history.back();
  } else {
    cerrarHasta(vivas - 1);
    programarSincronizacion();
  }
  return true;
}

const siempre = () => true;

/**
 * Registra una capa mientras `abierta` sea verdadero. Devuelve una ref con su id
 * (0 mientras esta cerrada).
 *
 * Pantallas y secciones se registran en un efecto de layout y las hojas en uno
 * pasivo: en un mismo commit todos los de layout corren antes que los pasivos,
 * asi una pantalla que se abre con su hoja interna ya montada queda DEBAJO de
 * esa hoja, que es el orden en que se ven.
 *
 * `clave`: un flujo por pasos (el registro) pasa el paso actual. Al cambiar, la
 * capa se vuelve a registrar en el mismo commit — el historial no se mueve — y
 * un Atras que retrocede un paso deja la capa abierta con su entrada repuesta,
 * listo para el siguiente Atras.
 */
export function useCapa(
  abierta: boolean,
  tipo: TipoCapa,
  cerrar: () => void,
  puedeCerrar: () => boolean = siempre,
  clave?: string | number,
): MutableRefObject<number> {
  const cerrarRef = useRef(cerrar);
  const puedeCerrarRef = useRef(puedeCerrar);
  const idRef = useRef(0);

  useLayoutEffect(() => {
    cerrarRef.current = cerrar;
    puedeCerrarRef.current = puedeCerrar;
  });

  const enLayout = tipo !== 'hoja';

  useLayoutEffect(() => {
    if (!enLayout || !abierta) return;
    const { id, quitar } = registrarCapa(tipo, () => cerrarRef.current(), () => puedeCerrarRef.current());
    idRef.current = id;
    return () => {
      quitar();
      idRef.current = 0;
    };
  }, [abierta, tipo, enLayout, clave]);

  useEffect(() => {
    if (enLayout || !abierta) return;
    const { id, quitar } = registrarCapa(tipo, () => cerrarRef.current(), () => puedeCerrarRef.current());
    idRef.current = id;
    return () => {
      quitar();
      idRef.current = 0;
    };
  }, [abierta, tipo, enLayout, clave]);

  return idRef;
}
