// Arma las notas de un release a partir del changelog de src/config/version.ts.
//
// Hasta la 2.7.0 el release de GitHub salia con la descripcion vacia y el aviso
// de actualizacion de la app no decia que traia la version nueva: la app
// instalada no conoce el changelog de una version que todavia no tiene. Este
// script escribe dos archivos que publica android-apk.yml:
//
//   notas-de-version.md -> la descripcion del release en GitHub
//   notas.json          -> adjunto del release; el backend lo lee y se lo pasa
//                          al aviso de actualizacion (internal/appversion).
//                          Trae los cambios en espanol y, en `traducciones`,
//                          los mismos cambios en los demas idiomas de la app
//                          (src/config/notasTraducidas.json).
//
// Uso en CI: node scripts/notas-de-version.mjs v2.8.0
// Falla si el tag no es la version del changelog: un release con las notas de
// otra version es peor que uno sin notas.

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Lee la entrada `current` de APP_VERSION con el mismo criterio que
// check-version-sync.mjs: se ancla en la declaracion (los comentarios y la
// interfaz de arriba tambien nombran `current` y `changes`) y se corta en
// `history`.
export function notasDeVersion(texto) {
  const ancla = texto.indexOf('export const APP_VERSION');
  if (ancla < 0) throw new Error('no se encontro export const APP_VERSION');
  const objeto = texto.slice(ancla);
  const actual = objeto.slice(objeto.indexOf('current:'), objeto.indexOf('history:'));
  const version = actual.match(/version:\s*'([^']+)'/)?.[1];
  if (!version) throw new Error('no se pudo leer APP_VERSION.current.version');

  const inicio = actual.indexOf('changes:');
  const apertura = actual.indexOf('[', inicio);
  if (inicio < 0 || apertura < 0) throw new Error(`la version ${version} no tiene cambios`);
  const cambios = [];
  // Cada cambio es un literal entre comillas simples; dentro puede haber una
  // comilla escapada.
  const literal = /'((?:[^'\\]|\\.)*)'|\]/g;
  literal.lastIndex = apertura + 1;
  for (let m = literal.exec(actual); m && m[0] !== ']'; m = literal.exec(actual)) {
    cambios.push(m[1].replace(/\\(.)/g, '$1'));
  }
  if (cambios.length === 0) throw new Error(`la version ${version} no tiene cambios`);
  return { version, cambios };
}

// Los codigos de idioma de la app, leidos de translations.ts: una traduccion a
// un idioma que la app no tiene no la leeria nadie.
export function idiomasDeLaApp(texto) {
  const codigos = [...texto.matchAll(/\{\s*code:\s*'([^']+)'/g)].map((m) => m[1]);
  if (codigos.length === 0) throw new Error('no se pudieron leer los idiomas de translations.ts');
  return codigos;
}

// Suma al notas.json las traducciones de las novedades de ESA version. La app
// instalada no conoce el changelog de la version nueva, y el aviso de
// actualizacion lo lee un telefono que todavia no la tiene: las traducciones
// viajan en el release, junto al espanol. Falla si faltan, si traen otro numero
// de cambios (los textos quedarian corridos) o si son de un idioma que la app no
// tiene: un release con las notas a medias es peor que uno sin ellas.
export function conTraducciones({ version, cambios }, traducidas, idiomas = ['es', 'en', 'fr', 'pt', 'zh-cn', 'ja', 'hi']) {
  const deEsta = traducidas?.[version];
  if (!deEsta || Object.keys(deEsta).length === 0) {
    throw new Error(`la version ${version} no tiene traducciones en src/config/notasTraducidas.json`);
  }
  const traducciones = {};
  for (const [idioma, textos] of Object.entries(deEsta)) {
    if (idioma === 'es' || !idiomas.includes(idioma)) {
      throw new Error(`la version ${version} trae el idioma ${idioma}, que la app no tiene`);
    }
    if (!Array.isArray(textos) || textos.length !== cambios.length) {
      throw new Error(
        `la version ${version} en ${idioma} tiene ${Array.isArray(textos) ? textos.length : 0} cambios y el changelog ${cambios.length}`,
      );
    }
    traducciones[idioma] = textos;
  }
  return { version, cambios, traducciones };
}

export function cuerpoDelRelease({ version, cambios }) {
  return (
    `## Novedades de la versión ${version}\n\n` +
    cambios.map((c) => `- ${c}`).join('\n') +
    '\n\n' +
    'Para instalar en Android, descarga `kiramopay.apk` desde tu teléfono y ábrelo: ' +
    'se instala encima de la versión anterior sin perder tus datos ni tu sesión.\n'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const tag = process.argv[2] ?? '';
  const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
  const notas = notasDeVersion(leer('../src/config/version.ts'));
  if (tag.replace(/^v/, '') !== notas.version) {
    console.error(`El tag ${tag || '(vacio)'} no es la version del changelog (${notas.version}).`);
    process.exit(1);
  }
  let completas;
  try {
    completas = conTraducciones(
      notas,
      JSON.parse(leer('../src/config/notasTraducidas.json')),
      idiomasDeLaApp(leer('../src/i18n/translations.ts')),
    );
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  writeFileSync('notas.json', JSON.stringify(completas, null, 2) + '\n');
  writeFileSync('notas-de-version.md', cuerpoDelRelease(notas));
  console.log(
    `Notas de la ${notas.version}: ${notas.cambios.length} cambios, en ${Object.keys(completas.traducciones).length + 1} idiomas.`,
  );
}
