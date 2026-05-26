import type { Transaction } from '@/types';

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

  // Summary rows at the bottom
  const totalIncome = transactions
    .filter((tx) => tx.amount > 0)
    .reduce((s, tx) => s + tx.amount, 0);
  const totalExpenses = transactions
    .filter((tx) => tx.amount < 0)
    .reduce((s, tx) => s + tx.amount, 0);
  const net = totalIncome + totalExpenses;

  rows.push([]);
  rows.push(['', '', '"RESUMEN"', '', '', '', '', '']);
  rows.push(['', '', '"Total Ingresos"', totalIncome.toFixed(2), '', '', '', '']);
  rows.push(['', '', '"Total Egresos"', totalExpenses.toFixed(2), '', '', '', '']);
  rows.push(['', '', '"Balance Neto"', net.toFixed(2), '', '', '', '']);
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
    summary: {
      totalIncome: transactions.filter((tx) => tx.amount > 0).reduce((s, tx) => s + tx.amount, 0),
      totalExpenses: transactions.filter((tx) => tx.amount < 0).reduce((s, tx) => s + tx.amount, 0),
      net: transactions.reduce((s, tx) => s + tx.amount, 0),
    },
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
