import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// La barra inferior estaba al 95 % de opacidad con desenfoque: a 390 px se
// adivinaba el texto de la lista que pasa por detras ("-₡1.00" bajo "Inicio").
// Una barra de navegacion fija no necesita transparencia: va opaca, en claro y
// en oscuro. (El recorrido, en recorrido/flujos/16-telefono.mjs, exige al menos
// 0,9 de opacidad en el navegador; esta prueba corre antes, sin navegador.)
//
// jsdom no resuelve las clases de Tailwind, asi que se lee la declaracion de la
// barra en App.tsx.

const fuente = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
const clasesDeLaBarra = (/<nav\b[^>]*\bclassName="([^"]+)"/.exec(fuente)?.[1] ?? '').split(/\s+/).filter(Boolean);

describe('la barra inferior de navegacion', () => {
  it('se encontro la barra en App.tsx (si no, esta prueba ya no vigila nada)', () => {
    expect(clasesDeLaBarra).toContain('fixed');
    expect(clasesDeLaBarra).toContain('bottom-0');
  });

  it('no usa un fondo con transparencia', () => {
    const translucidas = clasesDeLaBarra.filter(
      (c) => /\buv-surface-\d+\/\d+$/.test(c) || /^(dark:)?bg-.+\/\d+$/.test(c) || /^(dark:)?bg-.+\/\[[\d.]+\]$/.test(c),
    );
    expect(translucidas).toEqual([]);
  });

  it('no desenfoca lo que pasa por detras: sin transparencia no hay nada que desenfocar', () => {
    expect(clasesDeLaBarra.filter((c) => c.includes('backdrop-blur'))).toEqual([]);
  });

  it('pone un fondo solido de la superficie, en claro y en oscuro', () => {
    expect(clasesDeLaBarra).toContain('bg-[var(--color-surface-1)]');
    expect(clasesDeLaBarra).toContain('dark:bg-[var(--color-surface-1-dark)]');
  });
});
