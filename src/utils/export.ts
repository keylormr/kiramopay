import type { Transaction } from '@/types';

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
export function exportTransactionsCSV(transactions: Transaction[], filename?: string): void {
  // Excel separator hint + BOM for UTF-8
  const sep = 'sep=,\n';
  const headers = ['ID', 'Fecha', 'Titulo', 'Monto', 'Moneda', 'Tipo', 'Categoria', 'Estado'];

  const rows = transactions.map((tx) => [
    tx.id,
    tx.date,
    `"${(tx.title || '').replace(/"/g, '""')}"`,
    tx.amount.toFixed(2),
    tx.ccy,
    tx.type === 'credit' ? 'Ingreso' : 'Egreso',
    tx.category || 'General',
    tx.status === 'completed' ? 'Completado' : 'Pendiente',
  ]);

  // Summary rows at the bottom, UNA TANDA POR MONEDA. La moneda viaja en su
  // propia columna para que la hoja de calculo pueda agrupar por ella.
  rows.push([]);
  rows.push(['', '', '"RESUMEN"', '', '', '', '', '']);
  for (const r of resumirPorMoneda(transactions)) {
    rows.push(['', '', '"Total Ingresos"', r.ingresos.toFixed(2), r.moneda, '', '', '']);
    rows.push(['', '', '"Total Egresos"', r.egresos.toFixed(2), r.moneda, '', '', '']);
    rows.push(['', '', '"Balance Neto"', r.neto.toFixed(2), r.moneda, '', '', '']);
  }
  rows.push(['', '', `"Generado: ${new Date().toLocaleString()}"`, '', '', '', '', '']);

  const csvContent = sep + [headers.join(','), ...rows.map((r) => (r as string[]).join(','))].join('\n');
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, filename || `KiramoPay-Transacciones-${dateStamp()}.csv`);
}

// --- JSON export ---
export function exportTransactionsJSON(transactions: Transaction[], filename?: string): void {
  const data = {
    app: 'KiramoPay',
    exportDate: new Date().toISOString(),
    count: transactions.length,
    // Por moneda, por la misma razon que el CSV: un total que mezcla colones y
    // dolares no es un total de nada.
    summaryByCurrency: resumirPorMoneda(transactions).map((r) => ({
      currency: r.moneda,
      totalIncome: r.ingresos,
      totalExpenses: r.egresos,
      net: r.neto,
    })),
    transactions: transactions.map((tx) => ({
      id: tx.id,
      date: tx.date,
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
  downloadBlob(blob, filename || `KiramoPay-Transacciones-${dateStamp()}.json`);
}

// --- Copy to clipboard (formatted table) ---
export async function copyTransactionsToClipboard(transactions: Transaction[]): Promise<boolean> {
  const lines: string[] = [];
  const totalIncome = transactions.filter((tx) => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0);
  const totalExpenses = transactions.filter((tx) => tx.amount < 0).reduce((s, tx) => s + tx.amount, 0);

  lines.push('KiramoPay - Transacciones');
  lines.push('═'.repeat(40));

  for (const tx of transactions) {
    const sign = tx.amount > 0 ? '+' : '';
    lines.push(`${tx.date}  ${tx.title}`);
    lines.push(`  ${sign}${tx.amount.toFixed(2)} ${tx.ccy}  [${tx.category || 'General'}]`);
  }

  lines.push('═'.repeat(40));
  lines.push(`Ingresos: +${totalIncome.toFixed(2)}`);
  lines.push(`Egresos:  ${totalExpenses.toFixed(2)}`);
  lines.push(`Neto:     ${(totalIncome + totalExpenses).toFixed(2)}`);

  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    return true;
  } catch {
    return false;
  }
}

// --- Share via Web Share API ---
export async function shareTransactions(transactions: Transaction[]): Promise<boolean> {
  const totalIncome = transactions.filter((tx) => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0);
  const totalExpenses = transactions.filter((tx) => tx.amount < 0).reduce((s, tx) => s + tx.amount, 0);
  const net = totalIncome + totalExpenses;

  const text = [
    `KiramoPay - Resumen de Transacciones`,
    `${transactions.length} transacciones`,
    `Ingresos: +${totalIncome.toFixed(2)}`,
    `Egresos: ${totalExpenses.toFixed(2)}`,
    `Balance: ${net >= 0 ? '+' : ''}${net.toFixed(2)}`,
  ].join('\n');

  if (navigator.share) {
    try {
      await navigator.share({ title: 'KiramoPay Transacciones', text });
      return true;
    } catch {
      return false;
    }
  }
  // Fallback: copy to clipboard
  return copyTransactionsToClipboard(transactions);
}

// --- Helpers ---
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

function dateStamp(): string {
  return new Date().toISOString().split('T')[0];
}
