import { useEffect, useRef } from 'react';
import { getApiLayer } from '@/api';
import { useLanguage } from '@/i18n/LanguageContext';
import { useAuthStore } from '@/stores/auth.store';

/**
 * Le dice al servidor en que idioma usa la app la persona, para que escriba sus
 * avisos y sus push en ese idioma: antes salian en espanol para todos.
 *
 * Lo guarda al entrar, si el que el servidor tiene no es el de la pantalla, y
 * cada vez que la persona cambia de idioma. Es de mejor esfuerzo: si falla, los
 * avisos siguen saliendo en el idioma anterior, y no se insiste en cada render.
 */
export function useIdiomaEnElServidor(): void {
  const { language } = useLanguage();
  const userId = useAuthStore((s) => s.user?.id);
  const idiomaDelPerfil = useAuthStore((s) => s.user?.language);

  // Lo ultimo que se sabe que el servidor tiene. El perfil dice el de cuando se
  // cargo: tras guardar otro, manda lo guardado (si no, volver al idioma de
  // antes no se guardaria, porque coincide con el perfil viejo).
  const enServidor = useRef<{ id: string; idioma?: string } | null>(null);
  // Lo ultimo que se intento, para no repetir un rechazo en cada render.
  const intentado = useRef<string | null>(null);

  useEffect(() => {
    if (!userId) {
      enServidor.current = null;
      intentado.current = null;
      return;
    }
    enServidor.current = { id: userId, idioma: idiomaDelPerfil };
  }, [userId, idiomaDelPerfil]);

  useEffect(() => {
    if (!userId || !enServidor.current) return;
    if (enServidor.current.idioma === language) {
      // De vuelta en el que el servidor tiene: un intento fallido anterior ya
      // no bloquea el proximo cambio.
      intentado.current = null;
      return;
    }
    const clave = `${userId}:${language}`;
    if (intentado.current === clave) return;
    intentado.current = clave;

    const auth = getApiLayer().auth;
    void auth
      .setLanguage(language)
      .then((res) => {
        if (res.success && enServidor.current?.id === userId) {
          enServidor.current.idioma = language;
        }
      })
      .catch(() => {
        // Sin red: el siguiente cambio de idioma o la siguiente entrada lo
        // vuelven a intentar.
      });
  }, [userId, idiomaDelPerfil, language]);
}
