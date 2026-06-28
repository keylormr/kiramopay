import React, { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { useApp } from '@/hooks/useApp';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { QRCodeSVG } from 'qrcode.react';
import { getApiLayer } from '@/api';
import type {
  QRMerchant,
  QRPayment,
  QRPaymentCode,
  MerchantVerificationStatus,
} from '@/api/repositories/qrpayment.repository';

const STATUS_COLOR: Record<MerchantVerificationStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  verified: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

const CATEGORIES = ['restaurant', 'retail', 'services', 'food_truck', 'market'] as const;

export const MerchantView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const { state } = useApp();
  const baseAccount = state.accounts.find((a) => a.ccy === state.baseCurrency) || state.accounts[0];
  const ccy = baseAccount?.ccy ?? 'CRC';
  const symbol = baseAccount?.symbol ?? '₡';

  const [merchants, setMerchants] = useState<QRMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  // Register form
  const [showRegister, setShowRegister] = useState(false);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [cedula, setCedula] = useState('');
  const [cedulaType, setCedulaType] = useState<'fisica' | 'juridica'>('fisica');
  const [legalName, setLegalName] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Detail / QR
  const [selected, setSelected] = useState<QRMerchant | null>(null);
  const [payments, setPayments] = useState<QRPayment[]>([]);
  const [codes, setCodes] = useState<QRPaymentCode[]>([]);
  const [qrAmount, setQrAmount] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<QRPaymentCode | null>(null);
  const [detailError, setDetailError] = useState('');

  const cat = useCallback((c: string) => t(`merchant_cat_${c}` as Parameters<typeof t>[0]), [t]);

  const money = (v: number) => `${symbol}${v.toFixed(2)}`;
  const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const api = getApiLayer();
      if (!api.qrPayments) {
        if (!cancelled) { setError(t('merchant_register_error')); setLoading(false); }
        return;
      }
      const res = await api.qrPayments.getMerchants();
      if (cancelled) return;
      if (res.success && res.data) setMerchants(res.data);
      else setError(res.error?.message || '');
      setLoading(false);
    };
    run();
    return () => { cancelled = true; };
  }, [reload, t]);

  const register = async () => {
    if (!name.trim() || !cedula.trim() || !legalName.trim() || !accepted) return;
    setSubmitting(true);
    setError('');
    try {
      const api = getApiLayer();
      if (!api.qrPayments) { setError(t('merchant_register_error')); return; }
      const res = await api.qrPayments.registerMerchant({
        name: name.trim(),
        description: description.trim(),
        category,
        cedula: cedula.trim(),
        cedulaType,
        legalName: legalName.trim(),
      });
      if (res.success) {
        setShowRegister(false);
        setName(''); setDescription(''); setCedula(''); setLegalName(''); setAccepted(false);
        setCategory(CATEGORIES[0]); setCedulaType('fisica');
        setReload((n) => n + 1);
      } else {
        setError(res.error?.message || t('merchant_register_error'));
      }
    } catch {
      setError(t('merchant_register_error'));
    } finally {
      setSubmitting(false);
    }
  };

  const openDetail = async (m: QRMerchant) => {
    setSelected(m);
    setGenerated(null);
    setQrAmount('');
    setDetailError('');
    setPayments([]);
    setCodes([]);
    const api = getApiLayer();
    if (!api.qrPayments) return;
    const [histRes, codesRes] = await Promise.all([
      api.qrPayments.getPaymentHistory(),
      api.qrPayments.getQRCodes(),
    ]);
    if (histRes.success && histRes.data) {
      setPayments(histRes.data.filter((p) => p.merchantId === m.id));
    }
    if (codesRes.success && codesRes.data) {
      setCodes(codesRes.data.filter((c) => c.merchantId === m.id));
    }
  };

  const generateQR = async () => {
    if (!selected) return;
    setGenerating(true);
    setDetailError('');
    setGenerated(null);
    try {
      const api = getApiLayer();
      if (!api.qrPayments) { setDetailError(t('merchant_qr_error')); return; }
      const amt = parseFloat(qrAmount);
      const hasAmount = Number.isFinite(amt) && amt > 0;
      const res = await api.qrPayments.createQRCode({
        type: hasAmount ? 'merchant_fixed' : 'merchant_dynamic',
        amount: hasAmount ? amt : undefined,
        currency: ccy,
        singleUse: false,
        merchantId: selected.id,
      });
      if (res.success && res.data) {
        setGenerated(res.data);
        setCodes((cs) => [res.data as QRPaymentCode, ...cs]);
      } else {
        setDetailError(res.error?.message || t('merchant_qr_error'));
      }
    } catch {
      setDetailError(t('merchant_qr_error'));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]" aria-label={t('back')}>
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('merchant_panel_title')}</h1>
        <button onClick={() => { setError(''); setShowRegister(true); }} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]" aria-label={t('merchant_register')}>
          <Icons.Plus size={20} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto pb-8">
        <p className="px-4 pt-3 text-xs uv-text-muted">{t('merchant_panel_subtitle')}</p>
        {error && <p className="px-4 pt-2 text-[var(--color-danger)] text-sm" aria-live="polite">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : merchants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] flex items-center justify-center mb-4">
              <Icons.QrCode size={26} className="uv-text-muted" />
            </div>
            <p className="font-semibold uv-text-primary">{t('merchant_empty')}</p>
            <p className="text-sm uv-text-muted mt-1 max-w-[280px]">{t('merchant_empty_desc')}</p>
            <button onClick={() => { setError(''); setShowRegister(true); }} className="mt-5 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white px-5 py-2.5 rounded-xl font-bold">
              {t('merchant_register')}
            </button>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            {merchants.map((m) => (
              <button key={m.id} onClick={() => openDetail(m)} className="w-full text-left uv-surface-1 rounded-2xl uv-shadow-soft p-4 hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold uv-text-primary truncate">{m.name}</p>
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${STATUS_COLOR[m.verificationStatus]}`}>
                    {t(`merchant_status_${m.verificationStatus}` as Parameters<typeof t>[0])}
                  </span>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-xs uv-text-muted">{cat(m.category)}</p>
                  <p className="text-xs uv-text-muted">{t('merchant_commission')}: {pct(m.commissionBps)}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Register sheet */}
      <BottomSheet isOpen={showRegister} onClose={() => setShowRegister(false)} title={t('merchant_register_title')}>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('merchant_name')}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]" />
          </div>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('merchant_category')}</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]">
              {CATEGORIES.map((c) => <option key={c} value={c}>{cat(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('merchant_desc')}</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]" />
          </div>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('merchant_cedula_type')}</label>
            <select value={cedulaType} onChange={(e) => setCedulaType(e.target.value as 'fisica' | 'juridica')} className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]">
              <option value="fisica">{t('merchant_cedula_fisica')}</option>
              <option value="juridica">{t('merchant_cedula_juridica')}</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('merchant_cedula')}</label>
            <input value={cedula} onChange={(e) => setCedula(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]" />
          </div>
          <div>
            <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('merchant_legal_name')}</label>
            <input value={legalName} onChange={(e) => setLegalName(e.target.value)} className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]" />
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 w-4 h-4 accent-[var(--color-primary)]" />
            <span className="text-sm uv-text-secondary">{t('merchant_terms')}</span>
          </label>
          {error && <p className="text-[var(--color-danger)] text-sm" aria-live="polite">{error}</p>}
          <button onClick={register} disabled={submitting || !name.trim() || !cedula.trim() || !legalName.trim() || !accepted} className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50 disabled:cursor-not-allowed">
            {submitting ? t('loading') : t('merchant_register_btn')}
          </button>
        </div>
      </BottomSheet>

      {/* Merchant detail / QR sheet */}
      <BottomSheet isOpen={selected !== null} onClose={() => setSelected(null)} title={selected?.name || t('merchant_panel_title')}>
        {selected && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${STATUS_COLOR[selected.verificationStatus]}`}>
                {t(`merchant_status_${selected.verificationStatus}` as Parameters<typeof t>[0])}
              </span>
              <span className="text-xs uv-text-muted">{t('merchant_commission')}: {pct(selected.commissionBps)}</span>
            </div>

            {selected.verificationStatus !== 'verified' ? (
              <p className="text-sm uv-text-muted bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] rounded-xl p-3">
                {selected.verificationStatus === 'rejected' && selected.rejectionReason
                  ? selected.rejectionReason
                  : t('merchant_status_pending_help')}
              </p>
            ) : !generated ? (
              <div className="space-y-3">
                <label className="text-sm font-medium uv-text-secondary block">{t('merchant_qr_amount')}</label>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold uv-text-primary">{symbol}</span>
                  <input type="number" value={qrAmount} onChange={(e) => setQrAmount(e.target.value)} placeholder="0.00" className="flex-1 text-2xl font-bold bg-transparent outline-none uv-text-primary placeholder-gray-300" />
                </div>
                <p className="text-xs uv-text-muted">{t('merchant_qr_amount_hint')}</p>
                {detailError && <p className="text-[var(--color-danger)] text-sm" aria-live="polite">{detailError}</p>}
                <button onClick={generateQR} disabled={generating} className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50">
                  {generating ? t('loading') : t('merchant_generate_qr')}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center space-y-3">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--color-primary)]">
                  {generated.type === 'merchant_fixed' ? t('merchant_qr_fixed') : t('merchant_qr_dynamic')}
                </span>
                <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
                  <QRCodeSVG value={generated.qrData} size={196} />
                </div>
                {generated.amount > 0 && <p className="text-2xl font-black uv-text-primary tabular-nums">{money(generated.amount)}</p>}
                <p className="text-sm uv-text-muted text-center max-w-[280px]">{t('merchant_qr_help')}</p>
                <div className="flex gap-3 w-full">
                  <button onClick={() => { navigator.clipboard?.writeText(generated.qrData); }} className="flex-1 border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary py-3 rounded-xl font-bold flex items-center justify-center gap-2">
                    <Icons.Copy size={18} /> {t('copy')}
                  </button>
                  <button onClick={() => { setGenerated(null); setQrAmount(''); }} className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3 rounded-xl font-bold">
                    {t('merchant_generate_qr')}
                  </button>
                </div>
              </div>
            )}

            {/* Merchant QR codes */}
            {codes.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-2">{t('merchant_codes')}</h3>
                <div className="space-y-2">
                  {codes.map((c) => (
                    <div key={c.id} className="uv-surface-1 rounded-xl p-3 flex items-center justify-between">
                      <p className="text-sm font-semibold uv-text-primary">
                        {c.type === 'merchant_fixed' ? t('merchant_qr_fixed') : t('merchant_qr_dynamic')}
                        {c.amount > 0 ? ` · ${money(c.amount)}` : ''}
                      </p>
                      <button onClick={() => { navigator.clipboard?.writeText(c.qrData); }} className="uv-text-muted" aria-label={t('copy')}>
                        <Icons.Copy size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* History */}
            <div>
              <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-2">{t('merchant_history')}</h3>
              {payments.length === 0 ? (
                <p className="text-sm uv-text-muted">{t('merchant_history_empty')}</p>
              ) : (
                <div className="space-y-2">
                  {payments.map((p) => (
                    <div key={p.id} className="uv-surface-1 rounded-xl p-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold uv-text-primary tabular-nums">{money(p.amount - p.fee)}</p>
                        <p className="text-[11px] uv-text-muted">
                          {t('merchant_net_received')} · {t('merchant_fee_label')} {money(p.fee)}
                        </p>
                      </div>
                      <p className="text-[11px] uv-text-muted">{t('merchant_gross')} {money(p.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
};
