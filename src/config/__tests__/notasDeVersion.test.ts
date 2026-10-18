import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { notasDeVersion, cuerpoDelRelease } from '../../../scripts/notas-de-version.mjs';
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
            'Uno con \'comillas\' adentro',
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
