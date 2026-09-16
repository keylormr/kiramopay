import React, { useState, useEffect } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/ui/Button';
import { CampoMonto } from '@/components/CampoMonto';
import { getApiLayer } from '@/api';
import { formatMoney } from '@/utils/money';
import type { SplitGroup, SplitShare } from '@/api/repositories/splitpay.repository';
import { useAuthStore } from '@/stores/auth.store';

type RespuestaConError = { error?: { code: string; message: string } };

// Los nueve rechazos de forma de "Crear division" (backend/internal/splitpay)
// traian el mismo codigo generico y el texto crudo de fmt.Errorf en ingles y
// en centimos: '"Yo mismo" is you: your own share is added automatically',
// '"Victor otra vez" appears twice in the split', 'the shares (40000) add up
// to more than the total (30000)' (hallazgo QA n=52). Ahora cada caso tiene su
// propio codigo estable; esta tabla lo traduce a una clave de i18n. Lo que NO
// esta aqui (SPLIT_EXCEEDS_TOTAL, que necesita los montos en colones que ya
// tiene el formulario) se resuelve aparte en handleCreate.
const CLAVES_ERROR_CREAR: Record<string, string> = {
  SPLIT_TITLE_REQUIRED: 'splitpay_err_title_required',
  SPLIT_INVALID_AMOUNT: 'splitpay_err_invalid_amount',
  SPLIT_PARTICIPANT_REQUIRED: 'splitpay_err_participant_required',
  SPLIT_PHONE_REQUIRED: 'splitpay_err_phone_required',
  SPLIT_INVALID_PHONE: 'splitpay_err_invalid_phone',
  SPLIT_ACCOUNT_NOT_FOUND: 'splitpay_err_account_not_found',
  SPLIT_SELF_INCLUDED: 'splitpay_err_self_included',
  SPLIT_DUPLICATE_PARTICIPANT: 'splitpay_err_duplicate_participant',
  SPLIT_TOTAL_TOO_SMALL: 'splitpay_err_total_too_small',
  SPLIT_CUSTOM_AMOUNT_REQUIRED: 'splitpay_err_custom_amount_required',
  SPLIT_PERCENTAGE_REQUIRED: 'splitpay_err_percentage_required',
  SPLIT_PERCENTAGE_EXCEEDS_TOTAL: 'splitpay_err_percentage_exceeds_total',
  SPLIT_PERCENTAGE_ROUNDS_TO_ZERO: 'splitpay_err_percentage_rounds_zero',
  SPLIT_INVALID_TYPE: 'splitpay_err_invalid_type',
};

// El resto de acciones del modulo (ver detalle, pagar, rechazar, cancelar)
// solo tienen UN codigo por fallo (nunca lo distinguen mas), y ese codigo
// viaja con el texto de diagnostico en ingles del backend (`err.Error()`).
// Para esos, siempre el texto fijo de la pantalla. Cualquier OTRO codigo
// (RATE_LIMITED, SESSION_EXPIRED, NETWORK_ERROR, INVALID_REQUEST...) ya llega
// traducido al idioma activo desde el cliente HTTP (src/i18n/mensajesDeError.ts)
// y se respeta tal cual, en vez de perder ese detalle contra un texto generico.
const CODIGOS_GENERICOS_DEL_MODULO = new Set(['NOT_FOUND', 'PAY_FAILED', 'DECLINE_FAILED', 'CANCEL_FAILED']);

