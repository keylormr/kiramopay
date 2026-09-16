/**
 * Periodos de fechas para la pantalla de analisis.
 *
 * Todo se cuenta en DIAS CIVILES de Costa Rica, igual que el resumen del
 * servidor (GET /transactions/summary): un gasto de las 11 p. m. del 31 de julio
 * es de julio aunque en UTC ya sea agosto, y aunque el telefono este en otra
 * zona horaria.
 *
 * Una fecha civil viaja como texto 'YYYY-MM-DD'. La aritmetica se hace sobre
 * Date.UTC para que ningun horario de verano del dispositivo corra un dia.
 *
 * Un rango es [desde, hasta): desde incluido, hasta EXCLUIDO, como en el
 * servidor. Agosto de 2026 es exactamente ['2026-08-01', '2026-09-01').
 */

export type FechaCivil = string;

export interface Rango {
  desde: FechaCivil;
  hasta: FechaCivil;
}

export type Granularidad = 'dia' | 'semana' | 'mes';

export type Preset = 'este_mes' | 'mes_pasado' | 'ultimos_30' | 'este_ano';

/** Costa Rica no tiene horario de verano desde 1992: el desfase es fijo. */
const DESFASE_CR_MS = -6 * 3600 * 1000;
const DIA_MS = 86_400_000;

/** El servidor rechaza rangos mas largos (dos anos bisiestos). */
export const MAX_DIAS_RANGO = 732;

function partes(f: FechaCivil): [number, number, number] {
  const [y, m, d] = f.split('-').map(Number);
  return [y, m, d];
}

function aMs(f: FechaCivil): number {
  const [y, m, d] = partes(f);
  return Date.UTC(y, m - 1, d);
}

