import React, { useEffect, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { useApp } from '@/hooks/useApp';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { BottomSheet } from '@/components/BottomSheet';
import { QRCodeSVG } from 'qrcode.react';
import { getApiLayer } from '@/api';
import type {
  QRMerchant,
  QRPayment,
  QRPaymentCode,
  CatalogItem,
  MerchantLocation,
} from '@/api/repositories/qrpayment.repository';

interface Props {
  merchant: QRMerchant;
  payments: QRPayment[];
  onReload: () => void;
}

// Unique per tap, stable across the retries of that one attempt — so a double
// tap settles once but a deliberate second withdrawal is a new key.
const withdrawAttemptKey = (merchantId: string, val: number) =>
  `mwd:${merchantId}:${val}:${Date.now()}`;

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

  // What the screen shows depends on the caller's role: a cashier collects
  // and sees the sales, but the till (balance + withdraw) is not theirs.
  const isOwner = merchant.role === 'owner';
  const canSeeBalance = isOwner || merchant.role === 'manager';

  const [showCharge, setShowCharge] = useState(false);
  const [amount, setAmount] = useState('');
  const [generating, setGenerating] = useState(false);
  const [code, setCode] = useState<QRPaymentCode | null>(null);
  const [error, setError] = useState('');

  // Charge composition: catalog items and the location the charge is for.
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [locations, setLocations] = useState<MerchantLocation[]>([]);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [locationId, setLocationId] = useState('');

  // Business balance: the shop's own money, separate from the owner's wallet.
  const [balance, setBalance] = useState<number | null>(null);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [wdAmount, setWdAmount] = useState('');
  const [withdrawing, setWithdrawing] = useState(false);
  const [wdError, setWdError] = useState('');

  useEffect(() => {
    if (!canSeeBalance) return; // the endpoint is owner/manager-only
    let cancelled = false;
    void (async () => {
      const api = getApiLayer().qrPayments;
      if (!api) return;
      const res = await api.getMerchantBalance(merchant.id, ccy);
      if (!cancelled && res.success && typeof res.data === 'number') setBalance(res.data);
    })();
    return () => { cancelled = true; };
  }, [merchant.id, ccy, payments, canSeeBalance]);

  // The charge sheet composes from the catalog and can pin a location; both
  // load when the sheet opens so the lists are fresh.
  useEffect(() => {
    if (!showCharge) return;
    let cancelled = false;
    void (async () => {
      const api = getApiLayer().qrPayments;
      if (!api) return;
      const [cRes, lRes] = await Promise.all([api.getCatalog(merchant.id), api.getLocations(merchant.id)]);
      if (cancelled) return;
      if (cRes.success && cRes.data) setCatalog(cRes.data.filter((c) => c.active));
      if (lRes.success && lRes.data) setLocations(lRes.data.filter((l) => l.active));
    })();
    return () => { cancelled = true; };
  }, [showCharge, merchant.id]);

  const verified = merchant.verificationStatus === 'verified';
  const money = (v: number) => `${symbol}${v.toFixed(2)}`;

  const todays = payments.filter((p) => isToday(p.createdAt));
  const todayGross = todays.reduce((s, p) => s + p.amount, 0);
  const totalFee = payments.reduce((s, p) => s + p.fee, 0);

  const cartItems = catalog.filter((c) => (cart[c.id] ?? 0) > 0);
  const cartTotal = cartItems.reduce((s, c) => s + c.price * (cart[c.id] ?? 0), 0);
  const setQty = (id: string, delta: number) =>
    setCart((prev) => {
      const next = Math.max(0, (prev[id] ?? 0) + delta);
      return { ...prev, [id]: next };
    });

  const charge = async () => {
    const api = getApiLayer().qrPayments;
    if (!api || generating) return;
    setGenerating(true);
    setError('');
    setCode(null);
    // A composed cart wins over the manual amount; its note describes the items.
    const fromCart = cartTotal > 0;
    const amt = fromCart ? cartTotal : parseFloat(amount);
    const fixed = fromCart || (Number.isFinite(amt) && amt > 0);
    const note = fromCart
      ? cartItems.map((c) => `${cart[c.id]}x ${c.name}`).join(', ')
      : undefined;
    const res = await api.createQRCode({
      type: fixed ? 'merchant_fixed' : 'merchant_dynamic',
      amount: fixed ? amt : undefined,
      currency: ccy,
      note,
      singleUse: false,
      merchantId: merchant.id,
      locationId: locationId || undefined,
    });
    setGenerating(false);
    if (res.success && res.data) setCode(res.data);
    else setError(res.error?.message || t('merchant_qr_error'));
  };

  const closeCharge = () => {
    setShowCharge(false);
    setCode(null);
    setAmount('');
    setCart({});
    setError('');
    onReload();
  };

  const withdraw = async () => {
    const api = getApiLayer().qrPayments;
    const val = parseFloat(wdAmount);
    if (!api || withdrawing || !(val > 0)) return;
    setWithdrawing(true);
    setWdError('');
    const res = await api.withdrawMerchant(merchant.id, val, ccy, withdrawAttemptKey(merchant.id, val));
    setWithdrawing(false);
    if (res.success) {
      setShowWithdraw(false);
      setWdAmount('');
      onReload();
    } else {
      setWdError(res.error?.message || t('assistant_action_failed'));
    }
  };

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

      {/* Hero: the till for owner/manager; today's sales for a cashier (the
          shop balance is not theirs to see). */}
      <div className="relative overflow-hidden uv-gradient-brand rounded-3xl p-6 text-white uv-shadow-floating">
        <div
          className="absolute -right-12 -bottom-12 w-40 h-40 rounded-full opacity-30 pointer-events-none"
          style={{ background: 'radial-gradient(closest-side, rgba(255,255,255,0.5), transparent)' }}
        />
        {canSeeBalance ? (
          <>
            <span className="relative text-xs font-semibold uppercase tracking-wider text-white/70">
              {t('business_balance')}
            </span>
            <div className="relative text-3xl font-black mt-1 mb-1 tabular-nums">
              {balance === null ? '—' : money(balance)}
            </div>
            <div className="relative text-white/70 text-sm">
              {t('business_sales_today')}: {money(todayGross)} · {todays.length}
            </div>
            {isOwner && (
              <button
                onClick={() => { setWdError(''); setShowWithdraw(true); }}
                disabled={!balance}
                className="relative mt-4 w-full bg-white/15 text-white h-11 rounded-xl font-bold flex items-center justify-center gap-2 border border-white/20 backdrop-blur-sm active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                <Icons.ArrowDownLeft size={18} />
                {t('business_withdraw')}
              </button>
            )}
          </>
        ) : (
          <>
            <span className="relative text-xs font-semibold uppercase tracking-wider text-white/70">
              {t('business_sales_today')}
            </span>
            <div className="relative text-3xl font-black mt-1 mb-1 tabular-nums">{money(todayGross)}</div>
            <div className="relative text-white/70 text-sm">
              {todays.length} · {t('business_cashier_hint')}
            </div>
          </>
        )}
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

      {/* Withdraw to the owner's personal wallet */}
      <BottomSheet isOpen={showWithdraw} onClose={() => setShowWithdraw(false)} title={t('business_withdraw')}>
        <div className="space-y-4">
          <p className="text-sm uv-text-muted">{t('business_withdraw_hint')}</p>
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold uv-text-primary">{symbol}</span>
            <input
              type="number"
              value={wdAmount}
              onChange={(e) => setWdAmount(e.target.value)}
              placeholder="0.00"
              className="flex-1 text-3xl font-bold bg-transparent outline-none uv-text-primary placeholder-gray-300"
            />
          </div>
          <div className="flex justify-between text-sm">
            <span className="uv-text-muted">{t('business_balance')}</span>
            <button
              onClick={() => setWdAmount(String(balance ?? 0))}
              className="font-semibold text-[var(--color-primary)] tabular-nums"
            >
              {balance === null ? '—' : money(balance)}
            </button>
          </div>
          {wdError && <p className="text-[var(--color-danger)] text-sm" aria-live="polite">{wdError}</p>}
          <Button
            onClick={withdraw}
            loading={withdrawing}
            disabled={withdrawing || !(parseFloat(wdAmount) > 0) || parseFloat(wdAmount) > (balance ?? 0)}
            size="lg"
            fullWidth
          >
            {withdrawing ? t('processing') : t('business_withdraw')}
          </Button>
        </div>
      </BottomSheet>

      {/* Charge sheet */}
      <BottomSheet isOpen={showCharge} onClose={closeCharge} title={t('merchant_generate_qr')}>
        {!code ? (
          <div className="space-y-4">
            {/* Compose from the catalog when the shop keeps one; the manual
                amount below still works when the cart is empty. */}
            {catalog.length > 0 && (
              <div>
                <label className="text-sm font-medium uv-text-secondary block mb-2">{t('business_catalog')}</label>
                <div className="uv-surface-1 rounded-2xl divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden max-h-52 overflow-y-auto">
                  {catalog.map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold uv-text-primary truncate">{c.name}</p>
                        <p className="text-[11px] uv-text-muted tabular-nums">{money(c.price)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setQty(c.id, -1)}
                          disabled={!(cart[c.id] ?? 0)}
                          aria-label={`- ${c.name}`}
                          className="w-8 h-8 rounded-lg border border-[var(--color-border)] dark:border-[var(--color-border-dark)] flex items-center justify-center disabled:opacity-40"
                        >
                          <Icons.Minus size={14} />
                        </button>
                        <span className="w-5 text-center text-sm font-bold uv-text-primary tabular-nums">{cart[c.id] ?? 0}</span>
                        <button
                          onClick={() => setQty(c.id, 1)}
                          aria-label={`+ ${c.name}`}
                          className="w-8 h-8 rounded-lg border border-[var(--color-border)] dark:border-[var(--color-border-dark)] flex items-center justify-center"
                        >
                          <Icons.Plus size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {cartTotal > 0 && (
                  <div className="flex justify-between text-sm mt-2 px-1">
                    <span className="uv-text-muted">{t('business_charge_total')}</span>
                    <span className="font-bold uv-text-primary tabular-nums">{money(cartTotal)}</span>
                  </div>
                )}
              </div>
            )}

            {cartTotal === 0 && (
              <>
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
              </>
            )}

            {locations.length > 0 && (
              <div>
                <label className="text-sm font-medium uv-text-secondary block mb-1.5">{t('business_charge_location')}</label>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]"
                >
                  <option value="">—</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
            )}

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
