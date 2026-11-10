import { rellenar } from '@/utils/planes';
import type { ContenidoPdf, FilaPdf } from './pdfContenido';

/**
 * Pagina carta en puntos (1 pt = 1/72 de pulgada). En Costa Rica el papel de
 * oficina es carta, aunque la norma oficial sea ISO A4.
 */
export const ANCHO = 612;
export const ALTO = 792;

const MARGEN = 48;
const ANCHO_UTIL = ANCHO - MARGEN * 2;
/** Hasta donde llega el contenido; debajo va el pie. */
const LIMITE_Y = ALTO - 72;

// Gris sobre blanco con contraste de sobra para imprimirse en blanco y negro.
const TEXTO = '#111827';
const SUAVE = '#4b5563';
const LINEA = '#d1d5db';
const FONDO = '#f3f4f6';

export type Peso = 400 | 600 | 700;
export interface Fuente {
  tam: number;
  peso: Peso;
}
/** Ancho en puntos de un texto con esa fuente. Lo mide el canvas; en las pruebas, una cuenta. */
export type Medidor = (texto: string, fuente: Fuente) => number;

export type Alinear = 'izq' | 'der' | 'centro';
export type Orden =
  | { tipo: 'texto'; x: number; y: number; texto: string; fuente: Fuente; color: string; alinear: Alinear }
  | { tipo: 'linea'; x1: number; x2: number; y: number; grosor: number; color: string }
  | { tipo: 'caja'; x: number; y: number; ancho: number; alto: number; color: string; radio: number };

export interface Pagina {
  ordenes: Orden[];
}

const F_TITULO: Fuente = { tam: 20, peso: 700 };
const F_SUBTITULO: Fuente = { tam: 11, peso: 400 };
const F_ROTULO: Fuente = { tam: 10.5, peso: 600 };
const F_TOTAL: Fuente = { tam: 28, peso: 700 };
const F_CANTIDAD: Fuente = { tam: 10.5, peso: 400 };
const F_AVISO: Fuente = { tam: 9.5, peso: 400 };
const F_NOTA: Fuente = { tam: 9, peso: 400 };
const F_SECCION: Fuente = { tam: 12, peso: 700 };
const F_CABECERA: Fuente = { tam: 8.5, peso: 600 };
const F_FILA: Fuente = { tam: 9.5, peso: 400 };
const F_FILA_MONTO: Fuente = { tam: 9.5, peso: 600 };
const F_CORRIDO: Fuente = { tam: 9, peso: 600 };
const F_PIE: Fuente = { tam: 8, peso: 400 };

const INTER = 1.4;
const PAD_FILA = 5;

// Columnas de la tabla: fecha, descripcion, monto (a la derecha) y "es venta".
const GAP = 10;
const W_FECHA = 64;
const W_MONTO = 104;
const W_VENTA = 46;
const W_DESC = ANCHO_UTIL - W_FECHA - W_MONTO - W_VENTA - GAP * 3;
const X_FECHA = MARGEN;
const X_DESC = X_FECHA + W_FECHA + GAP;
const X_MONTO = X_DESC + W_DESC + GAP;
const X_VENTA = X_MONTO + W_MONTO + GAP;

type Segmentador = { segment(texto: string): Iterable<{ segment: string }> };

/** Letras tal como se ven (con sus marcas combinadas): hindi y acentos no se parten. */
function letras(texto: string): string[] {
  const I = Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: 'grapheme' }) => Segmentador };
  if (typeof I.Segmenter === 'function') {
    return Array.from(new I.Segmenter(undefined, { granularity: 'grapheme' }).segment(texto), (s) => s.segment);
  }
  return Array.from(texto);
}

/**
 * Parte un texto en renglones del ancho dado. Corta en espacios; una palabra mas
 * ancha que el renglon (o un texto sin espacios, como el chino y el japones) se
 * corta letra por letra.
 */
