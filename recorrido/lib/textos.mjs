// Textos de la pantalla que el recorrido busca. `txt` no cambia nada en tiempo
// de ejecucion: marca el literal para que `verificar-textos.mjs` pueda
// comprobar que sigue existiendo en el diccionario en espanol
// (src/i18n/languages/es.ts). Asi, una palabra que cambio en la app se ve como
// "el texto X ya no existe" y no como un defecto de la pantalla.

/** Marca un texto de la interfaz (se comprueba contra es.ts). */
export const txt = (texto) => texto;

/** Expresion que reconoce un monto en colones como lo pinta la app: ₡1,500 o ₡1,500.00. */
export function reColones(colones) {
  const n = Number(colones);
  const entero = Math.trunc(n).toLocaleString('en-US');
  const decimales = Math.round((n - Math.trunc(n)) * 100);
  const cola = decimales ? `\\.${String(decimales).padStart(2, '0')}` : '(?:\\.00)?';
  return new RegExp(`₡\\s?${entero.replace(/,/g, ',')}${cola}(?!\\d)`);
}

/** Expresion que reconoce un monto en dolares: $60.00 o $60. */
export function reDolares(dolares) {
  const n = Number(dolares);
  const entero = Math.trunc(n).toLocaleString('en-US');
  const decimales = Math.round((n - Math.trunc(n)) * 100);
  const cola = decimales ? `\\.${String(decimales).padStart(2, '0')}` : '(?:\\.00)?';
  return new RegExp(`\\$\\s?${entero}${cola}(?!\\d)`);
}

/** Escapa un texto para usarlo dentro de una expresion regular. */
export function escapar(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Expresion para un texto de la app con huecos, como "Enviar {monto}": lo fijo
 * tiene que coincidir tal cual y cada hueco con su valor (texto o expresion).
 * La plantilla se marca con txt() para que se compruebe contra es.ts.
 */
export function rePlantilla(plantilla, huecos) {
  let fuente = escapar(plantilla);
  for (const [nombre, valor] of Object.entries(huecos)) {
    fuente = fuente.replace(`\\{${nombre}\\}`, typeof valor === 'string' ? escapar(valor) : valor.source);
  }
  return new RegExp(`^${fuente}$`);
}
