import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// La pagina llega hasta los bordes de la pantalla (Android 15 o posterior con
// WebView 140 o posterior, y siempre en iOS). Las capas a pantalla completa
// tapaban su cabecera con la barra de estado o la camara, y el boton de volver
// no se podia tocar. Se lee el codigo porque jsdom no aplica el CSS.

const RAIZ = join(process.cwd(), 'src');
const css = readFileSync(join(RAIZ, 'index.css'), 'utf8');

function vistas(carpeta: string): string[] {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) return nombre === '__tests__' ? [] : vistas(ruta);
    return ruta.endsWith('.tsx') ? [ruta] : [];
  });
}

describe('zona segura de las capas a pantalla completa', () => {
  it('la cabecera de la capa suma el margen de arriba y la capa el de abajo', () => {
    const cabecera = /\.kp-capa > \.sticky\.top-0,\s*\.kp-capa > header \{([^}]*)\}/.exec(css);
    expect(cabecera, 'falta la regla de la cabecera').not.toBeNull();
    expect(cabecera![1]).toContain('padding-top: env(safe-area-inset-top');
    // El alto de la barra es el del contenido: el margen se suma encima.
    expect(cabecera![1]).toContain('box-sizing: content-box');
    const capa = /\.kp-capa \{([^}]*)\}/.exec(css);
    expect(capa![1]).toContain('padding-bottom: env(safe-area-inset-bottom');
  });

  it('toda capa abre con una cabecera que la regla alcanza', () => {
    const capas = vistas(RAIZ)
      .map((ruta) => ({ ruta, texto: readFileSync(ruta, 'utf8') }))
      .filter(({ texto }) => /fixed inset-0 kp-capa/.test(texto));
    expect(capas.length).toBeGreaterThan(15);
    for (const { ruta, texto } of capas) {
      const desde = texto.indexOf('fixed inset-0 kp-capa');
      // El primer elemento despues de la etiqueta de la capa es su cabecera.
      const hijo = /<(\w+)\b[^>]*>/.exec(texto.slice(desde));
      expect(hijo, ruta).not.toBeNull();
      const alcanzada = hijo![1] === 'header' || /sticky top-0/.test(hijo![0]);
      expect(alcanzada, `${ruta}: abre con ${hijo![0].slice(0, 80)}`).toBe(true);
    }
  });
});
