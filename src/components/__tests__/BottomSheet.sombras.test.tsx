import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BottomSheet } from '../BottomSheet';

// El rectangulo palido detras de los botones principales. El contenido de la
// hoja vive en un contenedor con `overflow-y: auto`, y un contenedor que se
// desplaza recorta TODO lo que sale de su caja, tambien a los lados (con
// overflow-y distinto de visible, overflow-x deja de ser visible). El boton
// principal lleva `--shadow-primary` (0 8px 20px, azul): la sombra se extiende
// 20 px a cada lado y 28 px hacia abajo, el contenedor la cortaba justo en el
// borde del boton y quedaba un rectangulo azul palido de esquinas rectas ("Crear
// acuerdo", "Enviar", "Ver planes").
//
// jsdom no pinta, asi que se prueba la regla que lo resuelve: el contenedor deja
// alrededor del contenido, como relleno, lo que la sombra mas grande necesita, y
// lo recupera con margen negativo para que el diseno de la hoja no se mueva.

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

/** El relleno de la hoja (p-6). */
const RELLENO_DE_LA_HOJA = 24;
/**
 * Lo que se puede perder del final de la sombra, hacia abajo: a 24 px del boton
 * la sombra azul (0.32 de opacidad, desenfoque de 20 px) vale ~1,8 %, a 28 px
 * ~0,7 %. Un corte a ese nivel no se ve.
 */
const COLA_QUE_NO_SE_VE = 4;

/** Cuanto se extiende una sombra (primera capa) hacia cada lado. */
function alcanceDe(variable: string) {
  const declaracion = new RegExp(`--${variable}:\\s*([^;]+);`).exec(css)?.[1] ?? '';
  const sinColor = declaracion.replace(/rgba?\([^)]*\)/g, '').split(',')[0].trim();
  const [x, y, desenfoque, extension = 0] = sinColor.split(/\s+/).map((v) => Number.parseFloat(v));
  const radio = desenfoque + extension;
  return { izquierda: radio - x, derecha: radio + x, arriba: radio - y, abajo: radio + y };
}

function contenedorDelContenido() {
  render(
    <LanguageProvider>
      <BottomSheet isOpen onClose={() => {}} title="Hoja">
        <button data-testid="hijo" type="button">Crear acuerdo</button>
      </BottomSheet>
    </LanguageProvider>,
  );
  return screen.getByTestId('hijo').parentElement as HTMLElement;
}

const px = (valor: string) => Number.parseFloat(valor || '0');

describe('BottomSheet: la sombra del boton principal cabe en el contenedor que se desplaza', () => {
  it('la prueba mide una sombra real (si cambia el formato de la variable, avisa)', () => {
    const a = alcanceDe('shadow-primary');
    expect(a.abajo).toBeGreaterThan(0);
    expect(a.izquierda).toBeGreaterThan(0);
  });

  it('el contenedor sigue desplazandose cuando el contenido no cabe', () => {
    expect(contenedorDelContenido().className).toContain('overflow-y-auto');
  });

  it('deja de relleno, a cada lado, al menos lo que se extiende la sombra', () => {
    const a = alcanceDe('shadow-primary');
    const estilo = contenedorDelContenido().style;

    expect(px(estilo.paddingLeft)).toBeGreaterThanOrEqual(a.izquierda);
    expect(px(estilo.paddingRight)).toBeGreaterThanOrEqual(a.derecha);
    expect(px(estilo.paddingTop)).toBeGreaterThanOrEqual(a.arriba);
    // Abajo se pierde la cola: ver el limite de la prueba siguiente.
    expect(px(estilo.paddingBottom)).toBeGreaterThanOrEqual(a.abajo - COLA_QUE_NO_SE_VE);
  });

  // El contenedor no puede pasar del borde de la hoja: si se asoma bajo el
  // borde de la pantalla, el navegador da por "a la vista" un boton que queda
  // cortado (e2e/hoja-de-envio-en-pantalla-chica.spec.ts). El relleno de la hoja
  // es p-6 (24 px) y es lo maximo que puede ceder el contenedor hacia abajo.
  it('no se asoma bajo el borde de la hoja', () => {
    const estilo = contenedorDelContenido().style;

    expect(px(estilo.paddingBottom)).toBeLessThanOrEqual(RELLENO_DE_LA_HOJA);
    expect(px(estilo.paddingLeft)).toBeLessThanOrEqual(RELLENO_DE_LA_HOJA);
    expect(px(estilo.paddingRight)).toBeLessThanOrEqual(RELLENO_DE_LA_HOJA);
  });

  it('recupera ese relleno con margen negativo, para que la hoja no cambie de tamano', () => {
    const estilo = contenedorDelContenido().style;

    expect(px(estilo.marginLeft)).toBe(-px(estilo.paddingLeft));
    expect(px(estilo.marginRight)).toBe(-px(estilo.paddingRight));
    expect(px(estilo.marginTop)).toBe(-px(estilo.paddingTop));
    expect(px(estilo.marginBottom)).toBe(-px(estilo.paddingBottom));
  });
});
