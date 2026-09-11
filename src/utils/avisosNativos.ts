import { PushNotifications } from '@capacitor/push-notifications';
import type { PluginListenerHandle } from '@capacitor/core';
import { getApiLayer } from '@/api';
import type { EstadoAvisos, ResultadoAvisos } from './avisosPush';

/**
 * Avisos de la app instalada en Android, por Firebase Cloud Messaging.
 *
 * La WebView no tiene Push API: el web push nunca llega al APK. Aqui el
 * telefono se registra en FCM, recibe un token y se lo da al servidor, que
 * entrega por la API HTTP v1.
 *
 * Solo se usa cuando el APK se compilo con el archivo de Firebase
 * (VITE_PUSH_NATIVO=1, ver android-apk.yml): sin google-services.json,
 * PushNotifications.register() cierra la app en Android.
 */

// El canal de Android donde caen los avisos. Visibilidad privada: en una
// pantalla de bloqueo con clave el aviso aparece sin el texto, porque trae
// montos y nombres. El usuario puede cambiarlo en los ajustes del sistema.
const CANAL = 'avisos';
const IMPORTANCIA_ALTA = 4;
const VISIBILIDAD_PRIVADA = 0;

// FCM puede tardar en entregar el token la primera vez; sin cota el
// interruptor quedaba girando si nunca llegaba.
const ESPERA_REGISTRO_MS = 15_000;

const MARCA = 'kiramopay_avisos_push';

// El token de este telefono, en memoria: el cierre de sesion lo necesita de
// forma sincronica, antes de que se borre el token de sesion.
let tokenActual: string | null = null;

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
    // sin almacenamiento: funciona igual, solo no se rehace solo
  }
}

function borrarMarca(): void {
  try {
    localStorage.removeItem(MARCA);
  } catch {
    // nada que borrar
  }
}

async function asegurarCanal(): Promise<void> {
  await PushNotifications.createChannel({
    id: CANAL,
    name: 'KiramoPay',
    importance: IMPORTANCIA_ALTA,
    visibility: VISIBILIDAD_PRIVADA,
    vibration: true,
  }).catch(() => undefined);
}

/** Registra el telefono en FCM y espera el token, con cota. */
async function obtenerToken(): Promise<string | null> {
  const escuchas: PluginListenerHandle[] = [];
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<string | null>((resolver) => {
      void (async () => {
        temporizador = setTimeout(() => resolver(null), ESPERA_REGISTRO_MS);
        // Las escuchas primero: el evento puede llegar apenas se llama a
        // register().
        escuchas.push(await PushNotifications.addListener('registration', (t) => resolver(t.value || null)));
        escuchas.push(await PushNotifications.addListener('registrationError', () => resolver(null)));
        await PushNotifications.register().catch(() => resolver(null));
      })();
    });
  } finally {
    clearTimeout(temporizador);
    for (const e of escuchas) void e.remove();
  }
}

async function nativoHabilitadoEnServidor(): Promise<boolean | null> {
  const res = await getApiLayer().notifications.pushNativo();
  if (!res.success || !res.data) return null;
  return res.data.habilitado;
}

export async function leerEstadoNativo(userId: string): Promise<EstadoAvisos> {
  const habilitado = await nativoHabilitadoEnServidor();
  if (habilitado === null) return 'inactivo';
  if (!habilitado) return 'sin_configurar';
  const permiso = await PushNotifications.checkPermissions();
  if (permiso.receive === 'denied') return 'bloqueado';
  if (permiso.receive !== 'granted' || leerMarca() !== userId) return 'inactivo';
  return 'activo';
}

export async function activarNativo(userId: string): Promise<ResultadoAvisos> {
  try {
    const permiso = await PushNotifications.requestPermissions();
    if (permiso.receive === 'denied') return 'bloqueado';
    if (permiso.receive !== 'granted') return 'inactivo';
    await asegurarCanal();
    const token = await obtenerToken();
    if (!token) return 'fallo';
    const res = await getApiLayer().notifications.registrarDispositivo({ token, plataforma: 'android' });
    if (!res.success) {
      return res.error?.code === 'NATIVE_PUSH_DISABLED' ? 'sin_configurar' : 'fallo';
    }
    tokenActual = token;
    guardarMarca(userId);
    return 'activo';
  } catch {
    return 'fallo';
  }
}

export async function desactivarNativo(): Promise<ResultadoAvisos> {
  borrarMarca();
  try {
    // Si la app se reinicio y la sincronizacion no termino, el token no esta
    // en memoria: se vuelve a pedir (FCM devuelve el mismo) para darlo de baja.
    const token = tokenActual ?? (await obtenerToken());
    tokenActual = null;
    if (token) await getApiLayer().notifications.olvidarDispositivo(token);
    // unregister borra el token en FCM: aunque el servidor no se enterara, el
    // siguiente envio recibe UNREGISTERED y la fila se borra sola.
    await PushNotifications.unregister();
    return 'inactivo';
  } catch {
    return 'fallo';
  }
}

/** Al arrancar: el token puede rotar; se le da el vigente al servidor. */
export async function sincronizarNativo(userId: string): Promise<void> {
  if (leerMarca() !== userId) return;
  try {
    const permiso = await PushNotifications.checkPermissions();
    if (permiso.receive !== 'granted') return;
    if (!(await nativoHabilitadoEnServidor())) return;
    await asegurarCanal();
    const token = await obtenerToken();
    if (!token) return;
    const res = await getApiLayer().notifications.registrarDispositivo({ token, plataforma: 'android' });
    if (res.success) tokenActual = token;
  } catch {
    // se reintenta en el proximo arranque
  }
}

/** Ver soltarAvisosAlSalir en avisosPush: misma regla, mismo orden. */
export function soltarNativoAlSalir(avisarAlServidor: boolean): void {
  const habiaActivado = leerMarca() !== null || tokenActual !== null;
  borrarMarca();
  const token = tokenActual;
  tokenActual = null;
  if (token && avisarAlServidor) {
    void getApiLayer()
      .notifications.olvidarDispositivo(token)
      .catch(() => undefined);
  }
  // Solo si habia avisos: a quien nunca los activo no se le toca FCM.
  if (habiaActivado) void PushNotifications.unregister().catch(() => undefined);
}

/** Solo para pruebas. */
export function reiniciarNativoParaPruebas(): void {
  tokenActual = null;
}
