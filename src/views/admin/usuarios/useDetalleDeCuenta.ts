import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiLayer } from '@/api';
import type { EventoDeHistorial } from '@/api/repositories/admin.repository';
import type { DeviceSession } from '@/api/repositories/sessions.repository';

export interface Carga<T> {
  cargando: boolean;
  /** Codigo del error; se traduce al pintar. */
  error: string | null;
  datos: T;
}

/** La ultima respuesta, con la cuenta a la que pertenece. */
interface Respuesta<T> {
  userId: string;
  error: string | null;
  datos: T;
}

/**
 * El servidor escribe la auditoria en segundo plano y la vacia cada dos
 * segundos: el historial se vuelve a pedir un poco despues de cada accion para
 * que lo recien hecho aparezca sin que el administrador tenga que recargar. Hay
 * un segundo intento por si el vaciado se atrasa con el servidor cargado.
 */
export const ESPERA_DEL_RASTRO_MS = 2500;
const RECARGAS_DEL_RASTRO_MS = [ESPERA_DEL_RASTRO_MS, 6000];
/** Mientras dura esta ventana, volver a una cuenta reprograma las recargas. */
const VENTANA_DEL_RASTRO_MS = RECARGAS_DEL_RASTRO_MS[RECARGAS_DEL_RASTRO_MS.length - 1];

/** "Cargando" no se guarda: es no tener todavia la respuesta de ESTA cuenta. */
function comoCarga<T>(r: Respuesta<T[]> | null, userId: string | null): Carga<T[]> {
  if (r && userId !== null && r.userId === userId) return { cargando: false, error: r.error, datos: r.datos };
  return { cargando: userId !== null, error: null, datos: [] };
}

async function traerSesiones(id: string): Promise<Respuesta<DeviceSession[]> | null> {
  const api = getApiLayer();
  if (!api.admin) return null;
  try {
    const res = await api.admin.listUserSessions(id);
    return res.success
      ? { userId: id, error: null, datos: res.data ?? [] }
      : { userId: id, error: res.error?.code || 'SESSIONS_FAILED', datos: [] };
  } catch {
    return { userId: id, error: 'SESSIONS_FAILED', datos: [] };
  }
}

async function traerHistorial(id: string): Promise<Respuesta<EventoDeHistorial[]> | null> {
  const api = getApiLayer();
  if (!api.admin) return null;
  try {
    const res = await api.admin.userHistory(id);
    return res.success
      ? { userId: id, error: null, datos: res.data ?? [] }
      : { userId: id, error: res.error?.code || 'HISTORY_FAILED', datos: [] };
  } catch {
    return { userId: id, error: 'HISTORY_FAILED', datos: [] };
  }
}

/**
 * Las sesiones abiertas y el historial de la cuenta que se esta mirando. Al
 * cambiar de cuenta se piden de nuevo, y una respuesta que llega tarde (de la
 * cuenta anterior) se descarta: el detalle nunca mezcla dos personas.
 *
 * Las acciones dicen sobre que cuenta actuan; si ya no es la que se mira, no
 * tocan lo que se ve (al volver se pide todo de nuevo).
 */
export function useDetalleDeCuenta(userId: string | null) {
  const [sesionesR, setSesionesR] = useState<Respuesta<DeviceSession[]> | null>(null);
  const [historialR, setHistorialR] = useState<Respuesta<EventoDeHistorial[]> | null>(null);
  const mirando = useRef<string | null>(null);
  const temporizadores = useRef<number[]>([]);
  // Cada pedido de sesiones lleva un numero; un cambio local (quitar una fila,
  // vaciar tras bloquear) sube el numero y la respuesta que estaba en vuelo,
  // anterior a ese cambio, ya no se pinta encima.
  const secuenciaSesiones = useRef(0);
  // Cuando se actuo por ultima vez sobre cada cuenta.
  const ultimaAccion = useRef(new Map<string, number>());

  const pedirSesiones = useCallback(async (id: string) => {
    const n = ++secuenciaSesiones.current;
    const r = await traerSesiones(id);
    if (r && mirando.current === id && secuenciaSesiones.current === n) setSesionesR(r);
  }, []);

  // silencioso: la recarga despues de una accion no cambia lo que ya se ve si falla.
  const pedirHistorial = useCallback(async (id: string, silencioso = false) => {
    const r = await traerHistorial(id);
    if (!r || mirando.current !== id || (silencioso && r.error)) return;
    setHistorialR(r);
  }, []);

  const cancelarRecargas = useCallback(() => {
    for (const t of temporizadores.current) window.clearTimeout(t);
    temporizadores.current = [];
  }, []);

  const programarRecargas = useCallback((id: string) => {
    cancelarRecargas();
    temporizadores.current = RECARGAS_DEL_RASTRO_MS.map((ms) =>
      window.setTimeout(() => { void pedirHistorial(id, true); }, ms),
    );
  }, [cancelarRecargas, pedirHistorial]);

  useEffect(() => {
    mirando.current = userId;
    cancelarRecargas();
    if (userId) {
      // El estado se toca solo cuando llega la respuesta, y solo si sigue
      // siendo la cuenta que se mira y nada local la cambio mientras tanto.
      const n = ++secuenciaSesiones.current;
      void traerSesiones(userId).then((r) => {
        if (r && mirando.current === userId && secuenciaSesiones.current === n) setSesionesR(r);
      });
      void traerHistorial(userId).then((r) => { if (r && mirando.current === userId) setHistorialR(r); });
      // Se actuo sobre esta cuenta hace un momento, se fue a otra y se volvio:
      // el pedido de recien pudo salir antes de que el rastro se escribiera.
      const antes = ultimaAccion.current.get(userId);
      if (antes !== undefined && Date.now() - antes < VENTANA_DEL_RASTRO_MS) programarRecargas(userId);
    }
    return () => {
      mirando.current = null;
      cancelarRecargas();
    };
  }, [userId, cancelarRecargas, programarRecargas]);

  /** Pide el historial de nuevo cuando el rastro ya tuvo tiempo de escribirse. */
  const recargarHistorialLuego = useCallback((id: string) => {
    ultimaAccion.current.set(id, Date.now());
    if (mirando.current === id) programarRecargas(id);
  }, [programarRecargas]);

  const quitarSesion = useCallback((id: string, sid: string) => {
    if (mirando.current !== id) return;
    secuenciaSesiones.current++;
    setSesionesR((r) => (r && r.userId === id ? { ...r, datos: r.datos.filter((x) => x.id !== sid) } : r));
  }, []);

  const vaciarSesiones = useCallback((id: string) => {
    if (mirando.current !== id) return;
    secuenciaSesiones.current++;
    setSesionesR({ userId: id, error: null, datos: [] });
  }, []);

  const reintentarSesiones = useCallback(() => {
    const id = mirando.current;
    if (!id) return;
    setSesionesR(null);
    void pedirSesiones(id);
  }, [pedirSesiones]);

  const reintentarHistorial = useCallback(() => {
    const id = mirando.current;
    if (!id) return;
    setHistorialR(null);
    void pedirHistorial(id);
  }, [pedirHistorial]);

  return {
    sesiones: comoCarga(sesionesR, userId),
    historial: comoCarga(historialR, userId),
    quitarSesion,
    vaciarSesiones,
    reintentarSesiones,
    reintentarHistorial,
    recargarHistorialLuego,
  };
}
