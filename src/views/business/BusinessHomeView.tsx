import React, { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { useApp } from '@/hooks/useApp';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { QRCodeSVG } from 'qrcode.react';
import { getApiLayer } from '@/api';
import type { QRMerchant, QRPayment, QRPaymentCode } from '@/api/repositories/qrpayment.repository';

interface Props {
  merchant: QRMerchant;
  payments: QRPayment[];
  onReload: () => void;
}

const isToday = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
};

export const BusinessHomeView: React.FC<Props> = ({ merchant, payments, onReload }) => {
  const { t } = useLanguage();
  const { state } = useApp();
  const base = state.accounts.find((a) => a.ccy === state.baseCurrency) || state.accounts[0];
  const ccy = base?.ccy ?? 'CRC';
  const symbol = base?.symbol ?? '₡';

  const [showCharge, setShowCharge] = useState(false);
  const [amount, setAmount] = useState('');
  const [generating, setGenerating] = useState(false);
  const [code, setCode] = useState<QRPaymentCode | null>(null);
  const [error, setError] = useState('');

  const verified = merchant.verificationStatus === 'verified';
  const money = (v: number) => `${symbol}${v.toFixed(2)}`;

  const todays = payments.filter((p) => isToday(p.createdAt));
  const todayGross = todays.reduce((s, p) => s + p.amount, 0);
  const todayFee = todays.reduce((s, p) => s + p.fee, 0);
  const totalFee = payments.reduce((s, p) => s + p.fee, 0);

  const charge = async () => {
    const api = getApiLayer().qrPayments;
    if (!api || generating) return;
    setGenerating(true);
    setError('');
    setCode(null);
    const amt = parseFloat(amount);
    const fixed = Number.isFinite(amt) && amt > 0;
    const res = await api.createQRCode({
      type: fixed ? 'merchant_fixed' : 'merchant_dynamic',
      amount: fixed ? amt : undefined,
      currency: ccy,
      singleUse: false,
      merchantId: merchant.id,
    });
    setGenerating(false);
    if (res.success && res.data) setCode(res.data);
    else setError(res.error?.message || t('merchant_qr_error'));
  };

  const closeCharge = () => { setShowCharge(false); setCode(null); setAmount(''); setError(''); onReload(); };

  return (
    <div className="pb-24 pt-4 px-4 space-y-5">
      {/* Verification banner — the backend blocks collecting until verified. */}
      {!verified && (
        <div className="rounded-2xl p-4 bg-[var(--color-warning-soft)] border border-[var(--color-warning)]/30">
          <div className="flex items-start gap-3">
            <Icons.Shield size={20} className="text-[var(--color-warning)] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-bold uv-text-primary text-sm">
                {t(`merchant_status_${merchant.verificationStatus}` as Parameters<typeof t>[0])}
              </p>
              <p className="text-xs uv-text-secondary mt-0.5">
                {merchant.verificationStatus === 'rejected' && merchant.rejectionReason
                  ? merchant.rejectionReason
                  : t('merchant_status_pending_help')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Today's sales */}
      <div className="relative overflow-hidden uv-gradient-brand rounded-3xl p-6 text-white uv-shadow-floating">
        <div
          className="absolute -right-12 -bottom-12 w-40 h-40 rounded-full opacity-30 pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.5), transparent)' }}
        />
        <span className="relative text-xs font-semibold uppercase tracking-wider text-white/70">
          {t('business_sales_today')}
        </span>
        <div className="relative text-3xl font-black mt-1 mb-1 tabular-nums">{money(todayGross)}</div>
        <div className="relative text-white/70 text-sm">
          {todays.length} · {t('business_commission_paid')} {money(todayFee)}
        </div>
      </div>

      {/* Primary action */}
      <Button onClick={() => setShowCharge(true)} disabled={!verified} size="lg" fullWidth leftIcon={<Icons.QrCode size={20} />}>
        {t('merchant_generate_qr')}
      </Button>

      {/* Totals */}
      <div className="uv-surface-1 rounded-2xl p-4 uv-shadow-soft space-y-2">
        <div className="flex justify-between text-sm">
          <span className="uv-text-muted">{t('business_sales_total')}</span>
          <span className="font-semibold uv-text-primary tabular-nums">
            {money(payments.reduce((s, p) => s + p.amount, 0))}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="uv-text-muted">{t('business_commission_paid')}</span>
          <span className="font-semibold uv-text-primary tabular-nums">{money(totalFee)}</span>
        </div>
        <div className="flex justify-between text-sm border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] pt-2">
          <span className="uv-text-muted">{t('merchant_net_received')}</span>
          <span className="font-bold uv-text-primary tabular-nums">
            {money(payments.reduce((s, p) => s + (p.amount - p.fee), 0))}
          </span>
        </div>
      </div>

      {/* Recent movements */}
      <div>
        <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-2">{t('business_movements')}</h3>
        {payments.length === 0 ? (
          <p className="text-sm uv-text-muted">{t('merchant_history_empty')}</p>
        ) : (
          <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
            {payments.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold uv-text-primary tabular-nums">{money(p.amount - p.fee)}</p>
                  <p className="text-[11px] uv-text-muted">
                    {t('merchant_fee_label')} {money(p.fee)} · {new Date(p.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-[11px] uv-text-muted shrink-0">{t('merchant_gross')} {money(p.amount)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Charge sheet */}
      <BottomSheet isOpen={showCharge} onClose={closeCharge} title={t('merchant_generate_qr')}>
        {!code ? (
          <div className="space-y-4">
            <label className="text-sm font-medium uv-text-secondary block">{t('merchant_qr_amount')}</label>
            <div className="flex items-center gap-2">
              <span className="text-3xl font-bold uv-text-primary">{symbol}</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="flex-1 text-3xl font-bold bg-transparent outline-none uv-text-primary placeholder-gray-300"
              />
            </div>
            <p className="text-xs uv-text-muted">{t('merchant_qr_amount_hint')}</p>
            {error && <p className="text-[var(--color-danger)] text-sm" aria-live="polite">{error}</p>}
            <Button onClick={charge} loading={generating} size="lg" fullWidth>
              {generating ? t('loading') : t('merchant_generate_qr')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-primary)]">
              {code.type === 'merchant_fixed' ? t('merchant_qr_fixed') : t('merchant_qr_dynamic')}
            </span>
            <div className="bg-white p-4 rounded-2xl border border-gray-200">
              <QRCodeSVG value={code.qrData} size={200} />
            </div>
            {code.amount > 0 && <p className="text-2xl font-black uv-text-primary tabular-nums">{money(code.amount)}</p>}
            <p className="text-sm uv-text-muted text-center max-w-[280px]">{t('merchant_qr_help')}</p>
            <Button onClick={closeCharge} size="lg" fullWidth>{t('close')}</Button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
};
