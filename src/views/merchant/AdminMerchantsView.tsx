import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { getApiLayer } from '@/api';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';

export const AdminMerchantsView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const [merchants, setMerchants] = useState<QRMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [acting, setActing] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState<QRMerchant | null>(null);
  const [reason, setReason] = useState('');

  const cat = (c: string) => t(`merchant_cat_${c}` as Parameters<typeof t>[0]);
  const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const api = getApiLayer();
      if (!api.qrPayments) { if (!cancelled) { setLoading(false); } return; }
      const res = await api.qrPayments.listPendingMerchants();
      if (cancelled) return;
      if (res.success && res.data) setMerchants(res.data);
      else setError(res.error?.message || '');
      setLoading(false);
    };
    run();
    return () => { cancelled = true; };
  }, [reload]);

  const decide = async (m: QRMerchant, approve: boolean, why = '') => {
    setActing(m.id);
    setError('');
    try {
      const api = getApiLayer();
      if (!api.qrPayments) return;
      const res = approve
        ? await api.qrPayments.approveMerchant(m.id)
        : await api.qrPayments.rejectMerchant(m.id, why);
      if (res.success) {
        setRejecting(null);
        setReason('');
        setReload((n) => n + 1);
      } else {
        setError(res.error?.message || t('merchant_admin_action_failed'));
      }
    } catch {
      setError(t('merchant_admin_action_failed'));
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]" aria-label={t('back')}>
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('merchant_admin_title')}</h1>
        <span className="w-9" />
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        <p className="px-4 pt-3 text-xs uv-text-muted">{t('merchant_admin_subtitle')}</p>
        {error && <p className="px-4 pt-2 text-[var(--color-danger)] text-sm" aria-live="polite">{error}</p>}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : merchants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] flex items-center justify-center mb-4">
              <Icons.Check size={26} className="uv-text-muted" />
            </div>
            <p className="font-semibold uv-text-primary">{t('merchant_admin_empty')}</p>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            {merchants.map((m) => (
              <div key={m.id} className="uv-surface-1 rounded-2xl uv-shadow-soft p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-bold uv-text-primary truncate">{m.name}</p>
                  <span className="text-xs uv-text-muted">{t('merchant_commission')}: {pct(m.commissionBps)}</span>
                </div>
                <p className="text-xs uv-text-muted mt-1">{cat(m.category)} · {m.legalName}</p>
                <p className="text-xs uv-text-muted">
                  {m.cedulaType === 'juridica' ? t('merchant_cedula_juridica') : t('merchant_cedula_fisica')}: {m.cedula}
                </p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => decide(m, true)} disabled={acting === m.id} className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-2.5 rounded-xl font-bold disabled:opacity-50">
                    {t('merchant_admin_approve')}
                  </button>
                  <button onClick={() => { setReason(''); setRejecting(m); }} disabled={acting === m.id} className="flex-1 border border-[var(--color-danger)] text-[var(--color-danger)] py-2.5 rounded-xl font-bold disabled:opacity-50">
                    {t('merchant_admin_reject')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomSheet isOpen={rejecting !== null} onClose={() => setRejecting(null)} title={t('merchant_admin_reject')}>
        {rejecting && (
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium uv-text-secondary mb-1.5 block">{t('merchant_admin_reject_reason')}</label>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)] resize-none" />
            </div>
            <button onClick={() => decide(rejecting, false, reason.trim())} disabled={acting === rejecting.id} className="w-full bg-[var(--color-danger)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50">
              {acting === rejecting.id ? t('loading') : t('merchant_admin_reject')}
            </button>
          </div>
        )}
      </BottomSheet>
    </div>
  );
};
