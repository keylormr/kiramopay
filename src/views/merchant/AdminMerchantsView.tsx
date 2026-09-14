import React, { useState, useEffect, useRef } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { CampoMonto } from '@/components/CampoMonto';
import { getApiLayer } from '@/api';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';
import type { PlanComercio } from '@/api/repositories/plans.repository';
import { porcentajeDeBps, rellenar } from '@/utils/planes';

type Pestana = 'pending' | 'plan';

const PLANES_COMERCIO: readonly PlanComercio[] = ['base', 'analitica'];

// El servidor responde INVALID_ID a cualquier cosa que no sea un UUID: se
// revisa antes para no gastar una peticion (ni una linea de auditoria).
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const nombrePlan = (p: PlanComercio | undefined) => (p === 'analitica' ? 'business_plan_analitica' : 'business_plan_base');

export const AdminMerchantsView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const [pestana, setPestana] = useState<Pestana>('pending');
  const [merchants, setMerchants] = useState<QRMerchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [acting, setActing] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState<QRMerchant | null>(null);
  const [reason, setReason] = useState('');
  // Editable commission per merchant (in percent), defaulted from each row.
  const [commission, setCommission] = useState<Record<string, string>>({});

  // ── Plan de un comercio (pilotos, mientras no exista el cobro) ──
  const [idComercio, setIdComercio] = useState('');
  const [planElegido, setPlanElegido] = useState<PlanComercio>('analitica');
  const [errorPlan, setErrorPlan] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [asignando, setAsignando] = useState(false);
  const asignandoRef = useRef(false);
  const [asignado, setAsignado] = useState<QRMerchant | null>(null);

  const cat = (c: string) => t(`merchant_cat_${c}` as Parameters<typeof t>[0]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      const api = getApiLayer();
      if (!api.qrPayments) { if (!cancelled) { setLoading(false); } return; }
      const res = await api.qrPayments.listPendingMerchants();
      if (cancelled) return;
      if (res.success && res.data) {
        setMerchants(res.data);
        setCommission(Object.fromEntries(res.data.map((m) => [m.id, (m.commissionBps / 100).toString()])));
      } else {
        setError(res.error?.message || '');
      }
      setLoading(false);
    };
    run();
    return () => { cancelled = true; };
  }, [reload]);

  // Approve, first applying an edited commission if the admin changed it.
  const approve = async (m: QRMerchant) => {
    setActing(m.id);
    setError('');
    try {
      const api = getApiLayer();
      if (!api.qrPayments) return;
      const pctVal = parseFloat(commission[m.id] ?? '');
      const bps = Number.isFinite(pctVal) && pctVal >= 0 ? Math.round(pctVal * 100) : m.commissionBps;
      if (bps !== m.commissionBps) {
        const cr = await api.qrPayments.setMerchantCommission(m.id, bps);
        if (!cr.success) { setError(cr.error?.message || t('merchant_admin_action_failed')); return; }
      }
      const res = await api.qrPayments.approveMerchant(m.id);
      if (res.success) setReload((n) => n + 1);
      else setError(res.error?.message || t('merchant_admin_action_failed'));
    } catch {
      setError(t('merchant_admin_action_failed'));
    } finally {
      setActing(null);
    }
  };

  const reject = async (m: QRMerchant, why: string) => {
    setActing(m.id);
    setError('');
    try {
      const api = getApiLayer();
      if (!api.qrPayments) return;
      const res = await api.qrPayments.rejectMerchant(m.id, why);
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

  const revisarPlan = (e: React.FormEvent) => {
    e.preventDefault();
    if (!FORMATO_UUID.test(idComercio.trim())) {
      setErrorPlan('merchant_admin_plan_id_invalid');
      return;
    }
    setErrorPlan(null);
    setConfirmando(true);
  };

  const asignarPlan = async () => {
    if (asignandoRef.current) return;
    asignandoRef.current = true;
    setAsignando(true);
    setErrorPlan(null);
    try {
      const api = getApiLayer();
      if (!api.qrPayments) return;
      const res = await api.qrPayments.setMerchantPlan(idComercio.trim(), planElegido);
      if (res.success && res.data) {
        setAsignado(res.data);
        setIdComercio('');
      } else {
        const codigo = res.error?.code;
        setErrorPlan(
          codigo === 'MERCHANT_NOT_FOUND'
            ? 'merchant_admin_plan_not_found'
            : codigo === 'INVALID_ID'
              ? 'merchant_admin_plan_id_invalid'
              : 'merchant_admin_plan_failed',
        );
      }
    } catch {
      setErrorPlan('merchant_admin_plan_failed');
    } finally {
      asignandoRef.current = false;
      setAsignando(false);
      setConfirmando(false);
    }
  };

  const tabClass = (active: boolean) =>
    `flex-1 py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
      active ? 'bg-white dark:bg-gray-700 uv-text-primary shadow-sm' : 'text-gray-500'
    }`;

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
        <div className="px-4 pt-3">
          <div className="flex bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] p-1 rounded-xl" role="tablist" aria-label={t('merchant_admin_title')}>
            <button type="button" role="tab" aria-selected={pestana === 'pending'} onClick={() => setPestana('pending')} className={tabClass(pestana === 'pending')}>
              <Icons.Shield size={14} aria-hidden="true" />
              {t('merchant_admin_tab_pending')}
            </button>
            <button type="button" role="tab" aria-selected={pestana === 'plan'} onClick={() => setPestana('plan')} className={tabClass(pestana === 'plan')}>
              <Icons.TrendingUp size={14} aria-hidden="true" />
              {t('merchant_admin_tab_plan')}
            </button>
          </div>
        </div>

        {pestana === 'pending' && (
          <>
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
                    <p className="font-bold uv-text-primary truncate">{m.name}</p>
                    <p className="text-xs uv-text-muted mt-1">{cat(m.category)} · {m.legalName}</p>
                    <p className="text-xs uv-text-muted">
                      {m.cedulaType === 'juridica' ? t('merchant_cedula_juridica') : t('merchant_cedula_fisica')}: {m.cedula}
                    </p>
                    <label className="flex items-center gap-2 mt-3 text-sm">
                      <span className="uv-text-secondary">{t('merchant_commission')}</span>
                      <CampoMonto
                        decimals={2}
                        thousands={false}
                        value={commission[m.id] ?? ''}
                        onChange={(v) => setCommission((c) => ({ ...c, [m.id]: v }))}
                        className="w-20 px-2 py-1 rounded-lg border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent outline-none focus:border-[var(--color-primary)]"
                        aria-label={t('merchant_commission')}
                      />
                      <span className="uv-text-muted">%</span>
                    </label>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => approve(m)} disabled={acting === m.id} className="flex-1 bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-2.5 rounded-xl font-bold disabled:opacity-50">
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
          </>
        )}

        {pestana === 'plan' && (
          <div className="px-4 pt-4 space-y-4">
            <p className="text-sm leading-relaxed uv-text-secondary">{t('merchant_admin_plan_desc')}</p>

            {asignado && (
              <div role="status" className="rounded-2xl uv-chip-success p-4">
                <p className="text-sm font-bold">
                  {rellenar(t('merchant_admin_plan_done'), { name: asignado.name, plan: t(nombrePlan(asignado.plan)) })}
                </p>
                <p className="mt-1 text-xs tabular-nums">
                  {t('business_commission_today')}: {porcentajeDeBps(asignado.comisionEfectivaBps ?? asignado.commissionBps)}
                </p>
              </div>
            )}

            <form onSubmit={revisarPlan} className="uv-surface-1 rounded-2xl uv-shadow-soft p-4 space-y-4" noValidate>
              <div>
                <label htmlFor="admin-comercio-id" className="text-sm font-medium uv-text-secondary mb-1.5 block">
                  {t('merchant_admin_plan_id_label')}
                </label>
                <input
                  id="admin-comercio-id"
                  type="text"
                  value={idComercio}
                  onChange={(e) => { setIdComercio(e.target.value); if (errorPlan) setErrorPlan(null); }}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  inputMode="text"
                  placeholder="00000000-0000-0000-0000-000000000000"
                  aria-invalid={errorPlan === 'merchant_admin_plan_id_invalid' || undefined}
                  className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] bg-transparent font-mono text-sm outline-none focus:border-[var(--color-primary)]"
                />
              </div>

              <fieldset>
                <legend className="text-sm font-medium uv-text-secondary mb-1.5">{t('business_plan_label')}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {PLANES_COMERCIO.map((p) => {
                    const elegido = planElegido === p;
                    return (
                      <label
                        key={p}
                        className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-primary)] ${
                          elegido
                            ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]'
                            : 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
                        }`}
                      >
                        <input
                          type="radio"
                          name="plan-comercio"
                          value={p}
                          checked={elegido}
                          onChange={() => setPlanElegido(p)}
                          className="mt-1 accent-[var(--color-primary)]"
                        />
                        <span className="min-w-0">
                          <span className="block font-bold uv-text-primary">{t(nombrePlan(p))}</span>
                          <span className="mt-0.5 block text-xs leading-relaxed uv-text-secondary">
                            {t(p === 'analitica' ? 'merchant_admin_plan_analitica_desc' : 'merchant_admin_plan_base_desc')}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              {errorPlan && <p role="alert" className="text-sm text-[var(--color-danger)]">{t(errorPlan)}</p>}

              <button
                type="submit"
                disabled={asignando}
                className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50"
              >
                {t('merchant_admin_plan_review')}
              </button>
            </form>
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
            <button onClick={() => reject(rejecting, reason.trim())} disabled={acting === rejecting.id} className="w-full bg-[var(--color-danger)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50">
              {acting === rejecting.id ? t('loading') : t('merchant_admin_reject')}
            </button>
          </div>
        )}
      </BottomSheet>

      <BottomSheet
        isOpen={confirmando}
        onClose={() => { if (!asignando) setConfirmando(false); }}
        title={t('merchant_admin_plan_confirm_title')}
        dismissable={!asignando}
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed uv-text-secondary break-words">
            {rellenar(t('merchant_admin_plan_confirm_body'), { plan: t(nombrePlan(planElegido)), id: idComercio.trim() })}
          </p>
          <p className="text-xs leading-relaxed uv-text-muted">{t('admin_users_plan_hint')}</p>
          <button
            type="button"
            onClick={() => void asignarPlan()}
            disabled={asignando}
            className="w-full bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white py-3.5 rounded-xl font-bold disabled:opacity-50"
          >
            {asignando ? t('loading') : rellenar(t('merchant_admin_plan_confirm'), { plan: t(nombrePlan(planElegido)) })}
          </button>
        </div>
      </BottomSheet>
    </div>
  );
};
