import { rellenar } from '@/utils/planes';
import type { Ingreso } from './tipos';
import { sumar } from './ingresos';

/** Los textos ya traducidos que lleva el PDF. Los pone la pantalla (`t`). */
export interface TextosPdf {
  titulo: string;
  moneda: string;
  totalVentas: string;
  cantidadUna: string;
  /** Con `{n}`. */
  cantidadOtras: string;
  aviso: string;
  sinSigno: string;
  /** Con `{n}`. */
  omitidas: string;
  listaSinpe: string;
  sinSinpe: string;
  /** Con `{n}`. */
  otros: string;
  fecha: string;
  descripcion: string;
  monto: string;
  esVenta: string;
  si: string;
  no: string;
  /** Con `{fecha}`. */
  pie: string;
  /** Con `{n}` y `{total}`. */
  pagina: string;
}

/**
 * Como la pantalla escribe los numeros y las fechas: el PDF usa las mismas
 * funciones para que ninguna cifra se vea distinta de la que la persona reviso.
 */
export interface FormatosPdf {
  dinero: (centimos: number, moneda: string) => string;
  /** AAAA-MM -> "Noviembre 2026". */
  mes: (mes: string) => string;
  /** AAAA-MM-DD -> "07/11/2026". */
  fecha: (iso: string) => string;
}

export interface DatosPdf {
  /** Los ingresos del mes y la moneda que la pantalla muestra. */
  delMes: Ingreso[];
  esVenta: (x: Ingreso) => boolean;
  mes: string;
  moneda: string;
  sinSigno: boolean;
  omitidas: number;
  /** AAAA-MM-DD del dia en que se arma el archivo, en la zona de la persona. */
  hoy: string;
}

export interface FilaPdf {
  fecha: string;
  descripcion: string;
  monto: string;
  venta: string;
}

export interface SeccionPdf {
  titulo: string;
  filas: FilaPdf[];
  /** Lo que se dice cuando no hay filas; `null` si hay. */
  vacio: string | null;
}

export interface ContenidoPdf {
  titulo: string;
  /** "Noviembre 2026 · Moneda: CRC" */
  subtitulo: string;
  rotuloTotal: string;
  total: string;
  cantidad: string;
  aviso: string;
  notas: string[];
  columnas: { fecha: string; descripcion: string; monto: string; venta: string };
  secciones: SeccionPdf[];
  pie: string;
  /** Con `{n}` y `{total}`; la numeracion se resuelve al paginar. */
  pagina: string;
}

/** Una descripcion de banco no pasa de un renglon o dos; mas que esto es basura. */
export const MAX_DESCRIPCION = 300;

/** Sin saltos ni caracteres de control (vienen del archivo del banco) y con tope. */
export function descripcionParaPdf(texto: string): string {
  // eslint-disable-next-line no-control-regex
  const limpio = texto.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!limpio) return '—';
  const letras = Array.from(limpio);
  return letras.length > MAX_DESCRIPCION ? `${letras.slice(0, MAX_DESCRIPCION - 1).join('').trimEnd()}…` : limpio;
}

/**
 * Lo que lleva el PDF: lo mismo que la pantalla del resumen para el mes y la
 * moneda elegidos. El total, el detalle de los cobros por SINPE y la lista de
 * otros ingresos (que la persona puede haber marcado como venta). No agrega
 * nada que la pantalla no tenga: ni nombre del comercio, ni cedula, ni
 * impuestos.
 */
export function construirContenidoPdf(d: DatosPdf, tx: TextosPdf, f: FormatosPdf): ContenidoPdf {
  const ordenados = [...d.delMes].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  const fila = (x: Ingreso): FilaPdf => ({
    fecha: f.fecha(x.fecha),
    descripcion: descripcionParaPdf(x.descripcion),
    monto: f.dinero(x.centimos, x.moneda),
    venta: d.esVenta(x) ? tx.si : tx.no,
  });
  const sinpe = ordenados.filter((x) => x.esSinpe);
  const otros = ordenados.filter((x) => !x.esSinpe);
  const ventas = ordenados.filter(d.esVenta);

  const secciones: SeccionPdf[] = [
    {
      titulo: tx.listaSinpe,
      filas: sinpe.map(fila),
      vacio: sinpe.length === 0 ? tx.sinSinpe : null,
    },
  ];
  if (otros.length > 0) {
    secciones.push({ titulo: rellenar(tx.otros, { n: otros.length }), filas: otros.map(fila), vacio: null });
  }

  const notas: string[] = [];
  if (d.sinSigno) notas.push(tx.sinSigno);
  if (d.omitidas > 0) notas.push(rellenar(tx.omitidas, { n: d.omitidas }));

  return {
    titulo: tx.titulo,
    subtitulo: `${f.mes(d.mes)} · ${tx.moneda}: ${d.moneda}`,
    rotuloTotal: tx.totalVentas,
    total: f.dinero(sumar(ventas), d.moneda),
    cantidad: ventas.length === 1 ? tx.cantidadUna : rellenar(tx.cantidadOtras, { n: ventas.length }),
    aviso: tx.aviso,
    notas,
    columnas: { fecha: tx.fecha, descripcion: tx.descripcion, monto: tx.monto, venta: tx.esVenta },
    secciones,
    pie: rellenar(tx.pie, { fecha: f.fecha(d.hoy) }),
    pagina: tx.pagina,
  };
}
