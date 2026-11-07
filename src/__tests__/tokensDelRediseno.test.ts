import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Base del rediseno de 2026-11 (tema oscuro premium): los tokens de index.css
// cumplen contraste AA, la letra Geist se carga desde el repo y el movimiento
// tiene sus cuatro duraciones con una sola curva y respeta "reducir
// movimiento". Se lee el CSS porque jsdom no lo aplica.

const RAIZ = join(process.cwd(), 'src');
const css = readFileSync(join(RAIZ, 'index.css'), 'utf8');

function token(nombre: string): string {
  const m = new RegExp(`--${nombre}:\\s*([^;]+);`).exec(css);
  if (!m) throw new Error(`falta el token --${nombre}`);
  return m[1].trim();
}

type Rgb = [number, number, number];
function rgb(valor: string): Rgb {
  const hex = /^#([0-9a-f]{6})$/i.exec(valor);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)) as Rgb;
  throw new Error(`no es un color hex: ${valor}`);
}
function rgba(valor: string): { color: Rgb; alfa: number } {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(valor);
  if (!m) throw new Error(`no es rgba: ${valor}`);
  return { color: [Number(m[1]), Number(m[2]), Number(m[3])], alfa: Number(m[4]) };
}
const lineal = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const luminancia = ([r, g, b]: Rgb) => 0.2126 * lineal(r) + 0.7152 * lineal(g) + 0.0722 * lineal(b);
function contraste(a: Rgb, b: Rgb): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
const mezclar = (arriba: Rgb, alfa: number, abajo: Rgb): Rgb =>
  arriba.map((c, i) => Math.round(c * alfa + abajo[i] * (1 - alfa))) as Rgb;

const BLANCO: Rgb = [255, 255, 255];
const FONDOS_OSCUROS = ['color-background-dark', 'color-surface-1-dark', 'color-surface-2-dark', 'color-surface-3-dark'];

