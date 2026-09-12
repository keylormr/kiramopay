import { Capacitor } from '@capacitor/core';
import { getApiLayer } from '@/api';
import {
  activarNativo,
  desactivarNativo,
  leerEstadoNativo,
  sincronizarNativo,
  soltarNativoAlSalir,
} from './avisosNativos';

/**
 * Avisos del sistema (web push) para ESTE dispositivo.
 *
 * Estuvieron muertos desde el principio por tres cosas a la vez: la
 * suscripcion se mandaba sin sesion y con una forma que el servidor no leia,
 * nada en la app llamaba al gancho que la creaba, y la clave publica dependia
 * de una variable del build que nunca se configuro. Ahora la clave la da el
 * servidor, la suscripcion viaja autenticada y Perfil ofrece el interruptor.
 *
 * La WebView de Android no tiene Push API: en el APK los avisos van por FCM
 * (avisosNativos.ts), y solo si el APK se compilo con el archivo de Firebase.
 * Sin eso la pantalla lo dice en vez de ofrecer un interruptor que no hace
 * nada. Este modulo es la unica puerta: decide cual de los dos caminos usar.
 */

export type EstadoAvisos =
  | 'cargando'
  | 'no_soportado' // el navegador o la WebView no tiene Push API
  | 'sin_configurar' // el servidor no tiene claves VAPID
  | 'bloqueado' // el permiso del sitio esta denegado en el navegador
  | 'inactivo'
  | 'activo';

export type ResultadoAvisos = EstadoAvisos | 'fallo';

// Quien activo los avisos en este dispositivo. Hace falta porque la recarga de
// emergencia de version (recargarSaltandoCaches) desregistra el service worker,
// y con el se va la suscripcion: al arrancar se rehace, pero solo para la
// cuenta que la habia pedido. Otra cuenta que entre en el mismo navegador no
// hereda avisos que no pidio.
const MARCA = 'kiramopay_avisos_push';

// navigator.serviceWorker.ready no rechaza nunca: si el service worker no llego
// a registrarse, espera para siempre y el interruptor quedaba girando.
const ESPERA_SW_MS = 10_000;

// El endpoint de este dispositivo, en memoria. El cierre de sesion lo necesita
// de forma sincronica: la baja en el servidor tiene que salir antes de que se
// borre el token.
let endpointActual: string | null = null;

function webPushDisponible(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'PushManager' in window &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator
  );
}

/**
 * Por donde llegan los avisos en esta instalacion. En la app nativa solo hay
 * avisos si el APK trae Firebase: se lee en cada llamada (no al cargar el
 * modulo) para que las pruebas puedan alternarlo.
 */
export function modoDeAvisos(): 'web' | 'nativo' | 'ninguno' {
  if (Capacitor.isNativePlatform()) {
    return Capacitor.getPlatform() === 'android' && import.meta.env.VITE_PUSH_NATIVO === '1'
      ? 'nativo'
      : 'ninguno';
  }
  return webPushDisponible() ? 'web' : 'ninguno';
}

export function avisosSoportados(): boolean {
  return modoDeAvisos() !== 'ninguno';
}

function leerMarca(): string | null {
  try {
    return localStorage.getItem(MARCA);
  } catch {
    return null;
  }
}

function guardarMarca(userId: string): void {
  try {
    localStorage.setItem(MARCA, userId);
  } catch {
    // Sin almacenamiento: los avisos funcionan igual; solo no se rehacen solos.
  }
}

function borrarMarca(): void {
  try {
    localStorage.removeItem(MARCA);
  } catch {
    // nada que borrar
  }
}

async function registro(): Promise<ServiceWorkerRegistration | null> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  const limite = new Promise<null>((resolver) => {
    temporizador = setTimeout(() => resolver(null), ESPERA_SW_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, limite]);
  } finally {
    clearTimeout(temporizador);
  }
}

/** Clave VAPID en base64url a los bytes que pide pushManager.subscribe. */
export function claveABytes(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const crudo = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(crudo.length));
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
  return bytes;
}

function mismaClave(sub: PushSubscription, clave: Uint8Array): boolean {
  const actual = sub.options?.applicationServerKey;
  // Si el navegador no la expone no hay como comparar: se conserva.
  if (!actual) return true;
  const a = new Uint8Array(actual);
  return a.length === clave.length && a.every((b, i) => b === clave[i]);
}

async function suscribir(reg: ServiceWorkerRegistration, clave: Uint8Array<ArrayBuffer>): Promise<PushSubscription> {
  let sub = await reg.pushManager.getSubscription();
  if (sub && !mismaClave(sub, clave)) {
    // El servidor cambio de clave: una suscripcion hecha con la vieja ya no
    // acepta envios firmados con la nueva.
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: clave });
}

async function registrarEnServidor(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON();
  const auth = json.keys?.auth ?? '';
  const p256dh = json.keys?.p256dh ?? '';
  if (!json.endpoint || !auth || !p256dh) return false;
  const res = await getApiLayer().notifications.subscribePush({ endpoint: json.endpoint, auth, p256dh });
  return res.success;
}

async function claveDelServidor(): Promise<{ clave: string; habilitado: boolean } | null> {
  const res = await getApiLayer().notifications.pushPublicKey();
  if (!res.success || !res.data) return null;
  return { clave: res.data.publicKey, habilitado: res.data.habilitado };
}

/**
 * Lo que la pantalla tiene que mostrar, y la clave para activar sin esperar
 * al servidor en el momento del toque.
 */
