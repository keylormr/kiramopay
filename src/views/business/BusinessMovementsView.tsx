import React from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { useApp } from '@/hooks/useApp';
import { Icons } from '@/components/Icons';
import type { QRPayment } from '@/api/repositories/qrpayment.repository';

interface Props {
  payments: QRPayment[];
}

export const BusinessMovementsView: React.FC<Props> = ({ payments }) => {
  const { t } = useLanguage();
  const { state } = useApp();
  const base = state.accounts.find((a) => a.ccy === state.baseCurrency) || state.accounts[0];
  const symbol = base?.symbol ?? '₡';
  const money = (v: number) => `${symbol}${v.toFixed(2)}`;

  return (
    <div className="pb-24 pt-4 px-4 space-y-4">
      <h2 className="text-lg font-bold uv-text-primary">{t('business_movements')}</h2>

      {payments.length === 0 ? (
        <div className="uv-surface-1 rounded-2xl p-8 text-center uv-shadow-soft">
          <Icons.Receipt size={40} className="mx-auto uv-text-muted opacity-50 mb-3" />
          <p className="uv-text-muted text-sm">{t('merchant_history_empty')}</p>
        </div>
      ) : (
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
          {payments.map((p) => (
            <div key={p.id} className="flex items-center px-4 py-3.5">
              <div className="w-10 h-10 rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)] flex items-center justify-center mr-3 shrink-0">
                <Icons.QrCode size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold uv-text-primary tabular-nums">{money(p.amount - p.fee)}</p>
                <p className="text-[11px] uv-text-muted">
                  {t('merchant_gross')} {money(p.amount)} · {t('merchant_fee_label')} {money(p.fee)}
                </p>
              </div>
              <p className="text-[11px] uv-text-muted shrink-0">
                {new Date(p.createdAt).toLocaleDateString()}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
