import { useEffect, useState } from 'react';
import { getApiLayer } from '@/api';
import { useAuthStore } from '@/stores/auth.store';
import type { PlanPersonal, Tarifas } from '@/api/repositories/plans.repository';
import { TARIFAS_POR_DEFECTO, normalizarPlan } from '@/utils/planes';

// Las tarifas son publicas y cambian solo con un despliegue: se piden una vez
// por carga de la aplicacion y las comparten todas las pantallas.
let tarifasCargadas: Tarifas | null = null;
let tarifasEnCamino: Promise<Tarifas> | null = null;

function cargarTarifas(): Promise<Tarifas> {
  if (tarifasCargadas) return Promise.resolve(tarifasCargadas);
  const planes = getApiLayer().plans;
  if (!planes?.getTarifas) return Promise.resolve(TARIFAS_POR_DEFECTO);
  if (!tarifasEnCamino) {
    tarifasEnCamino = planes
      .getTarifas()
      .then((res) => {
        if (res.success && res.data) {
          tarifasCargadas = res.data;
          return res.data;
        }
        // Un fallo no se guarda: la proxima pantalla vuelve a preguntar.
        tarifasEnCamino = null;
        return TARIFAS_POR_DEFECTO;
      })
      .catch(() => {
        tarifasEnCamino = null;
        return TARIFAS_POR_DEFECTO;
      });
  }
  return tarifasEnCamino;
}

/** Solo para pruebas: olvida lo cargado para que cada una empiece de cero. */
export function olvidarTarifas(): void {
  tarifasCargadas = null;
  tarifasEnCamino = null;
}

/**
 * Tarifas y topes vigentes. Devuelve el respaldo decidido por el dueno mientras
 * carga, y lo que publica el servidor en cuanto llega.
 */
export function useTarifas(): Tarifas {
  const [tarifas, setTarifas] = useState<Tarifas>(tarifasCargadas ?? TARIFAS_POR_DEFECTO);
  useEffect(() => {
    let vivo = true;
    void cargarTarifas().then((t) => {
      if (vivo) setTarifas(t);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return tarifas;
}

let ultimaSincronizacion = 0;
const SINCRONIZAR_CADA_MS = 60000;

/**
 * El plan personal de quien usa la aplicacion.
 *
 * El perfil se guarda al entrar, y un administrador puede cambiar el plan de
 * un piloto con la sesion abierta: sin volver a preguntar, la pantalla le diria
 * a alguien recien pasado a Plus que llego al tope de Gratis. Por eso, al
 * montarse, relee /users/me (a lo sumo una vez por minuto) y corrige solo el
 * plan si cambio.
 */
export function usePlanPersonal(): PlanPersonal {
  const plan = useAuthStore((s) => s.user?.plan);
  useEffect(() => {
    const ahora = Date.now();
    if (ahora - ultimaSincronizacion < SINCRONIZAR_CADA_MS) return;
    const auth = getApiLayer().auth;
    if (!auth?.getProfile) return;
    ultimaSincronizacion = ahora;
    void auth
      .getProfile()
      .then((res) => {
        const nuevo = res.success ? res.data?.plan : undefined;
        if (!nuevo) return;
        useAuthStore.setState((s) =>
          s.user && s.user.plan !== nuevo ? { user: { ...s.user, plan: nuevo } } : {},
        );
      })
      .catch(() => {});
  }, []);
  return normalizarPlan(plan);
}
