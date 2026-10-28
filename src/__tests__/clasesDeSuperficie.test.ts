import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Las superficies (`uv-surface-1`, `uv-surface-2`) son clases propias de
// index.css, no utilidades de Tailwind: una variante con opacidad escrita en la
// clase ("uv-surface-1/95") no existe a menos que alguien la defina. Sin la
// regla, el fondo queda en `rgba(0, 0, 0, 0)`: la barra inferior de la app y la
// cabecera de Movimientos dejaban ver el texto de la lista por detras.
//
// Esta prueba cruza las dos cosas: toda variante con opacidad que use algun
// componente tiene su regla en index.css.

const RAIZ = join(process.cwd(), 'src');

function archivosTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return nombre === '__tests__' ? [] : archivosTsx(ruta);
    return /\.tsx$/.test(nombre) && !/\.test\.tsx$/.test(nombre) ? [ruta] : [];
  });
}

describe('las superficies con opacidad usadas en los componentes existen en index.css', () => {
  const css = readFileSync(join(RAIZ, 'index.css'), 'utf8');
  const usadas = new Map<string, string>();
  for (const archivo of archivosTsx(RAIZ)) {
    const fuente = readFileSync(archivo, 'utf8');
    for (const m of fuente.matchAll(/\buv-surface-\d+\/\d+\b/g)) {
      if (!usadas.has(m[0])) usadas.set(m[0], archivo.replace(RAIZ, 'src'));
    }
  }

  it('hay variantes con opacidad en uso (si no, esta prueba ya no vigila nada)', () => {
    expect(usadas.size).toBeGreaterThan(0);
  });

  it.each([...usadas.entries()])('%s (la usa %s) tiene su regla', (clase) => {
    // En CSS la barra se escapa: `.uv-surface-1\/95`.
    const selector = `.${clase.replace('/', '\\/')}`;
    expect(css).toContain(selector);
    // Y la del modo oscuro: sin ella, de noche la barra queda con el fondo claro.
    expect(css).toContain(`.dark ${selector}`);
  });

  // La regla no basta si no pinta nada: tiene que dar fondo, y uno que se vea
  // aunque el navegador no sepa de color-mix (WebView viejo de Android): un
  // fondo solido primero, la mezcla con transparencia despues.
  it('cada regla da un fondo solido de respaldo antes de la mezcla', () => {
    for (const clase of usadas.keys()) {
      const selector = `.${clase.replace('/', '\\/')}`;
      const inicio = css.indexOf(selector);
      expect(inicio).toBeGreaterThanOrEqual(0);
      const bloque = css.slice(inicio, css.indexOf('}', inicio));
      const solido = bloque.indexOf('background-color: var(');
      const mezcla = bloque.indexOf('color-mix(');
      expect(solido).toBeGreaterThan(-1);
      expect(mezcla).toBeGreaterThan(solido);
    }
  });
});
