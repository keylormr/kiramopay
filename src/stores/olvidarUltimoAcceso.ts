/**
 * Olvida al ultimo usuario que entro en ESTE dispositivo.
 *
 * La pantalla de login recuerda quien entro por ultima vez para ofrecer el
 * acceso rapido y la huella. Es deliberado y comodo, pero deja dos cosas en el
 * aparato: el nombre y el identificador en `localStorage` (texto plano), y la
 * contrasena en el llavero del sistema si la biometria estaba activa. Nada las
 * borraba nunca — ni cerrar sesion, ni el cierre forzado, ni la limpieza de
 * datos de usuario—, asi que en un telefono compartido el siguiente en abrir la
 * aplicacion veia el nombre del anterior.
 *
 * Se llama en dos momentos, y en ninguno mas:
 *  - cuando la cuenta pierde el acceso (bloqueo remoto, sesion revocada): la
 *    credencial guardada ya no sirve para nada y no tiene por que seguir ahi.
 *    Es la regla del proyecto: quitar el acceso no borra registros, pero la
 *    credencial SI se destruye.
 *  - cuando la persona lo pide desde la propia pantalla ("no soy yo").
 *
 * En un cierre de sesion normal NO se llama: ahi el acceso rapido es justo lo
 * que el usuario espera encontrar la proxima vez.
 */
import { biometricService } from '@/services/biometric';

export const CLAVE_ULTIMO_IDENTIFICADOR = 'kiramopay_last_cedula';
export const CLAVE_ULTIMO_NOMBRE = 'kiramopay_last_name';

export function olvidarUltimoAcceso(): void {
  try {
    localStorage.removeItem(CLAVE_ULTIMO_IDENTIFICADOR);
    localStorage.removeItem(CLAVE_ULTIMO_NOMBRE);
  } catch {
    // Almacenamiento bloqueado (ventana privada, ajustes del navegador): no
    // hay nada guardado que borrar, y fallar aqui no puede impedir el cierre
    // de sesion que lo esta llamando.
  }
  // El llavero es nativo; en web es un no-op. Best-effort a proposito: que no
  // se pueda borrar la credencial no puede bloquear la expulsion.
  void biometricService.deleteCredentials('kiramopay').catch(() => {});
}
