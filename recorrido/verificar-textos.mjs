// Comprueba que cada texto que el recorrido busca en la pantalla (marcado con
// txt('...')) siga existiendo en el diccionario en espanol de la app. No
// necesita servidor ni navegador: sirve para distinguir "el recorrido quedo
// viejo" de "la pantalla esta mal".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(aqui, '..');
const origen = fs.readFileSync(path.join(raiz, 'src/i18n/languages/es.ts'), 'utf8');
const js = transformSync(origen, { loader: 'ts', format: 'esm' }).code;
const es = (await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`)).default;
const valores = new Set(Object.values(es));

function archivos(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) return archivos(ruta);
    return ruta.endsWith('.mjs') ? [ruta] : [];
  });
}

const patron = /\btxt\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*\)/g;
const faltan = [];
let total = 0;
for (const archivo of archivos(path.join(raiz, 'recorrido'))) {
  if (archivo.endsWith('verificar-textos.mjs') || archivo.endsWith('textos.mjs')) continue;
  const fuente = fs.readFileSync(archivo, 'utf8');
  for (const m of fuente.matchAll(patron)) {
    total++;
    const texto = m[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (!valores.has(texto)) faltan.push(`${path.relative(raiz, archivo)}: "${texto}"`);
  }
}

if (faltan.length) {
  console.error(`Estos ${faltan.length} textos del recorrido ya no existen en src/i18n/languages/es.ts:`);
  for (const f of faltan) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`Los ${total} textos del recorrido existen en el diccionario en español.`);
