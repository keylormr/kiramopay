import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { notasDeVersion, cuerpoDelRelease, conTraducciones } from '../../../scripts/notas-de-version.mjs';
import { APP_VERSION } from '../version';

// El CI arma las notas del release (la descripcion que se ve en GitHub y el
// notas.json que lee el aviso de actualizacion) a partir de version.ts. Hasta
// la 2.7.0 el release salia sin descripcion y el aviso no decia que traia.

describe('notasDeVersion', () => {
  it('lee la version actual con los mismos cambios que muestra el perfil', () => {
    const texto = readFileSync(path.resolve(__dirname, '../version.ts'), 'utf8');
    expect(notasDeVersion(texto)).toEqual({
      version: APP_VERSION.current.version,
      cambios: APP_VERSION.current.changes,
    });
  });

  it('no toma cambios del historial ni de la interfaz', () => {
    const texto = `
      export interface VersionInfo { version: string; changes: string[]; }
      export const APP_VERSION: AppVersion = {
        current: {
          version: '3.1.0',
          buildNumber: 30,
          changes: [
            'Uno con \\'comillas\\' adentro',
            'Dos, con coma',
          ],
        },
        history: [
          { version: '3.0.0', buildNumber: 29, changes: ['Viejo'] },
        ],
      };`;
    expect(notasDeVersion(texto)).toEqual({
      version: '3.1.0',
      cambios: ["Uno con 'comillas' adentro", 'Dos, con coma'],
    });
  });

  it('una version sin cambios es un error, no un release mudo', () => {
    const texto = `export const APP_VERSION = { current: { version: '3.1.0', changes: [] }, history: [] };`;
    expect(() => notasDeVersion(texto)).toThrow(/cambios/);
  });
});

describe('cuerpoDelRelease', () => {
  it('pone la version de titulo y un cambio por linea', () => {
    const cuerpo = cuerpoDelRelease({ version: '3.1.0', cambios: ['Uno', 'Dos'] });
    expect(cuerpo).toContain('## Novedades de la versión 3.1.0');
    expect(cuerpo).toContain('- Uno\n- Dos\n');
  });
});

// El aviso de actualizacion lo lee un telefono que todavia no tiene la version
// nueva: las traducciones de las novedades tienen que viajar en el notas.json
// del release, junto al espanol.
describe('conTraducciones', () => {
  const notas = { version: '3.1.0', cambios: ['Uno', 'Dos'] };
  const traducidas = {
    '3.1.0': { en: ['One', 'Two'], fr: ['Un', 'Deux'] },
    '3.0.0': { en: ['Old'] },
  };

  it('suma al notas.json las traducciones de ESA version y de ninguna otra', () => {
    expect(conTraducciones(notas, traducidas)).toEqual({
      version: '3.1.0',
      cambios: ['Uno', 'Dos'],
      traducciones: { en: ['One', 'Two'], fr: ['Un', 'Deux'] },
    });
  });

  it('la version actual del changelog queda con sus seis idiomas', () => {
    const texto = readFileSync(path.resolve(__dirname, '../version.ts'), 'utf8');
    const json = JSON.parse(readFileSync(path.resolve(__dirname, '../notasTraducidas.json'), 'utf8'));
    const completas = conTraducciones(notasDeVersion(texto), json);
    expect(Object.keys(completas.traducciones).sort()).toEqual(['en', 'fr', 'hi', 'ja', 'pt', 'zh-cn']);
    for (const textos of Object.values(completas.traducciones)) {
      expect(textos).toHaveLength(completas.cambios.length);
    }
  });

  // Un release con las notas corridas o a medias es peor que uno sin ellas.
  it('una version sin traducciones es un error, no un release que sale en espanol sin avisar', () => {
    expect(() => conTraducciones({ version: '3.2.0', cambios: ['Uno'] }, traducidas)).toThrow(/3\.2\.0/);
  });

  it('una traduccion con otro numero de cambios es un error', () => {
    expect(() => conTraducciones(notas, { '3.1.0': { en: ['One'] } })).toThrow(/en/);
  });

  it('un idioma que la app no tiene es un error: nadie lo leeria', () => {
    expect(() => conTraducciones(notas, { '3.1.0': { de: ['Eins', 'Zwei'] } })).toThrow(/de/);
  });
});
