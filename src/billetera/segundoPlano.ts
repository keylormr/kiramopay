// Avisa cuando la app pasa de verdad a segundo plano: el usuario sale a otra
// app, bloquea el telefono o abre el selector de apps. La billetera propia lo
// usa para soltar la semilla de memoria (BilleteraPropia.tsx).
//
// "De verdad" importa: los dialogos del sistema (el permiso de la camara, la
// huella o el rostro) tambien pausan la app, y bloquear la billetera en medio de
// la confirmacion de un envio la dejaria cerrada justo despues de autenticarse.
// Cada plataforma tiene su evento que solo llega al salir de la app
// (@capacitor/app, AppPlugin):
// - Android: appStateChange con isActive en false llega en onStop; 'pause' llega
//   en onPause, que tambien es el de los dialogos.
// - iOS: 'pause' llega en didEnterBackground; appStateChange con isActive en false
//   llega en willResignActive, que tambien es el del dialogo del rostro.
// Ademas, la visibilidad de la pagina: si el WebView deja de verse, la app salio.
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * Llama a `alIrse` cuando la app pasa a segundo plano. Devuelve la funcion que
 * deja de escuchar. En la web no hace nada: ahi no hay billetera propia.
 */
export function alPasarASegundoPlano(alIrse: () => void): () => void {
  if (!Capacitor.isNativePlatform()) return () => undefined;

  let escuchando = true;
  const avisar = () => {
    if (escuchando) alIrse();
  };

  const escucha = Capacitor.getPlatform() === 'ios'
    ? App.addListener('pause', avisar)
    : App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) avisar();
      });

  const alCambiarVisibilidad = () => {
    if (document.visibilityState === 'hidden') avisar();
  };
  document.addEventListener('visibilitychange', alCambiarVisibilidad);

  return () => {
    escuchando = false;
    document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    void escucha.then(manejador => manejador.remove()).catch(() => undefined);
  };
}
