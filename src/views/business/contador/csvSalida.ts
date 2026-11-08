import { celda } from '@/utils/export';
import type { Ingreso } from './tipos';
import { sumar } from './ingresos';

export interface TextosCsv {
  fecha: string;
  descripcion: string;
  monto: string;
  moneda: string;
  esSinpe: string;
  esVenta: string;
  si: string;
  no: string;
  totalVentas: string;
  cantidadVentas: string;
}

/** 123456 centimos -> "1234.56", sin pasar por flotantes. */
export function centimosATexto(c: number): string {
  const signo = c < 0 ? '-' : '';
  const a = Math.abs(c);
  return `${signo}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

/**
 * El CSV del mes que se comparte con el contador. Las descripciones las
 * escribio el banco y las abre el contador en Excel: `celda` (utils/export)
 * antepone un apostrofo a lo que una hoja ejecutaria como formula. Lleva BOM
 * para que Excel respete los acentos.
 */
export function construirCsv(
  delMes: Ingreso[],
  esVenta: (x: Ingreso) => boolean,
  tx: TextosCsv,
): string {
  const ordenados = [...delMes].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.id.localeCompare(b.id));
  const moneda = ordenados[0]?.moneda ?? '';
  const filas = ordenados.map((x) =>
    [
      x.fecha,
      celda(x.descripcion),
      centimosATexto(x.centimos),
      celda(x.moneda),
      celda(x.esSinpe ? tx.si : tx.no),
      celda(esVenta(x) ? tx.si : tx.no),
    ].join(','),
  );
  const ventas = ordenados.filter(esVenta);
  const cabecera = [tx.fecha, tx.descripcion, tx.monto, tx.moneda, tx.esSinpe, tx.esVenta].map(celda).join(',');
  const cierre = [
    ['', celda(tx.totalVentas), centimosATexto(sumar(ventas)), celda(moneda), '', ''].join(','),
    ['', celda(tx.cantidadVentas), String(ventas.length), '', '', ''].join(','),
  ];
  return '﻿sep=,\n' + [cabecera, ...filas, '', ...cierre].join('\n');
}
