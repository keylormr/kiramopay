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
  QRCharge,
  CatalogItem,
  MerchantLocation,
} from '@/api/repositories/qrpayment.repository';
import { mensajeDeCobro, minutosParaVencer } from '@/utils/erroresQr';
import { formatMoney, type CurrencyCode } from '@/utils/money';

interface Props {
  merchant: QRMerchant;
  payments: QRPayment[];
  /** La lista no se pudo traer: sin esto, "vendido hoy" mostraria 0 como hecho. */
  paymentsFailed?: boolean;
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

export const BusinessHomeView: React.FC<Props> = ({ merchant, payments, paymentsFailed = false, onReload }) => {
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
  // El rotulo del mostrador: una sola fila por (comercio, sucursal, moneda),
  // que no cambia jamas. Antes cada toque de "Generar QR" creaba una identidad
  // nueva, permanente y pagable para siempre.
  const [code, setCode] = useState<QRPaymentCode | null>(null);
  // El cobro de la venta en curso, con su propio QR.
  const [cobro, setCobro] = useState<QRCharge | null>(null);
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

  // El rotulo del mostrador se carga una vez y se muestra siempre: la pantalla
  // abre con el QR ya puesto, sin paso previo.
  useEffect(() => {
    if (!showCharge) return;
    let cancelled = false;
    void (async () => {
      const api = getApiLayer().qrPayments;
      if (!api) return;
      const res = await api.getMerchantCode(merchant.id, { locationId: locationId || undefined, currency: ccy });
      if (cancelled) return;
      if (res.success && res.data) setCode(res.data);
      else setError(mensajeDeCobro(t, res.error?.code) || res.error?.message || t('merchant_qr_error'));
    })();
    return () => { cancelled = true; };
  }, [showCharge, merchant.id, locationId, ccy, t]);

  // "Ya entro": con la pantalla del cobro abierta se pregunta por su estado
  // cada pocos segundos. El aviso por WebSocket llega igual y es mas rapido;
  // esto es el respaldo por si el socket esta caido, que es cuando un mostrador
  // mas lo necesita.
  useEffect(() => {
    if (!showCharge || !cobro || cobro.status !== 'pending') return;
    const api = getApiLayer().qrPayments;
    if (!api) return;
    const timer = setInterval(() => {
      void (async () => {
        const res = await api.getCharge(cobro.id);
        if (res.success && res.data && res.data.status !== cobro.status) {
          setCobro(res.data);
          if (res.data.status === 'paid') onReload();
        }
      })();
    }, 5000);
    return () => clearInterval(timer);
  }, [showCharge, cobro, onReload]);

  const verified = merchant.verificationStatus === 'verified';
  // Cada cobro trae su moneda; rotularlo todo con el simbolo de la moneda base
  // de la aplicacion convertia un cobro en dolares en uno en colones a la vista.
  //
  // El formateo sale de utils/money y no de un `symbol + toFixed(2)` local: ese
  // atajo perdia el separador de miles, asi que el panel mostraba ₡125000.00
  // donde el resto de la aplicacion muestra ₡125,000.00. La regla de los miles
  // con coma la pidio el dueno para TODOS los montos.
  const money = (v: number, moneda?: string) =>
    formatMoney(v, (moneda || ccy) as CurrencyCode, { decimals: 2 });
  const SIN_DATO = '—';

  // Un cobro trae su propia moneda. Sumarlos todos juntos y rotularlos con el
  // simbolo de la moneda base de la aplicacion mezcla colones con dolares y
  // ademas los etiqueta mal: el mismo defecto que se corrigio en la analitica.
  const enMoneda = payments.filter((p) => (p.currency || ccy) === ccy);
  const otraMoneda = payments.length - enMoneda.length;

  const todays = enMoneda.filter((p) => isToday(p.createdAt));
  const todayGross = todays.reduce((s, p) => s + p.amount, 0);
  const totalFee = enMoneda.reduce((s, p) => s + p.fee, 0);
  const ventana = enMoneda.length;

  const cartItems = catalog.filter((c) => (cart[c.id] ?? 0) > 0);
  const cartTotal = cartItems.reduce((s, c) => s + c.price * (cart[c.id] ?? 0), 0);
  const setQty = (id: string, delta: number) =>
    setCart((prev) => {
      const next = Math.max(0, (prev[id] ?? 0) + delta);
      return { ...prev, [id]: next };
    });

  // Cobrar un monto ya no crea una identidad: emite un COBRO contra el rotulo.
  // Si ya hay uno en curso, lo reemplaza — y si ese ya se pago, el servidor lo
  // dice y no se emite ninguno, que es lo que impide pedir el pago dos veces.
  const charge = async () => {
    const api = getApiLayer().qrPayments;
    if (!api || generating || !code) return;
    const fromCart = cartTotal > 0;
    const amt = fromCart ? cartTotal : parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setGenerating(true);
    setError('');
    const note = fromCart
      ? cartItems.map((c) => `${cart[c.id]}x ${c.name}`).join(', ')
      : undefined;
    const res = await api.createCharge({
      qrCodeId: code.id,
      amount: amt,
      note,
      channel: 'counter',
      replaces: cobro?.status === 'pending' ? cobro.id : undefined,
    });
    setGenerating(false);
    if (res.success && res.data) {
      setCobro(res.data);
      setAmount('');
      setCart({});
      return;
    }
    setError(mensajeDeCobro(t, res.error?.code) || res.error?.message || t('merchant_qr_error'));
    if (res.error?.code === 'COBRO_YA_PAGADO') {
      // La pantalla estaba atrasada: la venta ya entro.
      const actual = await api.getCharge(cobro?.id ?? '');
      if (actual.success && actual.data) setCobro(actual.data);
      onReload();
    }
  };

  // Cancelar el cobro en curso. Sobre uno ya pagado NO dice "cancelado".
  const cancelarCobro = async () => {
    const api = getApiLayer().qrPayments;
    if (!api || !cobro) return;
    setError('');
    const res = await api.cancelCharge(cobro.id);
    if (res.success) {
      setCobro(null);
      return;
    }
    setError(mensajeDeCobro(t, res.error?.code) || res.error?.message || t('merchant_qr_error'));
    if (res.error?.code === 'COBRO_YA_PAGADO') {
      const actual = await api.getCharge(cobro.id);
      if (actual.success && actual.data) setCobro(actual.data);
      onReload();
    }
  };

  // Siguiente cliente: limpia la venta y deja el mostrador listo, con el rotulo
  // intacto. El codigo del mostrador NO se descarta nunca.
  const siguienteCliente = () => {
    setCobro(null);
    setAmount('');
    setCart({});
    setError('');
    onReload();
  };

  const closeCharge = () => {
    setShowCharge(false);
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
              {t('business_sales_today')}: {paymentsFailed ? SIN_DATO : `${money(todayGross)} · ${todays.length}`}
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
            <div className="relative text-3xl font-black mt-1 mb-1 tabular-nums">{paymentsFailed ? SIN_DATO : money(todayGross)}</div>
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

      {/* Totales de la ventana consultada.
          El servidor entrega los ULTIMOS 50 cobros, no el historico. Llamar
          "total vendido" a la suma de esa ventana es dar por total un numero
          truncado: un comercio con mas de 50 ventas veia menos de lo que
          vendio, sin ninguna senal. Se rotula por lo que es, y el historico
          completo esta en la pestana de reportes, que si agrega en el
          servidor. */}
      <div className="uv-surface-1 rounded-2xl p-4 uv-shadow-soft space-y-2">
        <div className="flex justify-between text-sm">
          <span className="uv-text-muted">{t('business_sales_window').replace('{n}', String(ventana))}</span>
          <span className="font-semibold uv-text-primary tabular-nums">
            {paymentsFailed ? SIN_DATO : money(enMoneda.reduce((s, p) => s + p.amount, 0))}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="uv-text-muted">{t('business_commission_paid')}</span>
          <span className="font-semibold uv-text-primary tabular-nums">{paymentsFailed ? SIN_DATO : money(totalFee)}</span>
        </div>
        <div className="flex justify-between text-sm border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] pt-2">
          <span className="uv-text-muted">{t('merchant_net_received')}</span>
          <span className="font-bold uv-text-primary tabular-nums">
            {paymentsFailed ? SIN_DATO : money(enMoneda.reduce((s, p) => s + (p.amount - p.fee), 0))}
          </span>
        </div>
        {otraMoneda > 0 && (
          <p className="pt-1 text-xs uv-text-muted">
            {t('other_currency_note').replace('{n}', String(otraMoneda))}
          </p>
        )}
        {paymentsFailed && (
          <button
            onClick={onReload}
            className="mt-1 w-full rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] py-2 text-sm font-bold uv-text-primary"
          >
            {t('error_retry')}
          </button>
        )}
      </div>

      {/* Recent movements */}
      <div>
        <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-2">{t('business_movements')}</h3>
        {paymentsFailed ? (
          <p className="text-sm uv-text-muted">{t('business_sales_load_failed')}</p>
        ) : payments.length === 0 ? (
          <p className="text-sm uv-text-muted">{t('merchant_history_empty')}</p>
        ) : (
          <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
            {payments.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold uv-text-primary tabular-nums">{money(p.amount - p.fee, p.currency)}</p>
                  <p className="text-[11px] uv-text-muted">
                    {t('merchant_fee_label')} {money(p.fee, p.currency)} · {new Date(p.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-[11px] uv-text-muted shrink-0">{t('merchant_gross')} {money(p.amount, p.currency)}</p>
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

      {/* Hoja de cobro. El QR del mostrador esta SIEMPRE arriba; cobrar un
          monto no lo reemplaza, emite un cobro con su propio codigo. */}
      <BottomSheet isOpen={showCharge} onClose={closeCharge} title={t('merchant_generate_qr')}>
        <div className="space-y-4">
          {/* ── El rotulo ─────────────────────────────────────────────── */}
          <div className="flex flex-col items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-primary)]">
              {cobro ? t('qr_cobrando').replace('{amount}', money(cobro.amount, cobro.currency)) : t('qr_rotulo_mostrador')}
            </span>
            <div className="bg-white p-4 rounded-2xl border border-gray-200">
              {code || cobro ? (
                <QRCodeSVG value={(cobro ?? code)!.qrData} size={200} />
              ) : (
                <div className="w-[200px] h-[200px] flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>

            {cobro?.status === 'paid' ? (
              <div className="flex items-center gap-2 uv-chip-success px-3 py-1.5 rounded-full" role="status">
                <Icons.Check size={16} />
                <span className="text-sm font-bold">{t('qr_pagado')}</span>
              </div>
            ) : cobro ? (
              <p className="text-xs uv-text-muted">
                {t('qr_vence_en_min').replace('{min}', String(minutosParaVencer(cobro.expiresAt)))}
              </p>
            ) : (
              <p className="text-sm uv-text-muted text-center max-w-[280px]">{t('qr_rotulo_ayuda')}</p>
            )}
          </div>

          {cobro?.status === 'paid' ? (
            <Button onClick={siguienteCliente} size="lg" fullWidth>{t('qr_siguiente_cliente')}</Button>
          ) : (
            <>
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

              {locations.length > 0 && !cobro && (
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

              <Button
                onClick={charge}
                loading={generating}
                disabled={generating || !code || !(cartTotal > 0 || parseFloat(amount) > 0)}
                size="lg"
                fullWidth
              >
                {generating ? t('loading') : cobro ? t('qr_cambiar_monto') : t('qr_cobrar_monto')}
              </Button>

              {cobro && (
                <button
                  onClick={cancelarCobro}
                  className="w-full py-3 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-secondary font-bold"
                >
                  {t('qr_cancelar_cobro')}
                </button>
              )}
            </>
          )}
        </div>
      </BottomSheet>
    </div>
  );
};
