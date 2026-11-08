import type { Celda } from './tipos';
import { normalizar } from './texto';

const MESES: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7,
  ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

function diasDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** AAAA-MM-DD si la fecha existe; una imposible (31/02) se rechaza, no se corre. */
function validar(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > diasDelMes(y, m)) return null;
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${y}-${dos(m)}-${dos(d)}`;
}

function anio(texto: string): number {
  const n = Number(texto);
  return texto.length <= 2 ? 2000 + n : n;
}

/** Fecha en cualquiera de los formatos aceptados, siempre con el dia primero. */
export function leerFecha(valor: Celda | undefined): string | null {
  if (valor === undefined || valor === null || valor === '') return null;
  if (typeof valor === 'number' || /^\d{5}(\.\d+)?$/.test(String(valor).trim())) {
    const serial = Number(valor);
    if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
    const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
    return validar(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
  }
  const s = normalizar(String(valor));
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/.exec(s);
  if (m) return validar(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/.exec(s);
  if (m) return validar(anio(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[\s\-/.]*(?:de\s+)?([a-z]{3,})\.?[\s\-/.,]*(?:de\s+)?(\d{4}|\d{2})(?!\d)/.exec(s);
  if (m) {
    const mes = MESES[m[2].slice(0, 3)];
    return mes ? validar(anio(m[3]), mes, Number(m[1])) : null;
  }
  return null;
}
