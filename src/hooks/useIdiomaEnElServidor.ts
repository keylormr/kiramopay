import { useEffect, useRef, useState } from 'react';
import { getApiLayer } from '@/api';
import { useLanguage } from '@/i18n/LanguageContext';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Le dice al servidor en que idioma usa la app la persona, para que escriba sus
 * avisos y sus push en ese idioma: antes salian en espanol para todos.
 *
 * Lo guarda cuando la persona ELIGE un idioma, y la primera vez, si la cuenta
 * todavia no tiene ninguno, le da el de la pantalla aunque solo lo haya
 * adivinado el navegador. Un idioma adivinado no pisa el que la cuenta ya
 * tiene: con el telefono en espanol, entrar desde una PC con Chrome en ingles
 * dejaba los push del telefono en ingles.
 *
 * Es de mejor esfuerzo: si falla, los avisos siguen saliendo en el idioma
 * anterior, y no se insiste. Un pedido a la vez: dos cambios seguidos mandaban
 * dos pedidos juntos, y el servidor podia quedarse con el primero.
 */
export function useIdiomaEnElServidor(): void {
  const { language, elegido } = useLanguage();
  const userId = useAuthStore((s) => s.user?.id);
  const idiomaDelPerfil = useAuthStore((s) => s.user?.language);
  // Sin servidor configurado la sesion se guarda sin sus llaves: tras recargar
  // hay persona pero no token. El pedido salia sin Authorization, el 401 pasaba
  // por el refresco sin llave de refresco y cerraba la sesion en cada recarga.
  const conToken = useAuthStore((s) => Boolean(s.accessToken));

  // Lo ultimo que se sabe que el servidor tiene (null: la cuenta no eligio). El
  // perfil dice el de cuando se cargo: tras guardar otro, manda lo guardado (si
  // no, volver al idioma de antes no se guardaria, porque coincide con el
  // perfil viejo).
  const enServidor = useRef<{ id: string; idioma?: string | null } | null>(null);
  // Lo ultimo que se intento, para no repetir un rechazo.
  const intentado = useRef<string | null>(null);
  // Un pedido en vuelo. El siguiente espera: al volver, `vuelta` hace correr el
  // efecto otra vez con el idioma que haya entonces.
  const enVuelo = useRef(false);
  const [vuelta, setVuelta] = useState(0);

  useEffect(() => {
    if (!userId) {
      enServidor.current = null;
      intentado.current = null;
      return;
    }
    enServidor.current = { id: userId, idioma: idiomaDelPerfil };
  }, [userId, idiomaDelPerfil]);

  useEffect(() => {
    if (!userId || !conToken || !enServidor.current || enVuelo.current) return;
    const delServidor = enServidor.current.idioma;
    if (delServidor === language) {
      // De vuelta en el que el servidor tiene: un intento fallido anterior ya
      // no bloquea el proximo cambio.
      intentado.current = null;
      return;
    }
    if (!elegido && delServidor) return;
    const clave = `${userId}:${language}`;
    if (intentado.current === clave) return;
    intentado.current = clave;
    enVuelo.current = true;

    void getApiLayer()
      .auth.setLanguage(language)
      .then((res) => {
        if (res.success && enServidor.current?.id === userId) {
          enServidor.current.idioma = language;
        }
      })
      .catch(() => {
        // Sin red: el siguiente cambio de idioma o la siguiente entrada lo
        // vuelven a intentar.
      })
      .finally(() => {
        enVuelo.current = false;
        setVuelta((n) => n + 1);
      });
  }, [userId, conToken, idiomaDelPerfil, language, elegido, vuelta]);
}
