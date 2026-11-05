import { useEffect, useState } from 'react';
import { getApiLayer } from '@/api';

/**
 * Lo que se sabe del titular registrado de un telefono.
 *
 * `no_se_pudo` es TODO lo que no es una respuesta clara: sin red, limite de
 * consultas, la base caida, una cuenta sin nombre, la capa de SINPE ausente.
 * Jamas se traduce a `sin_cuenta`: un fallo no dice que el numero no tenga
 * cuenta, y la pantalla no debe bloquear un envio por eso.
 */
export type DestinatarioRegistrado =
  | { fase: 'no_aplica' }
  | { fase: 'consultando' }
  | { fase: 'registrado'; nombre: string }
  | { fase: 'sin_cuenta' }
  | { fase: 'no_se_pudo' };

type Respuesta = { telefono: string; resultado: Exclude<DestinatarioRegistrado, { fase: 'no_aplica' | 'consultando' }> };

/**
 * Pregunta al servidor como se llama, registrada en KiramoPay, la persona de un
 * telefono ESCANEADO. Con `null` no pregunta nada: el telefono de un contacto
 * que la persona ya guardo, o uno tecleado a mano, es un acto suyo y no se
 * consulta (cada consulta es un dato personal que sale del servidor).
 *
 * La fase es DERIVADA y no un useState: la consulta arranca en un efecto,
 * despues del primer pintado, y un estado guardado dejaba un cuadro sin "estoy
 * consultando" antes de saber el titular. La respuesta se guarda con el telefono
 * al que contesta: la de un telefono anterior que llega tarde no pisa a la nueva.
 */
export function useDestinatarioRegistrado(telefono: string | null): DestinatarioRegistrado {
  const [respuesta, setRespuesta] = useState<Respuesta | null>(null);

  useEffect(() => {
    if (!telefono) return;
    let cancelado = false;
    const guardar = (resultado: Respuesta['resultado']) => {
      if (!cancelado) setRespuesta({ telefono, resultado });
    };
    (async () => {
      try {
        const sinpe = getApiLayer().sinpe;
        if (!sinpe?.lookupRecipient) return guardar({ fase: 'no_se_pudo' });
        const res = await sinpe.lookupRecipient(telefono);
        if (!res.success || !res.data) return guardar({ fase: 'no_se_pudo' });
        if (!res.data.registered) return guardar({ fase: 'sin_cuenta' });
        if (!res.data.displayName) return guardar({ fase: 'no_se_pudo' });
        guardar({ fase: 'registrado', nombre: res.data.displayName });
      } catch {
        guardar({ fase: 'no_se_pudo' });
      }
    })();
    return () => { cancelado = true; };
  }, [telefono]);

  if (!telefono) return { fase: 'no_aplica' };
  if (respuesta?.telefono !== telefono) return { fase: 'consultando' };
  return respuesta.resultado;
}
