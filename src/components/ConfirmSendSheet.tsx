import React from 'react';
import { BottomSheet } from './BottomSheet';
import { Icons } from './Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatMoney, type CurrencyCode } from '@/utils/money';

interface Row {
  label: string;
  value: string;
}

interface ConfirmSendSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  /** Fiat amount, formatted with formatMoney(currency). Ignored when amountDisplay is set. */
  amount?: number;
  currency?: CurrencyCode;
  /** Pre-formatted headline (e.g. crypto "0.5 BTC") — overrides amount/currency. */
  amountDisplay?: string;
  /** Recap rows (recipient, reference, fee...) — labels already translated by the caller. */
  rows: Row[];
  processing?: boolean;
  /** Optional caution note (e.g. irreversibility) rendered in the warning tint. */
  warning?: string;
  title?: string;
  confirmLabel?: string;
}

/**
 * A review-before-send confirmation sheet. Moving money is irreversible on the
 * ledger, so every money-move flow should pause here with a recap of amount +
 * recipient before the final commit. Reusable across SINPE, QR, and crypto.
 */
export const ConfirmSendSheet: React.FC<ConfirmSendSheetProps> = ({
  isOpen,
  onClose,
  onConfirm,
  amount,
  currency = 'CRC',
  amountDisplay,
  rows,
  processing = false,
  warning,
  title,
  confirmLabel,
}) => {
  const { t } = useLanguage();
  const headline = amountDisplay ?? formatMoney(amount ?? 0, currency);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={title || t('confirm')}>
      <div className="space-y-5">
        <div className="text-center py-2">
          <p className="text-xs uv-text-muted uppercase tracking-wider font-bold mb-1">
            {t('amount')}
          </p>
          <p className="text-4xl font-black uv-text-primary tracking-tight">
            {headline}
          </p>
        </div>

        <div className="uv-surface-2 rounded-2xl divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="text-sm uv-text-muted flex-shrink-0">{r.label}</span>
              <span className="text-sm font-semibold uv-text-primary text-right truncate">
                {r.value}
              </span>
            </div>
          ))}
        </div>

        {warning && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-[var(--color-warning-soft)]">
            <Icons.AlertTriangle
              size={18}
              className="text-[var(--color-warning)] flex-shrink-0 mt-0.5"
            />
            <p className="text-xs text-[var(--color-warning)] leading-relaxed">{warning}</p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={processing}
            className="flex-1 py-4 rounded-xl font-bold uv-surface-2 uv-text-secondary border border-[var(--color-border)] dark:border-[var(--color-border-dark)] active:scale-[0.98] transition-all disabled:opacity-50 uv-focus-ring"
          >
            {t('cancel')}
          </button>
          <button
            onClick={onConfirm}
            disabled={processing}
            className="flex-[1.5] py-4 rounded-xl font-bold text-white bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-50 flex items-center justify-center gap-2 active:scale-[0.98] transition-all uv-shadow-primary uv-focus-ring"
          >
            {processing ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {t('processing')}
              </>
            ) : (
              <>
                <Icons.Check size={20} />
                {confirmLabel || t('confirm')}
              </>
            )}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
};
