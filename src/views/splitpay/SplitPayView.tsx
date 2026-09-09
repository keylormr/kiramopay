import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/ui/Button';
import { getApiLayer } from '@/api';
import { formatMoney } from '@/utils/money';
import type { SplitGroup, SplitShare } from '@/api/repositories/splitpay.repository';
import { useAuthStore } from '@/stores/auth.store';

export const SplitPayView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useLanguage();
  const [splits, setSplits] = useState<SplitGroup[]>([]);
  const [loading, setLoading] = useState(true);
  // Una consulta que falla no es "no tenes divisiones". Sin esta bandera la
  // pantalla mostraba el estado vacio y su invitacion a crear una, como si la
  // respuesta del servidor hubiera llegado y viniera sin nada.
  const [errorCarga, setErrorCarga] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [loadTrigger, setLoadTrigger] = useState(0);

  // Form state
  const [title, setTitle] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [splitType, setSplitType] = useState<'equal' | 'custom'>('equal');
  const [participants, setParticipants] = useState([
    { userName: '', userPhone: '', amount: '' },
    { userName: '', userPhone: '', amount: '' },
  ]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Detalle: es donde se ve quien debe que y donde se paga la propia parte.
  const yoID = useAuthStore((st) => st.user?.id);
  const [detalle, setDetalle] = useState<{ group: SplitGroup; shares: SplitShare[] } | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const [pagando, setPagando] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setErrorCarga(false);
      const api = getApiLayer();
      if (!api.splitPay) {
        if (!cancelled) {
          setErrorCarga(true);
          setLoading(false);
        }
        return;
      }
      try {
        const res = await api.splitPay.listSplits();
        if (cancelled) return;
        if (res.success && res.data) setSplits(res.data);
        else setErrorCarga(true);
      } catch {
        if (!cancelled) setErrorCarga(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [loadTrigger]);

  const handleCreate = async () => {
    if (!title || !totalAmount || creating) return;
    const api = getApiLayer();
    if (!api.splitPay) return;

    // El telefono no es opcional: es lo unico que permite saber a que cuenta se
    // le cobra. Sin el, el servidor rechaza la division entera.
    const validParticipants = participants.filter(p => p.userName.trim() && p.userPhone.trim());
    if (validParticipants.length === 0) {
      setCreateError(t('splitpay_phone_hint'));
      return;
    }

    const amount = parseFloat(totalAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    setCreating(true);
    setCreateError(null);
    const res = await api.splitPay.createSplit({
      title,
      totalAmount: amount,
      currency: 'CRC',
      splitType,
      participants: validParticipants.map(p => ({
        userName: p.userName.trim(),
        userPhone: p.userPhone.trim(),
        // En partes iguales reparte el servidor, que es quien sabe que el
        // creador tambien cuenta. Mandar una cifra ya dividida desde aqui era
        // lo que hacia que la pantalla y el servidor mostraran numeros
        // distintos.
        amount: splitType === 'custom' ? parseFloat(p.amount) || 0 : undefined,
      })),
    });
    setCreating(false);

    if (!res.success) {
      setCreateError(res.error?.message || t('error'));
      return;
    }
    setShowCreate(false);
    setTitle('');
    setTotalAmount('');
    setParticipants([{ userName: '', userPhone: '', amount: '' }, { userName: '', userPhone: '', amount: '' }]);
    setLoadTrigger(n => n + 1);
  };

  const abrirDetalle = async (groupId: string) => {
    const api = getApiLayer();
    if (!api.splitPay) return;
    setCargandoDetalle(true);
    setErrorDetalle(null);
    setDetalle(null);
    const res = await api.splitPay.getSplit(groupId);
    setCargandoDetalle(false);
    if (!res.success || !res.data) {
      setErrorDetalle(res.error?.message || t('error'));
      return;
    }
    setDetalle(res.data);
  };

  const pagarMiParte = async () => {
    if (!detalle || pagando) return;
    const api = getApiLayer();
    if (!api.splitPay) return;
    setPagando(true);
    setErrorDetalle(null);
    const res = await api.splitPay.payShare(detalle.group.id);
    setPagando(false);
    if (!res.success) {
      setErrorDetalle(res.error?.message || t('error'));
      return;
    }
    await abrirDetalle(detalle.group.id);
    setLoadTrigger(n => n + 1);
  };

  const addParticipant = () => {
    setParticipants([...participants, { userName: '', userPhone: '', amount: '' }]);
  };

  const updateParticipant = (idx: number, field: 'userName' | 'userPhone' | 'amount', value: string) => {
    setParticipants(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const removeParticipant = (idx: number) => {
    if (participants.length <= 2) return;
    setParticipants(prev => prev.filter((_, i) => i !== idx));
  };


  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400';
      case 'settled': return 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400';
      case 'cancelled': return 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400';
      default: return 'bg-gray-100 text-gray-500';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button onClick={onClose} className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors" aria-label={t('back')}>
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('splitpay_title')}</h1>
        <button onClick={() => setShowCreate(true)} aria-label={t('splitpay_create')} className="p-2 -mr-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors text-[var(--color-primary)]">
          <Icons.Plus size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : errorCarga ? (
          <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <Icons.AlertCircle size={26} className="text-[var(--color-danger)] mb-3" aria-hidden="true" />
            <p className="font-semibold uv-text-primary" role="alert">{t('splitpay_err_load')}</p>
            <button
              type="button"
              onClick={() => setLoadTrigger((n) => n + 1)}
              className="mt-4 px-5 py-2.5 rounded-xl bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white text-sm font-bold"
            >
              {t('error_retry')}
            </button>
          </div>
        ) : splits.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-4 text-gray-400">
            <div className="w-24 h-24 rounded-3xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] flex items-center justify-center mb-4">
              <Icons.Users size={48} className="opacity-30" />
            </div>
            <p className="text-lg font-bold mb-2 uv-text-primary">{t('splitpay_no_splits')}</p>
            <p className="text-sm text-center mb-6">{t('splitpay_no_splits_desc')}</p>
            <Button variant="primary" size="md" onClick={() => setShowCreate(true)}>
              {t('splitpay_create')}
            </Button>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-3">
            {splits.map((split, i) => (
              <button
                key={split.id}
                type="button"
                onClick={() => abrirDetalle(split.id)}
                className="w-full text-left uv-surface-1 rounded-2xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-4 shadow-sm animate-stagger hover:border-[var(--color-primary)]/40 transition-colors"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-bold uv-text-primary text-sm">{split.title}</h3>
                    {split.description && <p className="text-xs text-gray-400 mt-0.5">{split.description}</p>}
                  </div>
                  <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${getStatusColor(split.status)}`}>
                    {split.status}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-lg font-extrabold uv-text-primary">
                    {formatMoney(split.totalAmount, split.currency as 'CRC' | 'USD')}
                  </span>
                  <span className="text-xs text-gray-400">
                    {split.splitType === 'equal' ? t('splitpay_equal') : t('splitpay_custom')}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create Split Sheet */}
      <BottomSheet isOpen={showCreate} onClose={() => setShowCreate(false)} title={t('splitpay_create')}>
        <div className="space-y-4 pb-2">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">{t('splitpay_desc')}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('splitpay_desc_placeholder')}
              className="w-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] px-4 py-3 rounded-xl text-sm font-medium outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wider block mb-2">{t('amount')}</label>
            <div className="flex items-center bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl px-4 py-3">
              <span className="text-lg font-bold text-gray-400 mr-2">₡</span>
              <input type="number" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="0"
                className="flex-1 bg-transparent text-lg font-bold outline-none uv-text-primary" />
            </div>
          </div>

          {/* Split type */}
          <div className="flex p-1 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl">
            {(['equal', 'custom'] as const).map((type) => (
              <button key={type} onClick={() => setSplitType(type)}
                className={`flex-1 py-2 rounded-lg text-sm font-bold transition-all ${splitType === type ? 'bg-white dark:bg-gray-700 shadow-sm uv-text-primary' : 'text-gray-500'}`}>
                {type === 'equal' ? t('splitpay_equal') : t('splitpay_custom')}
              </button>
            ))}
          </div>

          {/* Participants */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">{t('splitpay_participants')}</label>
              <button onClick={addParticipant} className="text-[var(--color-primary)] text-xs font-bold">+ {t('add')}</button>
            </div>
            <div className="space-y-2">
              {participants.map((p, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input type="text" value={p.userName} onChange={(e) => updateParticipant(i, 'userName', e.target.value)}
                    placeholder={t('contact_name')}
                    className="min-w-0 flex-1 basis-32 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] px-3 py-2.5 rounded-xl text-sm outline-none" />
                  <input type="tel" value={p.userPhone} onChange={(e) => updateParticipant(i, 'userPhone', e.target.value)}
                    placeholder={t('phone')}
                    className="min-w-0 w-32 flex-shrink bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] px-3 py-2.5 rounded-xl text-sm outline-none" />
                  {splitType === 'custom' && (
                    <input type="number" inputMode="decimal" value={p.amount}
                      onChange={(e) => updateParticipant(i, 'amount', e.target.value)}
                      placeholder={t('amount')}
                      className="min-w-0 w-24 flex-shrink bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] px-3 py-2.5 rounded-xl text-sm outline-none" />
                  )}
                  {participants.length > 2 && (
                    <button onClick={() => removeParticipant(i)} className="px-2 text-gray-400 hover:text-red-500">
                      <Icons.X size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">{t('splitpay_phone_hint')}</p>
            {totalAmount && participants.filter(p => p.userName).length > 0 && splitType === 'equal' && (
              <p className="text-xs text-[var(--color-primary)] font-medium mt-2">
                {formatMoney(parseFloat(totalAmount) / (participants.filter(p => p.userName.trim() && p.userPhone.trim()).length + 1))} {t('splitpay_per_person')}
              </p>
            )}
          </div>

          {createError && (
            <p className="text-sm text-[var(--color-danger)]" aria-live="polite">{createError}</p>
          )}

          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={creating}
            onClick={handleCreate}
            disabled={creating || !title || !totalAmount ||
              participants.filter(p => p.userName.trim() && p.userPhone.trim()).length === 0}
          >
            {t('splitpay_create')}
          </Button>
        </div>
      </BottomSheet>

      {/* Detalle: quien debe que, y el pago de la propia parte. */}
      <BottomSheet
        isOpen={cargandoDetalle || detalle !== null || errorDetalle !== null}
        onClose={() => { setDetalle(null); setErrorDetalle(null); }}
        title={t('splitpay_detail')}
      >
        {cargandoDetalle ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : detalle ? (
          <div className="space-y-4 pb-2">
            <div>
              <h3 className="font-bold uv-text-primary">{detalle.group.title}</h3>
              <p className="text-2xl font-extrabold uv-text-primary mt-1">
                {formatMoney(detalle.group.totalAmount, detalle.group.currency as 'CRC' | 'USD')}
              </p>
            </div>

            <div className="space-y-2">
              {detalle.shares.map((cuota) => {
                const esMia = !!yoID && cuota.userId === yoID;
                return (
                  <div key={cuota.id}
                    className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${esMia
                      ? 'bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30'
                      : 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]'}`}>
                    <div className="min-w-0">
                      <p className="text-sm font-bold uv-text-primary truncate">
                        {esMia ? t('splitpay_your_share') : (cuota.userName || cuota.userPhone)}
                      </p>
                      <p className="text-[11px] text-gray-400">
                        {cuota.status === 'paid' ? t('splitpay_share_paid')
                          : cuota.status === 'declined' ? t('splitpay_share_declined')
                            : t('splitpay_share_pending')}
                      </p>
                    </div>
                    <span className="text-sm font-bold uv-text-primary flex-shrink-0 ml-3">
                      {formatMoney(cuota.amount, detalle.group.currency as 'CRC' | 'USD')}
                    </span>
                  </div>
                );
              })}
            </div>

            {errorDetalle && (
              <p className="text-sm text-[var(--color-danger)]" aria-live="polite">{errorDetalle}</p>
            )}

            {detalle.group.status === 'active' &&
              detalle.shares.some((c) => c.userId === yoID && c.status === 'pending') && (
                <Button variant="primary" size="lg" fullWidth loading={pagando} onClick={pagarMiParte}>
                  {t('splitpay_pay_share')}
                </Button>
              )}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-danger)] py-6" aria-live="polite">{errorDetalle}</p>
        )}
      </BottomSheet>
    </div>
  );
};
