import { useEffect, useState } from 'react';
import { getApiLayer } from '@/api';

// Viajes y pedidos se ofrecen solo si el servidor tiene un socio real que
// cotice y entregue (GET /marketplace/availability). En produccion, hoy, no lo
// tiene: el precio y el chofer serian inventados y el cobro se rechaza. Es una
// bandera del servidor, igual para todas las cuentas, asi que se pregunta una
// vez por carga y la comparten el Inicio y la ayuda.
let disponible: boolean | null = null;
let enCamino: Promise<boolean> | null = null;

function consultar(): Promise<boolean> {
  if (disponible !== null) return Promise.resolve(disponible);
  const mercado = getApiLayer().marketplace;
  if (!mercado) return Promise.resolve(false);
  if (!enCamino) {
    enCamino = mercado
      .getAvailability()
      .then((res) => {
        if (res.success && res.data) {
          disponible = res.data.active;
          return disponible;
        }
        // Un fallo no se guarda: la proxima pantalla vuelve a preguntar.
        enCamino = null;
        return false;
      })
      .catch(() => {
        enCamino = null;
        return false;
      });
  }
  return enCamino;
}

/** Solo para pruebas: olvida lo consultado para que cada una empiece de cero. */
export function olvidarMercado(): void {
  disponible = null;
  enCamino = null;
}

/**
 * Si la aplicacion ofrece viajes y pedidos. Mientras no se sabe, no se ofrece:
 * un acceso que llega un instante tarde es mejor que uno que aparece y despues
 * desaparece.
 */
export function useMercadoDisponible(): boolean {
  const [activo, setActivo] = useState<boolean>(disponible ?? false);
  useEffect(() => {
    let vivo = true;
    void consultar().then((a) => {
      if (vivo) setActivo(a);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return activo;
}
