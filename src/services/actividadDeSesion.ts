/**
 * Aviso de actividad de la sesion.
 *
 * El servidor cierra la sesion tras JWT_IDLE_MINUTES (30) sin una ACCION de la
 * persona. Lo unico que le dice que hubo una es POST /auth/activity, y este
 * modulo decide cuando mandarlo.
 *
 * Una accion es lo que hace la PERSONA: tocar, teclear, girar la rueda (ver
 * EVENTOS_DE_ACCION). Lo que la app hace sola NO lo es: los precios que se piden
 * cada cinco minutos, el sondeo de un pedido o de un cobro, el socket de avisos
 * y la renovacion del token. Si contaran, una pantalla de precios abierta sobre
 * un telefono olvidado mantendria la sesion viva para siempre.
 *
 * Por eso aqui no hay ningun temporizador: el aviso sale SOLO cuando ocurre una
 * accion, y a lo sumo una vez por INTERVALO_AVISO_MS. Con 30 minutos de ventana,
 * uno por minuto sobra, y una persona usando la app cuesta una peticion
 * liviana por minuto.
 */

/** A lo sumo un aviso por este intervalo, por mas acciones que haya. */
export const INTERVALO_AVISO_MS = 60_000;

/**
 * Los eventos que solo produce una persona. `scroll` no esta: tambien lo
 * dispara la pantalla sola (un scroll programatico, un carrusel). `wheel` y
 * `touchstart` si, que los origina quien tiene el dedo o la rueda. El movimiento
 * del raton tampoco: un puntero olvidado sobre la ventana se mueve con una
 * vibracion de la mesa.
 */
export const EVENTOS_DE_ACCION = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

export interface AvisoDeActividad {
  /** Llamar cuando la persona actua. Avisa al servidor si toca, o no hace nada. */
  alActuar(): void;
  /**
   * Olvida el ultimo aviso: la proxima accion avisa de inmediato. Para una
   * sesion nueva (otro login, otra persona) que no debe heredar el intervalo de
   * la anterior.
   */
  reiniciar(): void;
}

interface OpcionesDelAviso {
  /** Manda el aviso. Si rechaza, el fallo se traga: avisar es un favor, no un requisito. */
  enviar: () => Promise<unknown>;
  ahora?: () => number;
  intervaloMs?: number;
}

export function crearAvisoDeActividad({
  enviar,
  ahora = () => Date.now(),
  intervaloMs = INTERVALO_AVISO_MS,
}: OpcionesDelAviso): AvisoDeActividad {
  let ultimoAviso = Number.NEGATIVE_INFINITY;
  let enCamino = false;
  // Cuenta los reinicios: un aviso de la sesion anterior que termina tarde no
  // puede marcar como "ya no hay uno en camino" al de la sesion nueva.
  let generacion = 0;

  return {
    alActuar() {
      const t = ahora();
      // Un aviso todavia en camino cuenta como avisado: sin esto, una red lenta
      // acumularia avisos uno tras otro.
      if (enCamino || t - ultimoAviso < intervaloMs) return;
      // Se marca al INTENTAR, no al lograrlo: sin red cada toque dispararia una
      // peticion que falla. El siguiente intento espera el intervalo completo.
      ultimoAviso = t;
      enCamino = true;
      const miGeneracion = generacion;
      let enviado: Promise<unknown>;
      try {
        enviado = Promise.resolve(enviar());
      } catch (error) {
        enviado = Promise.reject(error);
      }
      void enviado
        .catch(() => {
          // Sin red o con el servidor caido no hay nada que hacer aqui: el
          // siguiente aviso lo reintenta.
        })
        .finally(() => {
          if (miGeneracion === generacion) enCamino = false;
        });
    },
    reiniciar() {
      generacion += 1;
      ultimoAviso = Number.NEGATIVE_INFINITY;
      enCamino = false;
    },
  };
}
