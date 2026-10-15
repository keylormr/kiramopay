import type { Transaction } from '@/types';
import { etiquetaDeCategoria } from '@/utils/categoriaMovimiento';

/**
 * El traductor de la app (`t` de useLanguage). Lo que la persona lee del
 * archivo, del texto copiado y del compartido sale en su idioma, con las mismas
 * palabras que la pantalla: salia en espanol en cualquier idioma.
 */
export type Traductor = (clave: string) => string;

/**
 * Resumen POR MONEDA.
 *
 * El resumen sumaba todas las filas con un `reduce` sin mirar `tx.ccy`: colones
 * y dolares uno junto a otro, y el total escrito sin simbolo. El usuario tomaba
 * decisiones sobre un numero que no significaba nada — no era el total en
 * colones ni el total en dolares, era la suma de dos cosas distintas.
 *
 * No se convierte a una moneda comun a proposito: el tipo de cambio de la
 * aplicacion no es una cotizacion de mercado, y convertir aqui seria inventar
 * una cifra con aspecto de dato.
 */
export interface ResumenPorMoneda {
  moneda: string;
  ingresos: number;
  egresos: number;
  neto: number;
}

export function resumirPorMoneda(transactions: Transaction[]): ResumenPorMoneda[] {
  const porMoneda = new Map<string, ResumenPorMoneda>();
  for (const tx of transactions) {
    const moneda = tx.ccy || 'CRC';
    let r = porMoneda.get(moneda);
    if (!r) {
      r = { moneda, ingresos: 0, egresos: 0, neto: 0 };
      porMoneda.set(moneda, r);
    }
    if (tx.amount > 0) r.ingresos += tx.amount;
    else r.egresos += tx.amount;
    r.neto += tx.amount;
  }
  return [...porMoneda.values()].sort((a, b) => a.moneda.localeCompare(b.moneda));
}

