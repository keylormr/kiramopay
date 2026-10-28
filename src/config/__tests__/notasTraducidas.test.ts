import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import notasTraducidas from '../notasTraducidas.json';
import { getAllVersions, cambiosEn, cargarNotasTraducidas, type VersionInfo, type NotasTraducidas } from '../version';
import { LANGUAGES, type Language } from '@/i18n/translations';

// Las notas de version (lo que la persona lee en Perfil > Acerca de, y lo que
// el aviso de actualizacion cuenta de la version nueva) estaban solo en espanol.
// Estan traducidas a los demas idiomas de la app en notasTraducidas.json, una
// lista por version y por idioma, en el mismo orden que el changelog.

const traducidos = LANGUAGES.map((l) => l.code).filter((c) => c !== 'es');
const porVersion = notasTraducidas as Record<string, Record<string, string[]>>;

describe('las notas de version estan traducidas', () => {
  it('hay seis idiomas ademas del espanol', () => {
    expect(traducidos).toEqual(['en', 'fr', 'pt', 'zh-cn', 'ja', 'hi']);
  });

  it.each(getAllVersions().map((v) => v.version))('la %s trae los seis idiomas, un texto por cambio', (version) => {
    const original = getAllVersions().find((v) => v.version === version)!;
    const traducciones = porVersion[version];
    expect(traducciones, `falta ${version} en notasTraducidas.json`).toBeDefined();
    expect(Object.keys(traducciones).sort()).toEqual([...traducidos].sort());
    for (const idioma of traducidos) {
      const textos = traducciones[idioma];
      expect(textos, `${version} en ${idioma}`).toHaveLength(original.changes.length);
      textos.forEach((texto, i) => {
        expect(texto.trim(), `${version}/${idioma}/${i} vacio`).not.toBe('');
        // Una traduccion que es el espanol con otra etiqueta no esta traducida.
        expect(texto, `${version}/${idioma}/${i} es el texto en espanol`).not.toBe(original.changes[i]);
        // Sin emojis ni Markdown: el texto va tal cual a la pantalla.
        expect(texto).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
        expect(texto).not.toMatch(/^\s*[-*]\s|\*\*|`/);
      });
    }
  });

  it('no hay traducciones de versiones que ya no estan en el changelog', () => {
    const versiones = new Set(getAllVersions().map((v) => v.version));
    expect(Object.keys(porVersion).filter((v) => !versiones.has(v))).toEqual([]);
  });
});

describe('cambiosEn', () => {
  const version: VersionInfo = getAllVersions()[0];
  const tabla = porVersion as NotasTraducidas;

  it('en espanol devuelve los cambios del changelog', () => {
    expect(cambiosEn(version, 'es', tabla)).toEqual(version.changes);
  });

  it.each(traducidos)('en %s devuelve la traduccion de esa version', (idioma) => {
    expect(cambiosEn(version, idioma as Language, tabla)).toEqual(porVersion[version.version][idioma]);
  });

  it('mientras las traducciones no llegan, sale el espanol', () => {
    expect(cambiosEn(version, 'en')).toEqual(version.changes);
  });

  it('una version sin traduccion sale en espanol, no vacia', () => {
    const sinTraducir: VersionInfo = { version: '99.0.0', buildNumber: 99, releaseDate: '2099-01-01', changes: ['Algo nuevo'] };
    expect(cambiosEn(sinTraducir, 'en', tabla)).toEqual(['Algo nuevo']);
  });

  it('una traduccion con otro numero de cambios no se usa: se corrian los textos', () => {
    const cojea: VersionInfo = { version: '2.8.0', buildNumber: 18, releaseDate: '2026-10-18', changes: ['Uno', 'Dos'] };
    expect(cambiosEn(cojea, 'en', tabla)).toEqual(['Uno', 'Dos']);
  });
});

// El archivo pesa unos 90 KB y el CI limita cada chunk a 200 KB: si version.ts lo
// importa de forma estatica, entra al chunk principal (con las notas en seis
// idiomas, el principal pasaba de 200 KB). Se pide con import() solo cuando
// alguien abre "Acerca de" en un idioma que no es el espanol.
describe('las notas traducidas no viajan en el chunk principal', () => {
  it('version.ts no importa notasTraducidas.json de forma estatica', () => {
    const fuente = readFileSync(path.resolve(__dirname, '../version.ts'), 'utf8');
    expect(fuente).not.toMatch(/^\s*import\s[^;]*notasTraducidas\.json/m);
    expect(fuente).toMatch(/import\(\s*'\.\/notasTraducidas\.json'\s*\)/);
  });

  it('ningun otro archivo de la app lo importa de forma estatica', () => {
    const modulos = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<
      string,
      string
    >;
    const culpables = Object.entries(modulos)
      .filter(([ruta]) => !ruta.includes('/__tests__/'))
      .filter(([, fuente]) => /^\s*import\s[^;]*notasTraducidas\.json/m.test(fuente))
      .map(([ruta]) => ruta);
    expect(culpables).toEqual([]);
  });

  it('cargarNotasTraducidas trae el mismo archivo', async () => {
    expect(await cargarNotasTraducidas()).toEqual(porVersion);
  });
});
