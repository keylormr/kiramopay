import { useEffect } from 'react';
import { getApiLayer } from '@/api';
import { crearAvisoDeActividad, EVENTOS_DE_ACCION } from '@/services/actividadDeSesion';

/**
 * Le avisa al servidor cuando la PERSONA actua, para que el cierre por
 * inactividad (30 minutos) cuente desde su ultima accion y no desde la ultima
 * renovacion del token. Ver services/actividadDeSesion.ts para que es y que no
 * es una accion.
 *
 * Con sesion abierta:
 *  - avisa una vez al abrirla o restaurarla (entrar o volver a abrir la app es
 *    una accion; sin esto la sesion nueva esperaria al primer toque);
 *  - y despues solo cuando hay un toque, una tecla o la rueda, a lo sumo una
 *    vez por minuto.
 *
 * No hay ningun temporizador: horas con la app abierta y nadie tocandola no
 * mandan nada, que es justo lo que tiene que pasar.
 *
 * El aviso viaja por el cliente HTTP de siempre: si el token de acceso vencio,
 * la renovacion de siempre lo resuelve, y si la sesion ya paso la ventana el
 * servidor responde 401, la renovacion se rechaza y la sesion se cierra con el
 * mensaje de sesion vencida.
 */
export function useActividadDeSesion(conSesion: boolean): void {
  useEffect(() => {
    if (!conSesion) return;

    const aviso = crearAvisoDeActividad({
      enviar: () => getApiLayer().auth.registrarActividad(),
    });
    // Capturar en la fase de captura y pasivo: ni un componente que detenga el
    // evento ni este oyente pueden estorbar el desplazamiento.
    const opciones: AddEventListenerOptions = { capture: true, passive: true };
    const alActuar = () => aviso.alActuar();

    aviso.reiniciar();
    aviso.alActuar();
    for (const evento of EVENTOS_DE_ACCION) {
      document.addEventListener(evento, alActuar, opciones);
    }
    return () => {
      for (const evento of EVENTOS_DE_ACCION) {
        document.removeEventListener(evento, alActuar, opciones);
      }
    };
  }, [conSesion]);
}
