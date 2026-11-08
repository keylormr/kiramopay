import type { Deteccion, MapaDeColumnas, Tabla } from './tipos';
import { normalizar } from './texto';

type Rol = keyof MapaDeColumnas;

// Del mas especifico al mas general: una columna "Monto credito" es credito.
const SINONIMOS: Array<[Rol, string[]]> = [
  ['fecha', ['fecha']],
  ['credito', ['credito', 'abono', 'deposito', 'haber']],
  ['debito', ['debito', 'cargo', 'retiro', 'debe']],
  ['moneda', ['moneda']],
  ['monto', ['monto', 'importe', 'valor']],
  ['descripcion', ['descripcion', 'detalle', 'concepto', 'movimiento']],
];

const FILAS_A_MIRAR = 40;

function sinPuntuacion(s: string): string {
  return normalizar(s).replace(/[^a-z0-9]+/g, ' ').trim();
}

/** 0 si no coincide; mas alto si es exacta y si el sinonimo va primero. */
function puntaje(celda: string, sinonimos: string[]): number {
  const c = sinPuntuacion(celda);
  if (!c) return 0;
  let mejor = 0;
  sinonimos.forEach((s, i) => {
    if (c === s || c === `${s}s` || c === `${s}es`) mejor = Math.max(mejor, 100 - i);
    else if (new RegExp(`(^| )${s}(s|es)?( |$)`).test(c)) mejor = Math.max(mejor, 50 - i);
  });
  return mejor;
}

function mapaVacio(): MapaDeColumnas {
  return { fecha: null, descripcion: null, credito: null, debito: null, monto: null, moneda: null };
}

function asignar(fila: Array<string | number>): MapaDeColumnas {
  const mapa = mapaVacio();
  const usadas = new Set<number>();
  for (const [rol, sinonimos] of SINONIMOS) {
    let mejorCol = -1;
    let mejor = 0;
    fila.forEach((celda, col) => {
      if (usadas.has(col) || typeof celda !== 'string') return;
      const p = puntaje(celda, sinonimos);
      if (p > mejor) { mejor = p; mejorCol = col; }
    });
    if (mejorCol >= 0) { mapa[rol] = mejorCol; usadas.add(mejorCol); }
  }
  // Un numero de referencia describe el movimiento solo si no hay nada mejor.
  if (mapa.descripcion === null) {
    const col = fila.findIndex((c, i) => !usadas.has(i) && typeof c === 'string' && puntaje(c, ['referencia']) > 0);
    if (col >= 0) mapa.descripcion = col;
  }
  return mapa;
}

const cuantos = (m: MapaDeColumnas) => Object.values(m).filter((x) => x !== null).length;
const sirve = (m: MapaDeColumnas) => m.fecha !== null && m.descripcion !== null && (m.credito !== null || m.monto !== null);

/**
 * Busca la fila de encabezados entre las primeras 40: los estados traen
 * renglones de portada (nombre, cuenta, periodo) antes de la tabla.
 */
export function detectarColumnas(tabla: Tabla): Deteccion {
  let mejor: Deteccion | null = null;
  let mejorN = 0;
  const limite = Math.min(tabla.length, FILAS_A_MIRAR);
  for (let i = 0; i < limite; i++) {
    const mapa = asignar(tabla[i]);
    if (sirve(mapa)) return { filaEncabezado: i, columnas: mapa, confiable: true };
    const n = cuantos(mapa);
    if (n > mejorN) { mejorN = n; mejor = { filaEncabezado: i, columnas: mapa, confiable: false }; }
  }
  if (mejor && mejorN >= 2) return mejor;
  // Sin pistas: la primera fila con varias celdas, para que la persona elija a mano.
  const i = tabla.slice(0, limite).findIndex((f) => f.filter((c) => String(c).trim() !== '').length >= 2);
  return { filaEncabezado: Math.max(0, i), columnas: mapaVacio(), confiable: false };
}