export async function leerEstadoAvisos(userId: string): Promise<{ estado: EstadoAvisos; clave: string }> {
  const modo = modoDeAvisos();
  if (modo === 'ninguno') return { estado: 'no_soportado', clave: '' };
  if (modo === 'nativo') return { estado: await leerEstadoNativo(userId), clave: '' };
  const datos = await claveDelServidor();
  // Si la consulta fallo no se sabe si esta configurado: se ofrece, y activar
  // vuelve a pedir la clave.
  if (!datos) return { estado: 'inactivo', clave: '' };
  if (!datos.habilitado) return { estado: 'sin_configurar', clave: '' };
  if (Notification.permission === 'denied') return { estado: 'bloqueado', clave: datos.clave };
  if (Notification.permission !== 'granted' || leerMarca() !== userId) {
    return { estado: 'inactivo', clave: datos.clave };
  }
  const reg = await registro();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return { estado: 'inactivo', clave: datos.clave };
  endpointActual = sub.endpoint;
  return { estado: 'activo', clave: datos.clave };
}

/**
 * Activa los avisos en este dispositivo para la cuenta en sesion. Hay que
 * llamarla desde el toque del usuario: pide el permiso antes que cualquier
 * otra espera, porque Safari y Firefox solo lo conceden dentro del gesto.
 */
export async function activarAvisos(clave: string, userId: string): Promise<ResultadoAvisos> {
  const modo = modoDeAvisos();
  if (modo === 'ninguno') return 'no_soportado';
  if (modo === 'nativo') return activarNativo(userId);
  try {
    const permiso =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    if (permiso === 'denied') return 'bloqueado';
    if (permiso !== 'granted') return 'inactivo';

    let claveUsada = clave;
    if (!claveUsada) {
      const datos = await claveDelServidor();
      if (!datos) return 'fallo';
      if (!datos.habilitado) return 'sin_configurar';
      claveUsada = datos.clave;
    }

    const reg = await registro();
    if (!reg) return 'fallo';
    const sub = await suscribir(reg, claveABytes(claveUsada));
    if (!(await registrarEnServidor(sub))) {
      // Sin la fila en el servidor no llega ningun aviso: se suelta la
      // suscripcion para que la pantalla no diga "activados" sobre algo que
      // no funciona.
      await sub.unsubscribe().catch(() => false);
      return 'fallo';
    }
    endpointActual = sub.endpoint;
    guardarMarca(userId);
    return 'activo';
  } catch {
    return 'fallo';
  }
}

/** Apaga los avisos en este dispositivo. */
export async function desactivarAvisos(): Promise<ResultadoAvisos> {
  const modo = modoDeAvisos();
  if (modo === 'nativo') return desactivarNativo();
  borrarMarca();
  endpointActual = null;
  if (modo === 'ninguno') return 'no_soportado';
  try {
    const reg = await registro();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      // Primero el servidor, con la sesion viva; despues el navegador. Si el
      // servidor falla basta la baja en el navegador: el siguiente envio
      // recibe 410 y el servidor borra la fila solo.
      await getApiLayer().notifications.unsubscribePush(sub.endpoint);
      await sub.unsubscribe();
    }
    return 'inactivo';
  } catch {
    return 'fallo';
  }
}

/**
 * Al arrancar con sesion: si esta cuenta habia activado los avisos en este
 * dispositivo, se asegura de que la suscripcion exista y de que el servidor la
 * tenga. Cubre la suscripcion perdida en una recarga de version y la clave
 * rotada en el servidor. No pide permiso ni suscribe a quien no lo pidio.
 */
export async function sincronizarAvisos(userId: string): Promise<void> {
  const modo = modoDeAvisos();
  if (modo === 'nativo') return sincronizarNativo(userId);
  if (modo === 'ninguno' || Notification.permission !== 'granted') return;
  if (leerMarca() !== userId) return;
  try {
    const datos = await claveDelServidor();
    if (!datos?.habilitado) return;
    const reg = await registro();
    if (!reg) return;
    const sub = await suscribir(reg, claveABytes(datos.clave));
    if (await registrarEnServidor(sub)) endpointActual = sub.endpoint;
  } catch {
    // Se reintenta en el proximo arranque.
  }
}

/**
 * Al cerrar sesion: los avisos de una cuenta no siguen llegando a un
 * dispositivo del que esa cuenta salio. Traen montos y nombres.
 *
 * La baja en el servidor sale en esta misma llamada, sincronica, para que la
 * peticion lleve el token antes de que el cierre de sesion lo borre. La baja
 * en el navegador va despues y es la que de verdad garantiza el corte.
 *
 * avisarAlServidor = false cuando la sesion ya murio (cuenta bloqueada): el
 * servidor ya borro las filas y la peticion solo volveria con 401.
 */
export function soltarAvisosAlSalir(avisarAlServidor = true): void {
  if (modoDeAvisos() === 'nativo') {
    soltarNativoAlSalir(avisarAlServidor);
    return;
  }
  borrarMarca();
  const endpoint = endpointActual;
  endpointActual = null;
  if (endpoint && avisarAlServidor) {
    void getApiLayer()
      .notifications.unsubscribePush(endpoint)
      .catch(() => undefined);
  }
  if (!webPushDisponible()) return;
  void (async () => {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
    } catch {
      // Si el navegador no deja, el servidor ya no tiene la fila.
    }
  })();
}

/** Solo para pruebas: el endpoint en memoria entre una prueba y otra. */
export function reiniciarAvisosParaPruebas(): void {
  endpointActual = null;
}