export function envolver(texto: string, ancho: number, fuente: Fuente, medir: Medidor): string[] {
  const renglones: string[] = [];
  let actual = '';
  for (const palabra of texto.split(' ')) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (medir(candidata, fuente) <= ancho) {
      actual = candidata;
      continue;
    }
    if (actual) {
      renglones.push(actual);
      actual = '';
    }
    if (medir(palabra, fuente) <= ancho) {
      actual = palabra;
      continue;
    }
    let trozo = '';
    for (const letra of letras(palabra)) {
      if (trozo && medir(trozo + letra, fuente) > ancho) {
        renglones.push(trozo);
        trozo = letra;
      } else {
        trozo += letra;
      }
    }
    actual = trozo;
  }
  if (actual) renglones.push(actual);
  return renglones.length > 0 ? renglones : [''];
}

/**
 * Reparte el contenido en paginas carta. Devuelve ordenes de dibujo con
 * coordenadas en puntos (origen arriba a la izquierda; `y` de un texto es su
 * linea base), sin tocar el canvas: se prueba con un medidor falso.
 *
 * Una fila nunca se parte entre dos paginas; al seguir en la pagina siguiente se
 * repiten los encabezados de columna, y todas las paginas llevan pie con su
 * numero.
 */
export function disenar(c: ContenidoPdf, medir: Medidor): Pagina[] {
  const paginas: Pagina[] = [];
  let ordenes: Orden[] = [];
  let y = MARGEN;

  const texto = (x: number, base: number, t: string, fuente: Fuente, color: string, alinear: Alinear = 'izq') => {
    ordenes.push({ tipo: 'texto', x, y: base, texto: t, fuente, color, alinear });
  };
  const regla = (en: number, color = LINEA, x1 = MARGEN, x2 = ANCHO - MARGEN) => {
    ordenes.push({ tipo: 'linea', x1, x2, y: en, grosor: 0.6, color });
  };
  /** Un bloque de texto con renglones; devuelve su alto. */
  const bloque = (t: string, x: number, ancho: number, fuente: Fuente, color: string, desde: number): number => {
    const renglones = envolver(t, ancho, fuente, medir);
    const inter = fuente.tam * INTER;
    renglones.forEach((r, i) => texto(x, desde + fuente.tam * 1.05 + i * inter, r, fuente, color));
    return renglones.length * inter;
  };
  const altoDe = (t: string, ancho: number, fuente: Fuente) => envolver(t, ancho, fuente, medir).length * fuente.tam * INTER;

  const abrir = (primera: boolean) => {
    ordenes = [];
    paginas.push({ ordenes });
    y = MARGEN;
    if (!primera) {
      y += bloque(`${c.titulo} · ${c.subtitulo}`, MARGEN, ANCHO_UTIL, F_CORRIDO, SUAVE, y);
      y += 4;
      regla(y);
      y += 14;
    }
  };

  const cabeceraDeTabla = () => {
    const celdas: Array<[string, number, number, Alinear]> = [
      [c.columnas.fecha, X_FECHA, W_FECHA, 'izq'],
      [c.columnas.descripcion, X_DESC, W_DESC, 'izq'],
      [c.columnas.monto, X_MONTO + W_MONTO, W_MONTO, 'der'],
      [c.columnas.venta, X_VENTA + W_VENTA / 2, W_VENTA, 'centro'],
    ];
    let alto = 0;
    for (const [t, x, ancho, alinear] of celdas) {
      const renglones = envolver(t, ancho, F_CABECERA, medir);
      const inter = F_CABECERA.tam * INTER;
      renglones.forEach((r, i) => texto(x, y + F_CABECERA.tam * 1.05 + i * inter, r, F_CABECERA, SUAVE, alinear));
      alto = Math.max(alto, renglones.length * inter);
    }
    y += alto + 3;
    regla(y, SUAVE);
  };
  const altoCabecera = () =>
    Math.max(
      ...[
        [c.columnas.fecha, W_FECHA],
        [c.columnas.descripcion, W_DESC],
        [c.columnas.monto, W_MONTO],
        [c.columnas.venta, W_VENTA],
      ].map(([t, a]) => altoDe(t as string, a as number, F_CABECERA)),
    ) + 3;

  const altoFila = (f: FilaPdf) => Math.max(1, envolver(f.descripcion, W_DESC, F_FILA, medir).length) * F_FILA.tam * INTER + PAD_FILA * 2;

  const fila = (f: FilaPdf) => {
    const alto = altoFila(f);
    const base = y + PAD_FILA + F_FILA.tam * 1.05;
    texto(X_FECHA, base, f.fecha, F_FILA, TEXTO);
    envolver(f.descripcion, W_DESC, F_FILA, medir).forEach((r, i) =>
      texto(X_DESC, base + i * F_FILA.tam * INTER, r, F_FILA, TEXTO),
    );
    texto(X_MONTO + W_MONTO, base, f.monto, F_FILA_MONTO, TEXTO, 'der');
    texto(X_VENTA + W_VENTA / 2, base, f.venta, F_FILA, TEXTO, 'centro');
    y += alto;
    regla(y);
  };

  // --- Primera pagina: encabezado, total y aviso ---
  abrir(true);
  y += bloque(c.titulo, MARGEN, ANCHO_UTIL, F_TITULO, TEXTO, y);
  y += 2;
  y += bloque(c.subtitulo, MARGEN, ANCHO_UTIL, F_SUBTITULO, SUAVE, y);
  y += 16;

  // Caja del total.
  const PAD = 16;
  const anchoCaja = ANCHO_UTIL - PAD * 2;
  const hRotulo = altoDe(c.rotuloTotal, anchoCaja, F_ROTULO);
  const hTotal = F_TOTAL.tam * 1.25;
  const hCantidad = altoDe(c.cantidad, anchoCaja, F_CANTIDAD);
  const altoCaja = PAD + hRotulo + 2 + hTotal + 2 + hCantidad + PAD;
  ordenes.push({ tipo: 'caja', x: MARGEN, y, ancho: ANCHO_UTIL, alto: altoCaja, color: FONDO, radio: 10 });
  let dentro = y + PAD;
  dentro += bloque(c.rotuloTotal, MARGEN + PAD, anchoCaja, F_ROTULO, SUAVE, dentro) + 2;
  texto(MARGEN + PAD, dentro + F_TOTAL.tam * 0.95, c.total, F_TOTAL, TEXTO);
  dentro += hTotal + 2;
  bloque(c.cantidad, MARGEN + PAD, anchoCaja, F_CANTIDAD, SUAVE, dentro);
  y += altoCaja + 12;

  // Aviso: una barra a la izquierda para que no se lea como letra chica.
  const hAviso = altoDe(c.aviso, ANCHO_UTIL - 14, F_AVISO);
  ordenes.push({ tipo: 'caja', x: MARGEN, y, ancho: 3, alto: hAviso, color: SUAVE, radio: 1.5 });
  bloque(c.aviso, MARGEN + 14, ANCHO_UTIL - 14, F_AVISO, TEXTO, y);
  y += hAviso + 8;

  for (const nota of c.notas) {
    y += bloque(nota, MARGEN, ANCHO_UTIL, F_NOTA, SUAVE, y) + 4;
  }
  y += 10;

  // --- Secciones ---
  for (const s of c.secciones) {
    const alto = altoDe(s.titulo, ANCHO_UTIL, F_SECCION) + 6;
    const primeraFila = s.filas.length > 0 ? altoCabecera() + altoFila(s.filas[0]) : altoDe(s.vacio ?? '', ANCHO_UTIL, F_NOTA);
    if (y + alto + primeraFila > LIMITE_Y) abrir(false);

    y += bloque(s.titulo, MARGEN, ANCHO_UTIL, F_SECCION, TEXTO, y) + 6;
    if (s.filas.length === 0) {
      y += bloque(s.vacio ?? '', MARGEN, ANCHO_UTIL, { tam: 10, peso: 400 }, SUAVE, y) + 12;
      continue;
    }
    cabeceraDeTabla();
    for (const f of s.filas) {
      if (y + altoFila(f) > LIMITE_Y) {
        abrir(false);
        cabeceraDeTabla();
      }
      fila(f);
    }
    y += 22;
  }

  // --- Pie de cada pagina ---
  const total = paginas.length;
  paginas.forEach((p, i) => {
    ordenes = p.ordenes;
    regla(ALTO - 54);
    texto(MARGEN, ALTO - 38, c.pie, F_PIE, SUAVE);
    texto(ANCHO - MARGEN, ALTO - 38, rellenar(c.pagina, { n: i + 1, total }), F_PIE, SUAVE, 'der');
  });

  return paginas;
}
