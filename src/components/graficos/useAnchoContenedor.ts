import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Ancho real del contenedor, para dibujar los graficos en pixeles del
 * dispositivo sin estirar el SVG (un viewBox estirado deforma trazos y textos).
 *
 * Donde no existe ResizeObserver (algunos WebView viejos, el entorno de
 * pruebas) se mide una vez y listo, en vez de romper la pantalla.
 */
export function useAnchoContenedor<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [ancho, setAncho] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setAncho(Math.floor(el.getBoundingClientRect().width));
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, ancho };
}
