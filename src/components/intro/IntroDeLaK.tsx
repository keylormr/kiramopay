// La animacion de la K al abrir la app instalada. Va encima de todo mientras la
// app arranca por detras (recupera la sesion, pinta el login o el inicio): no
// frena nada, solo lo tapa durante su segundo y algo. Un toque la salta.
//
// El empalme con el splash nativo:
// - Android: la API de splash de Android 12 no deja dibujar la pagina hasta que
//   se llama a hide(). Se llama apenas la intro tiene su primer cuadro armado
//   (la K quieta, identica a la del splash) y el splash se funde 200 ms sobre
//   una imagen igual. Las animaciones esperan quietas al menos 120 ms.
// - iOS: la pagina ya se dibuja debajo del splash. Se espera a que el primer
//   cuadro este pintado y se quita el splash sin fundido: debajo esta la misma K.
import { useLayoutEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { useSuperficieOscura } from '@/hooks/useBarrasDelSistema';
import { armarConcepto, type IdConcepto } from './conceptos';
import { poseDeArranque } from './geometriaK';
import { alTerminarLaIntro, terminarIntro, tomarElControlDeLaIntro } from './arranqueDeLaIntro';

const SALIDA_AL_TOCAR_MS = 180;
// Lo que puede pasarse la intro de su duracion si el telefono no logra pintar.
const COTA_EXTRA_MS = 1500;
// Si el telefono tarda mas que esto en dar sus primeros cuadros (esta muy
// ocupado arrancando), la K se funde sin animarse: la intro no alarga el
// arranque de un telefono lento.
const ESPERA_MAXIMA_MS = 1200;

/** Dos cuadros pintados; con tope, por si el WebView todavia no da cuadros. */
function dosCuadros(): Promise<void> {
  return new Promise((listo) => {
    let hecho = false;
    const fin = () => {
      if (hecho) return;
      hecho = true;
      listo();
    };
    requestAnimationFrame(() => requestAnimationFrame(fin));
    setTimeout(fin, 120);
  });
}

function soltarSplash(sinFundido: boolean): void {
  SplashScreen.hide(sinFundido ? { fadeOutDuration: 0 } : undefined).catch(() => {
    // Sin el plugin no hay splash que quitar.
  });
}

export default function IntroDeLaK({ concepto }: { concepto: IdConcepto }) {
  const raiz = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  // Mientras se ve, las barras del sistema van con iconos claros.
  useSuperficieOscura(visible);

  useLayoutEffect(() => {
    const el = raiz.current;
    if (!el) return;
    let vivo = true;
    let saltando = false;
    const animaciones: Animation[] = [];
    const relojes: number[] = [];
    const esIOS = Capacitor.getPlatform() === 'ios';

    const saltar = () => {
      if (saltando || typeof el.animate !== 'function') {
        terminarIntro();
        return;
      }
      saltando = true;
      animaciones.forEach((a) => a.pause());
      const salida = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SALIDA_AL_TOCAR_MS, easing: 'ease-out', fill: 'forwards' });
      salida.onfinish = () => terminarIntro();
      relojes.push(window.setTimeout(terminarIntro, SALIDA_AL_TOCAR_MS + 100));
    };
    // Si la app pasa a segundo plano, al volver ya no queda nada encima.
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'hidden') terminarIntro();
    };
    const soltarTodo = () => {
      vivo = false;
      animaciones.forEach((a) => a.cancel());
      animaciones.length = 0;
      relojes.forEach((r) => window.clearTimeout(r));
      el.removeEventListener('pointerdown', saltar);
      document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    };
    const quitar = alTerminarLaIntro(() => {
      // Se oculta en el acto: cancelar las animaciones antes de que React saque
      // la capa la volveria a su primer cuadro por un instante.
      el.style.display = 'none';
      soltarTodo();
      setVisible(false);
    });
    if (!vivo) {
      // Ya se habia dado por terminada: no se arma nada y solo queda quitar el splash.
      soltarSplash(false);
      return quitar;
    }
    tomarElControlDeLaIntro();
    const montada = performance.now();

    try {
      const pose = poseDeArranque(Capacitor.getPlatform(), window.innerWidth, window.innerHeight);
      const c = armarConcepto(concepto, pose);
      // HTML fijo de este modulo, sin datos de nadie.
      el.innerHTML = c.html;
      el.addEventListener('pointerdown', saltar);
      document.addEventListener('visibilitychange', alCambiarVisibilidad);
      if (!esIOS) soltarSplash(false);

      void (async () => {
        await dosCuadros();
        if (!vivo) return;
        if (esIOS) {
          soltarSplash(true);
          await dosCuadros();
          if (!vivo) return;
        }
        if (saltando) return;
        if (performance.now() - montada > ESPERA_MAXIMA_MS) {
          saltar();
          return;
        }
        if (typeof el.animate !== 'function') {
          terminarIntro();
          return;
        }
        for (const paso of c.pasos) {
          el.querySelectorAll(paso.selector).forEach((capa) => {
            animaciones.push(capa.animate(paso.cuadros, { duration: c.duracion, fill: 'both' }));
          });
        }
        // Se va cuando las animaciones terminan de verdad: si el telefono esta
        // ocupado arrancando, empiezan con el primer cuadro que logre pintar y
        // se ven enteras. El reloj es solo la cota, por si nunca terminan.
        void Promise.all(animaciones.map((a) => a.finished)).then(
          () => terminarIntro(),
          () => {
            // Canceladas: ya se esta yendo por otro lado.
          },
        );
        relojes.push(window.setTimeout(terminarIntro, c.duracion + COTA_EXTRA_MS));
      })();
    } catch {
      // Si algo falla al armarla, la app sigue como si no hubiera intro.
      soltarSplash(false);
      terminarIntro();
    }

    return () => {
      quitar();
      soltarTodo();
    };
  }, [concepto]);

  if (!visible) return null;
  return (
    <div
      ref={raiz}
      data-intro={concepto}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        overflow: 'hidden',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    />
  );
}