function mensajeDeAccion(res: RespuestaConError, claveGenerica: string, t: (k: string) => string): string {
  const codigo = res.error?.code;
  if (!codigo || CODIGOS_GENERICOS_DEL_MODULO.has(codigo)) return t(claveGenerica);
  return res.error?.message || t(claveGenerica);
}

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
  // "Rechazar mi parte" y "Cancelar division" son irreversibles (la ayuda de
  // la pantalla los promete, pero hasta ahora no existian ningun boton para
  // hacerlos: hallazgo QA n=53). Piden confirmacion explicita antes de llamar
  // al servidor.
  const [confirmando, setConfirmando] = useState<'decline' | 'cancel' | null>(null);
  const [procesandoAccion, setProcesandoAccion] = useState(false);

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

    // Para el mensaje de "excede el total" (ver abajo) la pantalla ya tiene
    // los montos en colones: no hace falta parsear nada de lo que responda el
    // servidor, que ademas los manda en centimos (hallazgo QA n=52).
    const sumaPersonalizada = splitType === 'custom'
      ? validParticipants.reduce((acc, p) => acc + (parseFloat(p.amount) || 0), 0)
      : 0;

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
      const codigo = res.error?.code;
      if (codigo === 'SPLIT_EXCEEDS_TOTAL') {
        setCreateError(
          t('splitpay_err_exceeds_total')
            .replace('{suma}', formatMoney(sumaPersonalizada))
            .replace('{total}', formatMoney(amount)),
        );
      } else if (codigo && CLAVES_ERROR_CREAR[codigo]) {
        setCreateError(t(CLAVES_ERROR_CREAR[codigo]));
      } else {
        // Codigos que ya llegan traducidos (red, sesion vencida, limite de
        // tasa) o cualquier otro no mapeado: se respeta el mensaje del
        // servidor antes de caer al generico.
        setCreateError(res.error?.message || t('error'));
      }
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
      setErrorDetalle(mensajeDeAccion(res, 'splitpay_err_detail', t));
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
      setErrorDetalle(mensajeDeAccion(res, 'splitpay_err_pay', t));
      return;
    }
    await abrirDetalle(detalle.group.id);
    setLoadTrigger(n => n + 1);
  };

  // Rechazar la cuota propia y cancelar la division entera: el texto de ayuda
  // de la pantalla (help_splitpay_body) los promete desde siempre, pero hasta
  // ahora no existia ningun boton para hacerlos (hallazgo QA n=53). El backend
  // ya los soporta (POST /splits/:id/decline, DELETE /splits/:id).
  const rechazarMiParte = async () => {
    if (!detalle || procesandoAccion) return;
    const api = getApiLayer();
    if (!api.splitPay) return;
    setProcesandoAccion(true);
    setErrorDetalle(null);
    const res = await api.splitPay.declineShare(detalle.group.id);
    setProcesandoAccion(false);
    setConfirmando(null);
    if (!res.success) {
      setErrorDetalle(mensajeDeAccion(res, 'splitpay_err_decline', t));
      return;
    }
    await abrirDetalle(detalle.group.id);
    setLoadTrigger(n => n + 1);
  };

  const cancelarDivision = async () => {
    if (!detalle || procesandoAccion) return;
    const api = getApiLayer();
    if (!api.splitPay) return;
    setProcesandoAccion(true);
    setErrorDetalle(null);
    const res = await api.splitPay.cancelSplit(detalle.group.id);
    setProcesandoAccion(false);
    setConfirmando(null);
    if (!res.success) {
      setErrorDetalle(mensajeDeAccion(res, 'splitpay_err_cancel', t));
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
              <CampoMonto value={totalAmount} onChange={setTotalAmount} placeholder="0"
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
                    <CampoMonto value={p.amount}
                      onChange={(v) => updateParticipant(i, 'amount', v)}
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
        onClose={() => { setDetalle(null); setErrorDetalle(null); setConfirmando(null); }}
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

            {confirmando ? (
              // "Rechazar mi parte" y "Cancelar division" son irreversibles
              // (la segunda liquida la cuota de TODOS, no solo la propia): se
              // pide confirmacion explicita antes de llamar al servidor.
              <div className="space-y-3 rounded-xl bg-[var(--color-danger-soft)] p-3">
                <p className="text-sm text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]">
                  {confirmando === 'decline' ? t('splitpay_confirm_decline') : t('splitpay_confirm_cancel')}
                </p>
                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    size="md"
                    fullWidth
                    disabled={procesandoAccion}
                    onClick={() => setConfirmando(null)}
                  >
                    {t('back')}
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    fullWidth
                    loading={procesandoAccion}
                    onClick={confirmando === 'decline' ? rechazarMiParte : cancelarDivision}
                  >
                    {confirmando === 'decline' ? t('splitpay_decline_share') : t('splitpay_cancel_split')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {detalle.group.status === 'active' &&
                  detalle.shares.some((c) => c.userId === yoID && c.status === 'pending') && (
                    <>
                      <Button variant="primary" size="lg" fullWidth loading={pagando} onClick={pagarMiParte}>
                        {t('splitpay_pay_share')}
                      </Button>
                      <button
                        type="button"
                        onClick={() => setConfirmando('decline')}
                        className="w-full py-2.5 text-sm font-bold text-[var(--color-danger)] hover:opacity-80"
                      >
                        {t('splitpay_decline_share')}
                      </button>
                    </>
                  )}
                {detalle.group.status === 'active' && !!yoID && detalle.group.creatorId === yoID && (
                  <button
                    type="button"
                    onClick={() => setConfirmando('cancel')}
                    className="w-full py-2.5 text-sm font-bold text-[var(--color-danger)] hover:opacity-80"
                  >
                    {t('splitpay_cancel_split')}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-[var(--color-danger)] py-6" aria-live="polite">{errorDetalle}</p>
        )}
      </BottomSheet>
    </div>
  );
};
