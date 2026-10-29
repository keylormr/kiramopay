import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

/**
 * Cuanto se extiende una sombra de las que define `index.css` (la primera
 * capa), en pixeles hacia cada lado. jsdom no pinta, asi que las pruebas de
 * "esta sombra no se recorta" miden la variable y comparan contra el relleno que
 * le deja el contenedor que se desplaza.
 */
export function alcanceDeSombra(variable: string) {
  const declaracion = new RegExp(`--${variable}:\\s*([^;]+);`).exec(css)?.[1] ?? '';
  const sinColor = declaracion.replace(/rgba?\([^)]*\)/g, '').split(',')[0].trim();
  const [x, y, desenfoque, extension = 0] = sinColor.split(/\s+/).map((v) => Number.parseFloat(v));
  const radio = desenfoque + extension;
  return { izquierda: radio - x, derecha: radio + x, arriba: radio - y, abajo: radio + y };
}

/** Un valor de estilo en pixeles ("12px" o "") como numero. */
export const px = (valor: string) => Number.parseFloat(valor || '0');