// --- Excel-compatible CSV ---
export function exportTransactionsCSV(transactions: Transaction[], t: Traductor, filename?: string): void {
  // Excel separator hint + BOM for UTF-8
  const sep = 'sep=,\n';
  const headers = [
    t('export_col_id'),
    t('export_col_date'),
    t('export_col_title'),
    t('export_col_amount'),
    t('export_col_currency'),
    t('export_col_type'),
    t('export_col_category'),
    t('export_col_status'),
  ].map(celda);

  const rows = transactions.map((tx) => [
    tx.id,
    celda(fechaParaArchivo(tx)),
    celda(tx.title || ''),
    tx.amount.toFixed(2),
    tx.ccy,
    celda(tx.type === 'credit' ? t('export_type_credit') : t('export_type_debit')),
    celda(etiquetaDeCategoria(tx.category, t)),
    celda(estadoDe(tx, t)),
  ]);

  // Summary rows at the bottom, UNA TANDA POR MONEDA. La moneda viaja en su
  // propia columna para que la hoja de calculo pueda agrupar por ella.
  rows.push([]);
  rows.push(['', '', celda(t('export_summary')), '', '', '', '', '']);
  for (const r of resumirPorMoneda(transactions)) {
    rows.push(['', '', celda(t('export_total_income')), r.ingresos.toFixed(2), r.moneda, '', '', '']);
    rows.push(['', '', celda(t('export_total_expenses')), r.egresos.toFixed(2), r.moneda, '', '', '']);
    rows.push(['', '', celda(t('export_net_balance')), r.neto.toFixed(2), r.moneda, '', '', '']);
  }
  const generado = t('export_generated').replace('{fecha}', fechaLocal(new Date().toISOString()));
  rows.push(['', '', celda(generado), '', '', '', '', '']);

  const csvContent = sep + [headers.join(','), ...rows.map((r) => (r as string[]).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename || nombreDeArchivo(t, 'csv'));
}

// --- JSON export ---
// El contenido es de maquina (claves en ingles, `credit`/`debit`, la fecha ISO):
// lo lee un programa. El nombre del archivo si lo lee la persona.
export function exportTransactionsJSON(transactions: Transaction[], t: Traductor, filename?: string): void {
  const data = {
    app: 'KiramoPay',
    exportDate: new Date().toISOString(),
    count: transactions.length,
    // Por moneda, por la misma razon que el CSV: un total que mezcla colones y
    // dolares no es un total de nada.
    // Redondeado a centimos, como el CSV: los totales se suman en coma flotante
    // y un neto de -84550.55 salia escrito -84550.54999999999.
    summaryByCurrency: resumirPorMoneda(transactions).map((r) => ({
      currency: r.moneda,
      totalIncome: aCentimos(r.ingresos),
      totalExpenses: aCentimos(r.egresos),
      net: aCentimos(r.neto),
    })),
    transactions: transactions.map((tx) => ({
      id: tx.id,
      // La de maquina: un JSON lo lee un programa, no una persona.
      date: tx.dateISO || tx.date,
      title: tx.title,
      amount: tx.amount,
      currency: tx.ccy,
      type: tx.type,
      category: tx.category || 'General',
      status: tx.status || 'completed',
    })),
  };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  downloadBlob(blob, filename || nombreDeArchivo(t, 'json'));
}

// --- Copy to clipboard (formatted table) ---
// Los totales van por moneda, como en el CSV: sumaban todas las filas y con
// colones y dolares en la lista escribian un numero que no era ninguno de los
// dos, sin moneda.
export async function copyTransactionsToClipboard(transactions: Transaction[], t: Traductor): Promise<boolean> {
  const lines: string[] = [];

  lines.push(t('export_copy_title'));
  lines.push('═'.repeat(40));

  for (const tx of transactions) {
    const sign = tx.amount > 0 ? '+' : '';
    lines.push(`${fechaParaArchivo(tx)}  ${tx.title}`);
    lines.push(`  ${sign}${tx.amount.toFixed(2)} ${tx.ccy}  [${etiquetaDeCategoria(tx.category, t)}]`);
  }

  lines.push('═'.repeat(40));
  // Las cifras alineadas: cada rotulo se rellena al ancho del mas largo del
  // idioma ("Ingresos: +", "Egresos:  ", "Neto:     " en espanol).
  const rotulo = alineador([t('export_line_income'), t('export_line_expenses'), t('export_line_net')]);
  for (const r of resumirPorMoneda(transactions)) {
    lines.push(`${rotulo(t('export_line_income'))}+${r.ingresos.toFixed(2)} ${r.moneda}`);
    lines.push(`${rotulo(t('export_line_expenses'))}${r.egresos.toFixed(2)} ${r.moneda}`);
    lines.push(`${rotulo(t('export_line_net'))}${r.neto.toFixed(2)} ${r.moneda}`);
  }

  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

// --- Share via Web Share API ---
// Por moneda, por la misma razon que copiar.
export async function shareTransactions(transactions: Transaction[], t: Traductor): Promise<boolean> {
  const n = transactions.length;
  const text = [
    t('export_share_title'),
    `${n} ${n === 1 ? t('num_transactions_one') : t('num_transactions')}`,
    ...resumirPorMoneda(transactions).flatMap((r) => [
      `${t('export_line_income')}: +${r.ingresos.toFixed(2)} ${r.moneda}`,
      `${t('export_line_expenses')}: ${r.egresos.toFixed(2)} ${r.moneda}`,
      `${t('export_line_balance')}: ${r.neto >= 0 ? '+' : ''}${r.neto.toFixed(2)} ${r.moneda}`,
    ]),
  ].join('\n');

  if (navigator.share) {
    try {
      await navigator.share({ title: t('export_copy_title'), text });
      return true;
    } catch {
      return false;
    }
  }
  // Fallback: copy to clipboard
  return copyTransactionsToClipboard(transactions, t);
}

// --- Helpers ---

/**
 * El estado con la misma regla que la pantalla (TransactionsView y el detalle):
 * sin estado es un movimiento completado. El CSV lo escribia "Pendiente".
 */
function estadoDe(tx: Transaction, t: Traductor): string {
  return (tx.status ?? 'completed') === 'completed' ? t('tx_status_completed') : t('pending');
}

/** "Ingresos: " rellenado al ancho del rotulo mas largo, mas un espacio. */
function alineador(rotulos: string[]): (rotulo: string) => string {
  const ancho = Math.max(...rotulos.map((r) => r.length)) + 1;
  return (rotulo) => `${rotulo}:`.padEnd(ancho) + ' ';
}

function nombreDeArchivo(t: Traductor, extension: 'csv' | 'json'): string {
  return `KiramoPay-${t('export_file_name')}-${dateStamp()}.${extension}`;
}

/**
 * La fecha de un movimiento en lo exportado: la de maquina, en hora local y sin
 * ambiguedad (2026-09-04 09:30), que Excel, Numbers y Google Sheets leen igual
 * en cualquier idioma. El `date` de la pantalla es texto para leer: "4/9/2026"
 * del adaptador (es-CR, que una hoja en ingles lee 9 de abril, y sin la hora),
 * o "Ahora" en lo anotado localmente. Sin fecha de maquina, queda ese texto.
 */
function fechaParaArchivo(tx: Transaction): string {
  return fechaLocal(tx.dateISO) || tx.date;
}

function fechaLocal(iso: string | undefined): string {
  if (!iso) return '';
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return '';
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())} ${dos(f.getHours())}:${dos(f.getMinutes())}`;
}

/** Un campo de texto del CSV, entre comillas: una coma adentro no parte la fila. */
function celda(texto: string): string {
  return `"${texto.replace(/"/g, '""')}"`;
}

function aCentimos(monto: number): number {
  return Math.round(monto * 100) / 100;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// El dia local, el mismo de la linea "Generado": con toISOString era el de UTC,
// y de noche en Costa Rica el archivo salia con la fecha de manana.
function dateStamp(): string {
  return fechaLocal(new Date().toISOString()).slice(0, 10);
}
