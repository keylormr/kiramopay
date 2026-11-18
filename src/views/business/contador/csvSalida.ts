import { celda } from '@/utils/export';
import type { Ingreso } from './tipos';
import { sumar } from './ingresos';
import { sumarLightning, type CobroLightningDelMes } from './lightning';

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

/** Las columnas y los cierres que se agregan cuando hay cobros por Lightning. */
export interface TextosCsvLightning {
  medio: string;
  banco: string;
  sats: string;
  precioBtc: string;
  totalLightning: string;
  cantidadLightning: string;
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
  lightning: CobroLightningDelMes[] = [],
  txLn?: TextosCsvLightning,
): string {
  if (lightning.length > 0 && txLn) return construirCsvConLightning(delMes, esVenta, tx, lightning, txLn);
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

/**
 * El mismo CSV con los cobros por Lightning del mes: tres columnas mas (medio,
 * sats y precio de 1 BTC) y las filas de Lightning entre las del banco, por
 * fecha. Una venta por Lightning es venta: entra al total de ventas, y aparte
 * se dice cuanto fue por Lightning. Sin cobros por Lightning el archivo queda
 * como siempre.
 */
function construirCsvConLightning(
  delMes: Ingreso[],
  esVenta: (x: Ingreso) => boolean,
  tx: TextosCsv,
  lightning: CobroLightningDelMes[],
  txLn: TextosCsvLightning,
): string {
  const moneda = lightning[0].moneda;
  type Fila = { fecha: string; orden: string; celdas: string[] };
  const delBanco: Fila[] = delMes.map((x) => ({
    fecha: x.fecha,
    orden: `0${x.id}`,
    celdas: [
      x.fecha,
      celda(x.descripcion),
      centimosATexto(x.centimos),
      celda(x.moneda),
      celda(x.esSinpe ? tx.si : tx.no),
      celda(esVenta(x) ? tx.si : tx.no),
      celda(txLn.banco),
      '',
      '',
    ],
  }));
  const porLightning: Fila[] = lightning.map((x) => ({
    fecha: x.fecha,
    orden: `1${x.id}`,
    celdas: [
      x.fecha,
      celda(x.descripcion),
      centimosATexto(x.centimos),
      celda(x.moneda),
      celda(tx.no),
      celda(tx.si),
      celda('Lightning'),
      String(x.sats),
      celda(x.precioBtc),
    ],
  }));
  const filas = [...delBanco, ...porLightning]
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.orden.localeCompare(b.orden))
    .map((f) => f.celdas.join(','));
  const ventas = delMes.filter(esVenta);
  const cabecera = [tx.fecha, tx.descripcion, tx.monto, tx.moneda, tx.esSinpe, tx.esVenta, txLn.medio, txLn.sats, txLn.precioBtc]
    .map(celda)
    .join(',');
  // Las tres columnas de Lightning van vacias en los renglones del cierre.
  const resto = ['', '', '', '', ''];
  const cierre = [
    ['', celda(tx.totalVentas), centimosATexto(sumar(ventas) + sumarLightning(lightning)), celda(moneda), ...resto].join(','),
    ['', celda(tx.cantidadVentas), String(ventas.length + lightning.length), '', ...resto].join(','),
    ['', celda(txLn.totalLightning), centimosATexto(sumarLightning(lightning)), celda(moneda), ...resto].join(','),
    ['', celda(txLn.cantidadLightning), String(lightning.length), '', ...resto].join(','),
  ];
  return '﻿sep=,\n' + [cabecera, ...filas, '', ...cierre].join('\n');
}