describe('tokens del tema oscuro', () => {
  it('son los del concepto aprobado', () => {
    expect(token('color-background-dark')).toBe('#050B18');
    expect(token('color-surface-1-dark')).toBe('#0A1428');
    expect(token('color-surface-2-dark')).toBe('#111D38');
    expect(token('color-surface-3-dark')).toBe('#121E38');
    expect(token('color-primary')).toBe('#2D7BFF');
    expect(token('color-primary-light')).toBe('#7DAAFF');
    expect(token('color-primary-tint')).toBe('#C9DAFF');
    expect(token('color-accent')).toBe('#FF8A2B');
    expect(token('color-text-primary-dark')).toBe('#EEF2F8');
    expect(token('color-text-secondary-dark')).toBe('#A7B4CB');
    expect(token('color-text-muted-dark')).toBe('#7F8DA8');
    expect(token('color-border-dark')).toBe('#16223D');
    expect(token('color-border-strong-dark')).toBe('#1E2B48');
    expect(token('color-success-strong-dark')).toBe('#4ADE9B');
    expect(token('color-warning-strong-dark')).toBe('#FBBF24');
    expect(token('color-danger-strong-dark')).toBe('#FF8A80');
  });

  const TEXTOS = [
    'color-text-primary-dark',
    'color-text-secondary-dark',
    'color-text-muted-dark',
    'color-primary-light',
    'color-success-strong-dark',
    'color-warning-strong-dark',
    'color-danger-strong-dark',
  ];
  for (const texto of TEXTOS) {
    for (const fondo of FONDOS_OSCUROS) {
      it(`AA: ${texto} sobre ${fondo} llega a 4,5:1`, () => {
        expect(contraste(rgb(token(texto)), rgb(token(fondo)))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('AA: la letra blanca de los botones llena llega a 4,5:1 (normal y al pasar el cursor)', () => {
    expect(contraste(BLANCO, rgb(token('color-primary-fill')))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(BLANCO, rgb(token('color-primary-hover')))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(BLANCO, rgb(token('color-danger-fill')))).toBeGreaterThanOrEqual(4.5);
  });

  it('el azul de marca como letra NO llega en las superficies altas: por eso el oscuro usa el claro', () => {
    // Si alguien sube --color-primary hasta pasar, esta prueba avisa que el
    // reemplazo (dark:text-[var(--color-primary-light)]) ya no hace falta.
    expect(contraste(rgb(token('color-primary')), rgb(token('color-surface-3-dark')))).toBeLessThan(4.5);
  });

  it('AA: el texto de cada estado sobre su chip, encima de la superficie mas alta', () => {
    const sup = rgb(token('color-surface-3-dark'));
    for (const [suave, fuerte] of [
      ['color-success-soft', 'color-success-strong-dark'],
      ['color-warning-soft', 'color-warning-strong-dark'],
      ['color-danger-soft', 'color-danger-strong-dark'],
      ['color-primary-soft', 'color-info-strong-dark'],
    ]) {
      const { color, alfa } = rgba(token(suave));
      expect(contraste(rgb(token(fuerte)), mezclar(color, alfa, sup)), fuerte).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('el borde de un campo de texto llega a 3:1 (WCAG 1.4.11) sobre todos los fondos', () => {
    for (const fondo of FONDOS_OSCUROS) {
      expect(contraste(rgb(token('color-border-control-dark')), rgb(token(fondo))), fondo).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('letra Geist', () => {
  it('se carga desde el repo, con font-display: swap y todos los pesos', () => {
    const cara = /@font-face\s*{[^}]*}/.exec(css)?.[0] ?? '';
    expect(cara).toContain('font-family: "Geist"');
    expect(cara).toContain('font-display: swap');
    expect(cara).toContain('font-weight: 100 900');
    const archivo = /url\("\.\/([^"]+\.woff2)"\)/.exec(cara)?.[1];
    expect(archivo).toBeTruthy();
    expect(existsSync(join(RAIZ, archivo!))).toBe(true);
    // La licencia viaja con la fuente (OFL 1.1).
    expect(existsSync(join(RAIZ, 'assets/fonts/geist/OFL.txt'))).toBe(true);
  });

  it('es la primera de la pila: antes se declaraba Inter y nunca se cargaba', () => {
    expect(token('font-sans').startsWith('"Geist"')).toBe(true);
    expect(css).not.toMatch(/"Inter"/);
  });

  it('los montos usan cifras de ancho fijo', () => {
    expect(css).toMatch(/\.kp-num[^{]*{[^}]*font-variant-numeric: tabular-nums/);
  });
});

describe('movimiento', () => {
  it('cuatro duraciones y una sola curva', () => {
    expect(token('kp-mov-toque')).toBe('120ms');
    expect(token('kp-mov-estado')).toBe('200ms');
    expect(token('kp-mov-hoja')).toBe('320ms');
    expect(token('kp-mov-cifra')).toBe('450ms');
    expect(token('kp-curva')).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
  });

  it('con "reducir movimiento" las duraciones valen cero', () => {
    const bloques = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*{([\s\S]*?)\n}/g)].map((m) => m[1]);
    const conTokens = bloques.find((b) => b.includes('--kp-mov-toque'));
    expect(conTokens).toBeDefined();
    for (const nombre of ['toque', 'estado', 'hoja', 'cifra']) {
      expect(conTokens).toContain(`--kp-mov-${nombre}: 0ms`);
    }
  });
});

describe('letra del colon', () => {
  const cara = [...css.matchAll(/@font-face\s*{[^}]*}/g)].map((m) => m[0]).find((c) => c.includes('"Inter Colon"')) ?? '';

  it('el ₡ viene de Inter recortada al glifo, solo cuando la pagina lo usa', () => {
    expect(cara).toContain('unicode-range: U+20A1;');
    expect(cara).toContain('font-weight: 100 900');
    expect(cara).toContain('font-display: swap');
    const archivo = /url\("\.\/([^"]+\.woff2)"\)/.exec(cara)?.[1];
    expect(archivo).toBe('assets/fonts/inter/Inter-Colon.woff2');
    // Un solo glifo: unos pocos KB, no los 350 KB de Inter completa.
    expect(statSync(join(RAIZ, archivo!)).size).toBeLessThan(4096);
    expect(readFileSync(join(RAIZ, 'assets/fonts/inter/OFL.txt'), 'utf8')).toContain('SIL Open Font License, Version 1.1');
  });

  it('va justo despues de Geist en la pila, con su altura de mayusculas igualada', () => {
    expect(token('font-sans').startsWith('"Geist", "Inter Colon",')).toBe(true);
    // Altura de mayusculas: Geist 0,71 em, Inter 0,7275 em.
    expect(cara).toContain(`size-adjust: ${((0.71 / 0.7275) * 100).toFixed(1)}%;`);
  });
});

describe('esquema de color y barras de desplazamiento', () => {
  it('la raiz declara el esquema del tema elegido, no el del sistema', () => {
    expect(css).toMatch(/:root\s*{[^}]*color-scheme: light;/);
    expect(css).toMatch(/:root\.dark\s*{[^}]*color-scheme: dark;/);
    expect(readFileSync(join(process.cwd(), 'index.html'), 'utf8')).toContain('<meta name="color-scheme" content="dark light" />');
  });

  it('la barra es fina y su pulgar llega a 3:1 contra el fondo en los dos temas', () => {
    expect(css).toMatch(/:root\s*{[^}]*scrollbar-width: thin;/);
    expect(css).toMatch(/:root\.dark\s*{[^}]*scrollbar-color: var\(--color-border-control-dark\) transparent;/);
    expect(css).toMatch(/:root\s*{[^}]*scrollbar-color: var\(--color-text-muted\) transparent;/);
    expect(contraste(rgb(token('color-border-control-dark')), rgb(token('color-background-dark')))).toBeGreaterThanOrEqual(3);
    expect(contraste(rgb(token('color-text-muted')), rgb(token('color-background')))).toBeGreaterThanOrEqual(3);
  });
});

describe('menu lateral plegable', () => {
  it('plegado en ventana expandida mide lo mismo que el riel, y todo sale de --kp-nav-ancho', () => {
    const expandida = /@media \(min-width: 52\.5rem\)\s*{([\s\S]*?)\n}/.exec(css)?.[1] ?? '';
    expect(expandida).toMatch(/\.kp-marco\s*{\s*--kp-nav-ancho: calc\(256px \+ env\(safe-area-inset-left, 0px\)\);/);
    expect(expandida).toMatch(/\.kp-marco\[data-menu='plegado'\]\s*{\s*--kp-nav-ancho: calc\(88px \+ env\(safe-area-inset-left, 0px\)\);/);
    // Las pantallas completas acompanan al menu con la misma curva y duracion.
    expect(css).toMatch(/\.kp-capa\s*{[^}]*left: var\(--kp-nav-ancho\);[^}]*transition: left var\(--kp-mov-hoja\) var\(--kp-curva-hoja\);/);
  });
});

describe('pantallas completas en pantalla ancha', () => {
  const regla = /@container capa \(min-width: 42rem\)\s*{([\s\S]*?)\n}/.exec(css)?.[1] ?? '';

  it('toman la columna de 42rem segun el ancho real de la capa, no el de la ventana', () => {
    expect(css).toMatch(/\.kp-capa\s*{[^}]*container: capa \/ inline-size;/);
    expect(regla).toContain('padding-inline: max(1rem, calc((100% - var(--kp-columna, 42rem)) / 2 + 1rem));');
    expect(regla).toContain('max-width: var(--kp-columna, 42rem);');
    // Con px-4 en el contenedor o mx-4 en el bloque, 1rem menos por lado: el
    // texto del cuerpo queda debajo del de la cabecera.
    expect(regla).toContain('max-width: calc(var(--kp-columna, 42rem) - 2rem);');
  });

  it('respetan el max-w propio de una vista y dejan salir a las que necesitan todo el ancho', () => {
    expect(regla).toContain(":not([class*='max-w-'])");
    expect(regla).toContain(":not([data-ancho='libre'])");
  });
});

describe('una sola barra de desplazamiento con una pantalla completa abierta', () => {
  it('la pagina de abajo no se desplaza mientras haya una capa montada', () => {
    expect(css).toMatch(/html:has\(\.kp-capa\)\s*{\s*overflow: hidden;\s*}/);
  });

  it('el contenedor de la capa no le pasa el gesto a la raiz al llegar al final', () => {
    // Solo el principal: las listas de adentro si encadenan con el.
    expect(css).toMatch(/\.kp-capa > \.overflow-y-auto\s*{\s*overscroll-behavior-y: contain;\s*}/);
    expect(css).not.toMatch(/\.kp-capa \.overflow-y-auto\s*{/);
  });

  it('al bloquear la raiz el ancho no cambia: el hueco de la barra se guarda', () => {
    expect(css).toMatch(/html\s*{\s*scrollbar-gutter: stable;\s*}/);
  });

  it('la pista no usa translate de -50 %: la animacion de entrada lo pisaba', () => {
    const pista = /@keyframes kp-pista-entra\s*{([\s\S]*?)\n}/.exec(css)?.[1] ?? '';
    expect(pista).not.toContain('-50%');
    expect(css).toMatch(/\[data-lado='abajo'\] > \.kp-pista\s*{\s*animation-name: kp-pista-baja;/);
  });
});