function deMs(ms: number): FechaCivil {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Fecha civil de Costa Rica de un instante. */
export function fechaCivilCR(instante: number | Date): FechaCivil {
  const ms = typeof instante === 'number' ? instante : instante.getTime();
  return deMs(ms + DESFASE_CR_MS);
}

/** Hoy en Costa Rica. */
export function hoyCR(ahora: number = Date.now()): FechaCivil {
  return fechaCivilCR(ahora);
}

export function sumarDias(f: FechaCivil, n: number): FechaCivil {
  return deMs(aMs(f) + n * DIA_MS);
}

export function inicioMes(f: FechaCivil): FechaCivil {
  const [y, m] = partes(f);
  return deMs(Date.UTC(y, m - 1, 1));
}

/** Primer dia del mes desplazado n meses. */
export function sumarMeses(f: FechaCivil, n: number): FechaCivil {
  const [y, m] = partes(f);
  return deMs(Date.UTC(y, m - 1 + n, 1));
}

export function inicioAno(f: FechaCivil): FechaCivil {
  return `${partes(f)[0]}-01-01`;
}

export function diasEntre(desde: FechaCivil, hasta: FechaCivil): number {
  return Math.round((aMs(hasta) - aMs(desde)) / DIA_MS);
}

/** Dia de la semana (0 = domingo) de una fecha civil. */
export function diaSemana(f: FechaCivil): number {
  return new Date(aMs(f)).getUTCDay();
}

export function mesCompleto(anio: number, mes1a12: number): Rango {
  const desde = deMs(Date.UTC(anio, mes1a12 - 1, 1));
  return { desde, hasta: sumarMeses(desde, 1) };
}

export function rangoPreset(preset: Preset, hoy: FechaCivil): Rango {
  switch (preset) {
    case 'este_mes':
      return { desde: inicioMes(hoy), hasta: sumarMeses(hoy, 1) };
    case 'mes_pasado':
      return { desde: sumarMeses(hoy, -1), hasta: inicioMes(hoy) };
    case 'ultimos_30':
      return { desde: sumarDias(hoy, -29), hasta: sumarDias(hoy, 1) };
    case 'este_ano': {
      const desde = inicioAno(hoy);
      return { desde, hasta: `${partes(hoy)[0] + 1}-01-01` };
    }
  }
}

export const PRESETS: Preset[] = ['este_mes', 'mes_pasado', 'ultimos_30', 'este_ano'];

export function mismosRangos(a: Rango, b: Rango): boolean {
  return a.desde === b.desde && a.hasta === b.hasta;
}

/** El rango cubre exactamente un mes calendario. */
export function esMesCompleto(r: Rango): boolean {
  return partes(r.desde)[2] === 1 && sumarMeses(r.desde, 1) === r.hasta;
}

/** El rango cubre exactamente un ano calendario. */
export function esAnoCompleto(r: Rango): boolean {
  const [y, m, d] = partes(r.desde);
  return m === 1 && d === 1 && r.hasta === `${y + 1}-01-01`;
}

/**
 * La parte del rango que ya ocurrio: hasta mañana como mucho. "Este mes" es el
 * mes entero, pero un promedio por dia no puede dividir entre dias que no
 * llegaron.
 */
export function parteTranscurrida(r: Rango, hoy: FechaCivil): Rango | null {
  const tope = sumarDias(hoy, 1);
  const hasta = r.hasta < tope ? r.hasta : tope;
  if (hasta <= r.desde) return null;
  return { desde: r.desde, hasta };
}

/**
 * El periodo contra el cual comparar, del mismo largo que la parte transcurrida.
 *
 * - Un mes calendario se compara contra el mes anterior, en los mismos dias:
 *   del 1 al 13 de septiembre contra del 1 al 13 de agosto. Comparar trece dias
 *   contra un mes entero diria "gastaste 60% menos" sin que sea cierto.
 * - Un ano calendario, contra el mismo tramo del ano anterior.
 * - Cualquier otro rango, contra los mismos dias inmediatamente antes.
 *
 * Devuelve null si el rango todavia no empezo.
 */
export function periodoAnterior(r: Rango, hoy: FechaCivil): Rango | null {
  const hecho = parteTranscurrida(r, hoy);
  if (!hecho) return null;
  const largo = diasEntre(hecho.desde, hecho.hasta);
  if (esMesCompleto(r)) {
    const desde = sumarMeses(r.desde, -1);
    const hasta = sumarDias(desde, largo);
    return { desde, hasta: hasta < r.desde ? hasta : r.desde };
  }
  if (esAnoCompleto(r)) {
    const desde = `${partes(r.desde)[0] - 1}-01-01`;
    const hasta = sumarDias(desde, largo);
    return { desde, hasta: hasta < r.desde ? hasta : r.desde };
  }
  return { desde: sumarDias(r.desde, -largo), hasta: r.desde };
}

/**
 * Mover el rango un paso hacia atras (-1) o adelante (+1): un mes si es un mes,
 * un ano si es un ano, y si no, su mismo largo. Devuelve null si el paso cae
 * entero en el futuro.
 */
export function desplazar(r: Rango, paso: 1 | -1, hoy: FechaCivil): Rango | null {
  let nuevo: Rango;
  if (esMesCompleto(r)) {
    const desde = sumarMeses(r.desde, paso);
    nuevo = { desde, hasta: sumarMeses(desde, 1) };
  } else if (esAnoCompleto(r)) {
    const y = partes(r.desde)[0] + paso;
    nuevo = { desde: `${y}-01-01`, hasta: `${y + 1}-01-01` };
  } else {
    const largo = diasEntre(r.desde, r.hasta);
    nuevo = { desde: sumarDias(r.desde, paso * largo), hasta: sumarDias(r.hasta, paso * largo) };
  }
  return nuevo.desde > hoy ? null : nuevo;
}

/** Cuanto agrupar para que las barras se lean: dia, semana o mes. */
export function granularidadDe(r: Rango): Granularidad {
  const dias = diasEntre(r.desde, r.hasta);
  if (dias <= 31) return 'dia';
  if (dias <= 120) return 'semana';
  return 'mes';
}

export interface Tramo {
  clave: FechaCivil;
  desde: FechaCivil;
  hasta: FechaCivil;
}

/** Lunes de la semana de una fecha (semanas de lunes a domingo). */
function lunesDe(f: FechaCivil): FechaCivil {
  const dow = diaSemana(f);
  return sumarDias(f, dow === 0 ? -6 : 1 - dow);
}

/** Los tramos del rango, recortados a sus bordes. */
export function tramosDe(r: Rango, g: Granularidad): Tramo[] {
  const tramos: Tramo[] = [];
  let desde = r.desde;
  // Tope defensivo: un rango valido nunca pasa de 732 dias.
  for (let i = 0; i < MAX_DIAS_RANGO + 2 && desde < r.hasta; i++) {
    let siguiente: FechaCivil;
    if (g === 'dia') siguiente = sumarDias(desde, 1);
    else if (g === 'semana') siguiente = sumarDias(lunesDe(desde), 7);
    else siguiente = sumarMeses(desde, 1);
    const hasta = siguiente < r.hasta ? siguiente : r.hasta;
    tramos.push({ clave: desde, desde, hasta });
    desde = hasta;
  }
  return tramos;
}

/** Clave del tramo al que pertenece una fecha dentro del rango. */
export function claveDeTramo(f: FechaCivil, r: Rango, g: Granularidad): FechaCivil {
  let inicio: FechaCivil;
  if (g === 'dia') inicio = f;
  else if (g === 'semana') inicio = lunesDe(f);
  else inicio = inicioMes(f);
  return inicio < r.desde ? r.desde : inicio;
}

// ── Formato ────────────────────────────────────────────────────────────────

const LOCALE_POR_IDIOMA: Record<string, string> = {
  es: 'es-CR',
  en: 'en-US',
  fr: 'fr-FR',
  pt: 'pt-BR',
  'zh-cn': 'zh-CN',
  ja: 'ja-JP',
  hi: 'hi-IN',
};

export function localeDe(idioma: string): string {
  return LOCALE_POR_IDIOMA[idioma] ?? 'es-CR';
}

/** Date en UTC que representa la fecha civil, para Intl con timeZone UTC. */
export function fechaParaFormato(f: FechaCivil): Date {
  return new Date(aMs(f));
}

type RangoConFormato = Intl.DateTimeFormat & {
  formatRange?: (a: Date, b: Date) => string;
};

function primeraMayuscula(s: string, locale: string): string {
  return s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
}

/**
 * El nombre legible de un rango: "Septiembre de 2026", "2026" o
 * "3 mar – 20 ago 2026".
 */
export function nombreDeRango(r: Rango, idioma: string): string {
  const locale = localeDe(idioma);
  const inicio = fechaParaFormato(r.desde);
  try {
    if (esMesCompleto(r)) {
      return primeraMayuscula(
        new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(inicio),
        locale,
      );
    }
    if (esAnoCompleto(r)) return String(partes(r.desde)[0]);
    const ultimo = fechaParaFormato(sumarDias(r.hasta, -1));
    const fmt = new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }) as RangoConFormato;
    if (r.desde === sumarDias(r.hasta, -1)) return fmt.format(inicio);
    if (typeof fmt.formatRange === 'function') return fmt.formatRange(inicio, ultimo);
    return `${fmt.format(inicio)} – ${fmt.format(ultimo)}`;
  } catch {
    return `${r.desde} – ${sumarDias(r.hasta, -1)}`;
  }
}

/** Etiqueta corta de un tramo para el eje: "12", "8 sep" o "sep". */
export function etiquetaDeTramo(t: Tramo, g: Granularidad, idioma: string, conAno = false): string {
  const locale = localeDe(idioma);
  const f = fechaParaFormato(t.desde);
  try {
    if (g === 'dia') return new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(f);
    if (g === 'semana') {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(f);
    }
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      ...(conAno ? { year: '2-digit' as const } : {}),
      timeZone: 'UTC',
    }).format(f);
  } catch {
    return t.desde;
  }
}

/** Etiqueta larga de un tramo para la lectura del grafico. */
export function etiquetaLargaDeTramo(t: Tramo, g: Granularidad, idioma: string): string {
  const locale = localeDe(idioma);
  const f = fechaParaFormato(t.desde);
  try {
    if (g === 'mes') {
      return primeraMayuscula(
        new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(f),
        locale,
      );
    }
    if (g === 'dia') {
      return primeraMayuscula(
        new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(f),
        locale,
      );
    }
    return nombreDeRango({ desde: t.desde, hasta: t.hasta }, idioma);
  } catch {
    return t.desde;
  }
}
