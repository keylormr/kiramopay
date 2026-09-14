import React from 'react';
import { BottomSheet } from './BottomSheet';
import { Icons } from './Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { txTitle } from '@/utils/txTitle';
import { estiloDeCategoria, etiquetaDeCategoria } from '@/utils/categoriaMovimiento';
import type { Transaction } from '@/types';

interface TransactionDetailSheetProps {
  tx: Transaction | null;
  isOpen: boolean;
  onClose: () => void;
}

// Miles con coma y simbolo corto, como el resto de montos de la app.
function formatearMonto(monto: number, moneda?: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currencyDisplay: 'narrowSymbol',
      currency: moneda || 'CRC',
    }).format(monto);
  } catch {
    return `${monto.toFixed(2)} ${moneda || ''}`;
  }
}

const Fila: React.FC<{ etiqueta: string; children: React.ReactNode }> = ({ etiqueta, children }) => (
  <div className="flex items-center justify-between gap-4 py-3">
    <dt className="shrink-0 text-sm uv-text-muted">{etiqueta}</dt>
    <dd className="min-w-0 text-right text-sm font-semibold uv-text-primary">{children}</dd>
  </div>
);

/**
 * Detalle de un movimiento. Vivia dentro de Inicio, asi que "Todos los
 * movimientos" pintaba filas con aspecto de tocables que no abrian nada. Ahora
 * lo comparten las dos pantallas.
 *
 * No lleva el boton "Reportar un problema" que tenia en Inicio: no hacia nada al
 * tocarlo, y un boton que no existe no se ofrece.
 */
export const TransactionDetailSheet: React.FC<TransactionDetailSheetProps> = ({ tx, isOpen, onClose }) => {
  const { t } = useLanguage();
  const estilo = estiloDeCategoria(tx?.category);
  const Icono = estilo.icon;
  const entrante = (tx?.amount ?? 0) > 0;
  const completado = (tx?.status ?? 'completed') === 'completed';

  return (
    <BottomSheet isOpen={isOpen && tx !== null} onClose={onClose} title={t('transaction_details')}>
      {tx && (
        <>
          <div className="flex flex-col items-center pb-4 pt-1 text-center">
            <div className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl ${estilo.bg} ${estilo.text}`}>
              <Icono size={28} aria-hidden="true" />
            </div>
            <p className="max-w-full break-words text-lg font-bold uv-text-primary">{txTitle(tx, t)}</p>
            <p
              className={`mt-1 text-3xl font-black tabular-nums tracking-tight ${
                entrante ? 'text-[var(--color-success)]' : 'uv-text-primary'
              }`}
            >
              {entrante ? '+' : ''}
              {formatearMonto(tx.amount, tx.ccy)}
            </p>
          </div>

          <dl className="divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
            <Fila etiqueta={t('status')}>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ${
                  completado ? 'uv-chip-success' : 'uv-chip-warning'
                }`}
              >
                {completado ? <Icons.Check size={12} aria-hidden="true" /> : <Icons.Clock size={12} aria-hidden="true" />}
                {completado ? t('tx_status_completed') : t('pending')}
              </span>
            </Fila>
            <Fila etiqueta={t('date')}>{tx.date}</Fila>
            <Fila etiqueta={t('category')}>
              <span className={estilo.text}>{etiquetaDeCategoria(tx.category, t)}</span>
            </Fila>
            <Fila etiqueta={t('transaction_id')}>
              <span className="break-all font-mono text-xs">{tx.id}</span>
            </Fila>
          </dl>
        </>
      )}
    </BottomSheet>
  );
};
