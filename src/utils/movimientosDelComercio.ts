import type { QRPayment, RetiroDelComercio } from '@/api/repositories/qrpayment.repository';
import { localeDe } from './periodos';

/**
 * Los movimientos de un comercio: cobros, devoluciones y retiros.
 *
 * Un movimiento solo lleva lo que el servidor dio. Un dato que falta queda sin
 * definir (undefined) para que la pantalla lo diga ("No disponible"): un cero,
 * un guion o un texto inventado se leen como un dato que nadie dio.
 */

export type TipoDeMovimiento = 'cobro' | 'devolucion' | 'retiro';

export type EstadoDeMovimiento = 'completed' | 'pending' | 'failed' | 'refunded';

export interface MovimientoDelComercio {
  id: string;
  tipo: TipoDeMovimiento;
  /** Instante ISO-8601. */
  fecha: string;
  moneda: string;
  /** Lo cobrado (bruto) o lo retirado, en unidades mayores. */
  monto: number;
  comision: number;
  neto: number;
  estado: EstadoDeMovimiento;
  /** Lo que se le da a quien pregunta por el movimiento: la transaccion, o el id. */
  referencia: string;
  nota?: string;
  // Solo cobros y devoluciones.
  pagador?: string;
  /** Hay sucursal (sucursalId) pero puede faltar su nombre: son dos hechos distintos. */
  sucursalId?: string;
  sucursal?: string;
  cajeroId?: string;
  cajero?: string;
  // Solo retiros.
  retiradoPor?: string;
}

export function movimientoDeCobro(p: QRPayment): MovimientoDelComercio {
  return {
    id: p.id,
    tipo: p.status === 'refunded' ? 'devolucion' : 'cobro',
    fecha: p.createdAt,
    moneda: p.currency,
    monto: p.amount,
    comision: p.fee,
    neto: p.amount - p.fee,
    estado: p.status,
    referencia: p.txId || p.id,
    nota: p.note,
    pagador: p.payerName,
    sucursalId: p.locationId,
    sucursal: p.locationName,
    cajeroId: p.collectedBy,
    cajero: p.collectorName,
  };
}

export function movimientoDeRetiro(r: RetiroDelComercio): MovimientoDelComercio {
  return {
    id: r.id,
    tipo: 'retiro',
    fecha: r.createdAt,
    moneda: r.currency,
    monto: r.amount,
    // Un retiro no paga comision: lo que sale es lo que se retira.
    comision: 0,
    neto: r.amount,
    estado: r.status === 'completed' ? 'completed' : 'pending',
    referencia: r.id,
    retiradoPor: r.withdrawnByName,
  };
}

// ── El dia de quien mira ─────────────────────────────────────────────────────
// tzOffsetMin son los minutos al OESTE de UTC que da Date#getTimezoneOffset (Costa
// Rica = 360), los mismos que viajan al servidor: el dia de cada fila y el dia
// del total que da el servidor tienen que ser el mismo.

const MINUTO_MS = 60_000;

/** El instante, corrido a la hora de pared de quien mira y leido como UTC. */
function enHoraDePared(iso: string, tzOffsetMin: number): Date | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t - tzOffsetMin * MINUTO_MS);
}

/** YYYY-MM-DD del dia de quien mira; '' si la fecha no es valida. */
export function claveDeDia(iso: string, tzOffsetMin: number): string {
  const d = enHoraDePared(iso, tzOffsetMin);
  return d ? d.toISOString().slice(0, 10) : '';
}

/** La hora del dia de quien mira, en el idioma de la app. */
export function horaLocal(iso: string, tzOffsetMin: number, idioma: string): string {
  const d = enHoraDePared(iso, tzOffsetMin);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(localeDe(idioma), { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d);
  } catch {
    return d.toISOString().slice(11, 16);
  }
}

/** Fecha y hora completas del dia de quien mira, en el idioma de la app. */
export function fechaYHoraLocal(iso: string, tzOffsetMin: number, idioma: string): string {
  const d = enHoraDePared(iso, tzOffsetMin);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(localeDe(idioma), {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC',
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export interface GrupoDeDia {
  /** YYYY-MM-DD */
  clave: string;
  movimientos: MovimientoDelComercio[];
}

/** Agrupa por el dia de quien mira. Los movimientos llegan del mas reciente al mas viejo y asi quedan. */
export function agruparPorDia(movimientos: MovimientoDelComercio[], tzOffsetMin: number): GrupoDeDia[] {
  const grupos: GrupoDeDia[] = [];
  for (const m of movimientos) {
    const clave = claveDeDia(m.fecha, tzOffsetMin);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.clave === clave) ultimo.movimientos.push(m);
    else grupos.push({ clave, movimientos: [m] });
  }
  return grupos;
}

/**
 * Junta los cobros que ya se cargaron con los retiros del periodo, el mas
 * reciente primero.
 *
 * Los cobros llegan de a paginas y los retiros todos juntos. Mientras falten
 * cobros por cargar, un retiro mas viejo que el ultimo cargado no se muestra:
 * quedaria entre dos huecos de una lista a la que le faltan filas, sin decirlo.
 * Aparece cuando sus cobros vecinos ya estan.
 */
export function fusionarMovimientos(
  cobros: QRPayment[],
  retiros: RetiroDelComercio[],
  faltanCobros: boolean,
): MovimientoDelComercio[] {
  const delCobros = cobros.map(movimientoDeCobro);
  let delRetiros = retiros.map(movimientoDeRetiro);
  if (faltanCobros) {
    if (delCobros.length === 0) {
      delRetiros = [];
    } else {
      const corte = Date.parse(delCobros[delCobros.length - 1].fecha);
      delRetiros = delRetiros.filter((r) => Date.parse(r.fecha) >= corte);
    }
  }
  return [...delCobros, ...delRetiros].sort((a, b) => {
    const dif = Date.parse(b.fecha) - Date.parse(a.fecha);
    return dif !== 0 ? dif : a.id < b.id ? 1 : -1;
  });
}

/**
 * Como se llama un dia en la lista: "Hoy" o "Ayer" cuando lo es, mas la fecha en
 * el idioma de la app. La fecha se arma desde la clave civil, no desde la zona
 * del telefono: la lista y el total del dia dicen el mismo dia.
 */
export function rotuloDeDia(
  clave: string,
  hoyClave: string,
  idioma: string,
  t: (clave: string) => string,
): { relativo?: string; fecha: string } {
  const [a, m, d] = clave.split('-').map(Number);
  const dia = new Date(Date.UTC(a, (m || 1) - 1, d || 1));
  let fecha = clave;
  try {
    fecha = new Intl.DateTimeFormat(localeDe(idioma), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).format(dia);
  } catch {
    // Sin Intl para ese idioma queda la fecha civil tal cual.
  }
  const [ha, hm, hd] = hoyClave.split('-').map(Number);
  const hoy = Date.UTC(ha, (hm || 1) - 1, hd || 1);
  const dif = Math.round((hoy - dia.getTime()) / 86_400_000);
  if (dif === 0) return { relativo: t('business_day_today'), fecha };
  if (dif === 1) return { relativo: t('business_day_yesterday'), fecha };
  return { fecha };
}
