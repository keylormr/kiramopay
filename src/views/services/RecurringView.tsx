import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Trash2 } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';
import { mensajeDeRechazo } from '@/i18n/mensajesDeError';
import { useRecurringStore } from '@/stores/recurring.store';
import { getApiLayer } from '@/api';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/ui/Button';
import { CampoMonto } from '@/components/CampoMonto';
import { formatMoney, type CurrencyCode } from '@/utils/money';
import { rellenar } from '@/utils/planes';
import { esFechaValida, fechaCorta, hoyLocal, siguienteFecha } from '@/utils/pagosFijos';
import type { RecurringPayment } from '@/types';

type Tipo = RecurringPayment['type'];
type Frecuencia = RecurringPayment['frequency'];

const TIPOS: { id: Tipo; clave: string }[] = [
  { id: 'service', clave: 'recurring_type_service' },
  { id: 'sinpe', clave: 'recurring_type_sinpe' },
  { id: 'recharge', clave: 'recurring_type_recharge' },
];

const FRECUENCIAS: { id: Frecuencia; clave: string }[] = [
  { id: 'weekly', clave: 'recurring_freq_weekly' },
  { id: 'biweekly', clave: 'recurring_freq_biweekly' },
  { id: 'monthly', clave: 'recurring_freq_monthly' },
];

const CLAVE_FRECUENCIA: Record<Frecuencia, string> = {
  weekly: 'recurring_freq_weekly',
  biweekly: 'recurring_freq_biweekly',
  monthly: 'recurring_freq_monthly',
};

const ICONO_TIPO: Record<Tipo, { Icono: React.FC<{ size?: number; className?: string }>; tono: string }> = {
  service: { Icono: Icons.Zap, tono: 'bg-[var(--color-warning-soft)] text-[var(--color-warning-strong)] dark:text-[var(--color-warning-strong-dark)]' },
  sinpe: { Icono: Icons.Smartphone, tono: 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]' },
  recharge: { Icono: Icons.Phone, tono: 'bg-[var(--color-success-soft)] text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]' },
};

// El largo de la columna (recurring_payments.label).
const LARGO_MAXIMO_NOMBRE = 200;

// Los rechazos que la pantalla sabe explicar (backend/internal/recurring).
const CLAVES_ERROR: Record<string, string> = {
  RECURRING_LABEL_REQUIRED: 'recurring_err_label_required',
  RECURRING_LABEL_TOO_LONG: 'recurring_err_label_too_long',
  RECURRING_INVALID_AMOUNT: 'recurring_err_amount',
  RECURRING_INVALID_DATE: 'recurring_err_date',
  RECURRING_NOT_FOUND: 'recurring_err_not_found',
};

const montoPositivo = (valor: string) => {
  const n = Number.parseFloat(valor);
  return Number.isFinite(n) && Math.round(n * 100) > 0;
};

const dinero = (monto: number, ccy: string) =>
  formatMoney(monto, ccy as CurrencyCode, { decimals: ccy === 'USD' ? 2 : undefined });

/**
 * Pagos fijos: la lista de pagos que se repiten, con su proxima fecha. Es un
 * recordatorio que la persona lleva a mano. KiramoPay no ejecuta ninguno:
 * "Ya lo pague" solo anota la fecha y la corre al siguiente periodo, y la
 * pantalla lo dice antes de confirmarlo. Lee y escribe en /api/v1/recurring.
 */
export const RecurringView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t, language } = useLanguage();
  const payments = useRecurringStore((s) => s.payments);
  const setPayments = useRecurringStore((s) => s.setPayments);
  const addPayment = useRecurringStore((s) => s.addPayment);
  const updatePayment = useRecurringStore((s) => s.updatePayment);
  const removePayment = useRecurringStore((s) => s.removePayment);

  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(false);
    try {
      const res = await getApiLayer().recurring.getPayments();
      if (!vivo.current) return;
      if (res.success && res.data) setPayments(res.data);
      else setErrorCarga(true);
    } catch {
      if (vivo.current) setErrorCarga(true);
    } finally {
      if (vivo.current) setCargando(false);
    }
  }, [setPayments]);

  useEffect(() => {
    vivo.current = true;
    void cargar();
    return () => {
      vivo.current = false;
    };
  }, [cargar]);

  const recargarEnSilencio = useCallback(async () => {
    const res = await getApiLayer().recurring.getPayments();
    if (vivo.current && res.success && res.data) setPayments(res.data);
  }, [setPayments]);

  const [verNuevo, setVerNuevo] = useState(false);
  const [aMarcar, setAMarcar] = useState<RecurringPayment | null>(null);
  const [aEliminar, setAEliminar] = useState<RecurringPayment | null>(null);
  // Pausar/reanudar se hace en la tarjeta: el error se muestra ahi mismo.
  const [pausando, setPausando] = useState<string | null>(null);
  const [errorTarjeta, setErrorTarjeta] = useState<{ id: string; texto: string } | null>(null);

  const hoy = hoyLocal();
  const ordenados = useMemo(() => [...payments].sort((a, b) => a.nextDate.localeCompare(b.nextDate)), [payments]);
  const activos = ordenados.filter((p) => p.enabled);
  const enPausa = ordenados.filter((p) => !p.enabled);

  const alternar = async (p: RecurringPayment) => {
    if (pausando) return;
    setPausando(p.id);
    setErrorTarjeta(null);
    try {
      const res = await getApiLayer().recurring.toggle(p.id);
      if (res.success && res.data) {
        updatePayment(p.id, { enabled: res.data.enabled });
        return;
      }
      if (res.error?.code === 'RECURRING_NOT_FOUND') void recargarEnSilencio();
      setErrorTarjeta({ id: p.id, texto: mensajeDeRechazo(res.error, CLAVES_ERROR, 'recurring_err_action', t) });
    } catch {
      setErrorTarjeta({ id: p.id, texto: t('recurring_err_action') });
    } finally {
      setPausando(null);
    }
  };

  const tarjeta = (p: RecurringPayment) => {
    const { Icono, tono } = ICONO_TIPO[p.type] ?? ICONO_TIPO.service;
    const vencido = p.enabled && p.nextDate < hoy;
    return (
      <li key={p.id} className={`rounded-2xl uv-surface-1 p-4 uv-shadow-soft ${p.enabled ? '' : 'opacity-75'}`}>
        <div className="flex items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${p.enabled ? tono : 'uv-surface-2 uv-text-muted'}`}>
            <Icono size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="truncate font-bold uv-text-primary">{p.label}</h3>
              <p className="shrink-0 font-bold tabular-nums uv-text-primary">{dinero(p.amount, p.ccy)}</p>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded-full uv-surface-2 px-2 py-0.5 text-[11px] font-bold uv-text-secondary">
                {t(CLAVE_FRECUENCIA[p.frequency] ?? 'recurring_freq_monthly')}
              </span>
              {p.enabled && (
                <span
                  className={`text-xs font-semibold ${
                    vencido ? 'text-[var(--color-danger)]' : 'uv-text-secondary'
                  }`}
                >
                  {rellenar(t(vencido ? 'recurring_overdue' : 'recurring_next'), { fecha: fechaCorta(p.nextDate, language) })}
                </span>
              )}
            </div>
            {(p.recipientName || p.clientId) && (
              <p className="mt-1 truncate text-xs uv-text-muted">
                {[p.recipientName, p.recipientPhone, p.clientId].filter(Boolean).join(' · ')}
              </p>
            )}
            {p.lastPaidDate && (
              <p className="mt-1 text-xs uv-text-muted">
                {rellenar(t('recurring_last_paid'), { fecha: fechaCorta(p.lastPaidDate, language) })}
              </p>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          {p.enabled && (
            <button
              type="button"
              onClick={() => setAMarcar(p)}
              className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--color-primary-soft)] text-sm font-bold text-[var(--color-primary)] uv-focus-ring active:scale-[0.98]"
            >
              <Icons.Check size={16} aria-hidden="true" />
              {t('recurring_mark_paid')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void alternar(p)}
            disabled={pausando !== null}
            aria-label={`${t(p.enabled ? 'recurring_pause' : 'recurring_resume')}: ${p.label}`}
            className={`flex h-11 items-center justify-center gap-1.5 rounded-xl uv-surface-2 text-sm font-semibold uv-text-secondary uv-focus-ring disabled:opacity-50 ${
              p.enabled ? 'w-11' : 'flex-1'
            }`}
          >
            {pausando === p.id ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
            ) : p.enabled ? (
              <Pause size={16} aria-hidden />
            ) : (
              <>
                <Play size={16} aria-hidden />
                <span>{t('recurring_resume')}</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setAEliminar(p)}
            aria-label={`${t('delete')}: ${p.label}`}
            className="flex h-11 w-11 items-center justify-center rounded-xl uv-surface-2 text-[var(--color-danger)] uv-focus-ring"
          >
            <Trash2 size={17} aria-hidden />
          </button>
        </div>
        {errorTarjeta?.id === p.id && (
          <p role="alert" className="mt-2 text-sm font-medium text-[var(--color-danger)]">
            {errorTarjeta.texto}
          </p>
        )}
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] animate-in slide-in-from-right duration-200">
      <div className="sticky top-0 z-10 flex h-14 flex-shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-white/80 px-4 backdrop-blur-md dark:border-[var(--color-border-dark)] dark:bg-surface-dark/80">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('back')}
          className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full uv-focus-ring hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]"
        >
          <Icons.ChevronLeft size={22} />
        </button>
        <h1 className="text-lg font-bold uv-text-primary">{t('recurring_title')}</h1>
        <button
          type="button"
          onClick={() => setVerNuevo(true)}
          disabled={cargando || errorCarga}
          aria-label={t('recurring_new')}
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-primary)] uv-focus-ring hover:bg-[var(--color-surface-muted)] disabled:opacity-40 dark:hover:bg-[var(--color-surface-muted-dark)]"
        >
          <Icons.Plus size={22} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-10 pt-4">
        {cargando ? (
          <div className="flex justify-center py-20" role="status" aria-label={t('loading')}>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
          </div>
        ) : errorCarga ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Icons.AlertCircle size={26} className="mb-3 text-[var(--color-danger)]" aria-hidden="true" />
            <p role="alert" className="font-semibold uv-text-primary">{t('recurring_err_load')}</p>
            <Button className="mt-4" onClick={() => void cargar()}>
              {t('error_retry')}
            </Button>
          </div>
        ) : payments.length === 0 ? (
          <div className="mx-auto flex max-w-sm flex-col items-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)]">
              <Icons.Calendar size={30} className="text-[var(--color-primary)]" />
            </div>
            <h2 className="text-lg font-bold uv-text-primary">{t('recurring_empty_title')}</h2>
            <p className="mt-1.5 text-sm leading-relaxed uv-text-secondary">{t('recurring_empty_desc')}</p>
            <p className="mt-3 text-xs leading-relaxed uv-text-muted">{t('recurring_manual_note')}</p>
            <Button className="mt-6" leftIcon={<Icons.Plus size={18} />} onClick={() => setVerNuevo(true)}>
              {t('recurring_new')}
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <p className="flex gap-2 rounded-2xl border border-[var(--color-border)] p-3 text-xs leading-relaxed uv-text-secondary dark:border-[var(--color-border-dark)]">
              <Icons.Info size={15} className="mt-px shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
              <span>{t('recurring_manual_note')}</span>
            </p>
            {activos.length > 0 && (
              <section aria-labelledby="pagos-activos">
                <h2 id="pagos-activos" className="mb-2.5 text-sm font-bold uv-text-secondary">
                  {t('recurring_section_active')} <span className="tabular-nums uv-text-muted">· {activos.length}</span>
                </h2>
                <ul className="space-y-3">{activos.map(tarjeta)}</ul>
              </section>
            )}
            {enPausa.length > 0 && (
              <section aria-labelledby="pagos-en-pausa">
                <h2 id="pagos-en-pausa" className="mb-2.5 text-sm font-bold uv-text-secondary">
                  {t('recurring_section_paused')} <span className="tabular-nums uv-text-muted">· {enPausa.length}</span>
                </h2>
                <ul className="space-y-3">{enPausa.map(tarjeta)}</ul>
              </section>
            )}
          </div>
        )}
      </div>

      <HojaNuevo
        abierta={verNuevo}
        onClose={() => setVerNuevo(false)}
        onCreado={(p) => {
          addPayment(p);
          setVerNuevo(false);
        }}
      />

      <HojaAccion
        abierta={aMarcar !== null}
        titulo={t('recurring_mark_paid_title')}
        encabezado={aMarcar ? `${aMarcar.label} · ${dinero(aMarcar.amount, aMarcar.ccy)}` : ''}
        texto={
          aMarcar
            ? rellenar(t('recurring_mark_paid_desc'), {
                fecha: fechaCorta(siguienteFecha(aMarcar.nextDate, aMarcar.frequency), language),
              })
            : ''
        }
        confirmar={t('recurring_mark_paid_confirm')}
        onClose={() => setAMarcar(null)}
        ejecutar={async () => {
          const p = aMarcar;
          if (!p) return null;
          const res = await getApiLayer().recurring.markPaid(p.id);
          if (!res.success || !res.data) {
            if (res.error?.code === 'RECURRING_NOT_FOUND') void recargarEnSilencio();
            return mensajeDeRechazo(res.error, CLAVES_ERROR, 'recurring_err_action', t);
          }
          // Las fechas nuevas son las que guardo el servidor.
          updatePayment(p.id, { nextDate: res.data.nextDate, lastPaidDate: res.data.lastPaidDate });
          setAMarcar(null);
          return null;
        }}
      />

      <HojaAccion
        abierta={aEliminar !== null}
        titulo={t('recurring_delete_title')}
        texto={aEliminar ? rellenar(t('recurring_delete_desc'), { name: aEliminar.label }) : ''}
        confirmar={t('delete')}
        peligro
        onClose={() => setAEliminar(null)}
        ejecutar={async () => {
          const p = aEliminar;
          if (!p) return null;
          const res = await getApiLayer().recurring.delete(p.id);
          if (res.success || res.error?.code === 'RECURRING_NOT_FOUND') {
            removePayment(p.id);
            setAEliminar(null);
            return null;
          }
          return mensajeDeRechazo(res.error, CLAVES_ERROR, 'recurring_err_action', t);
        }}
      />
    </div>
  );
};

// ── Nuevo pago fijo ──────────────────────────────────────────────────────────

interface HojaNuevoProps {
  abierta: boolean;
  onClose: () => void;
  onCreado: (p: RecurringPayment) => void;
}

const HojaNuevo: React.FC<HojaNuevoProps> = ({ abierta, onClose, onCreado }) => {
  const { t } = useLanguage();
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<Tipo>('service');
  const [monto, setMonto] = useState('');
  const [frecuencia, setFrecuencia] = useState<Frecuencia>('monthly');
  const [fecha, setFecha] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [estabaAbierta, setEstabaAbierta] = useState(abierta);
  if (abierta !== estabaAbierta) {
    setEstabaAbierta(abierta);
    if (abierta) {
      setNombre('');
      setTipo('service');
      setMonto('');
      setFrecuencia('monthly');
      setFecha('');
      setError(null);
    }
  }

  const nombreLimpio = nombre.trim();
  const montoOk = montoPositivo(monto);
  const fechaOk = esFechaValida(fecha);
  const puedeGuardar = !!nombreLimpio && montoOk && fechaOk && !guardando;
  const avisoMonto = monto !== '' && !montoOk;

  const guardar = async () => {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      const res = await getApiLayer().recurring.create({
        label: nombreLimpio,
        type: tipo,
        amount: Math.round(Number.parseFloat(monto) * 100) / 100,
        currency: 'CRC',
        frequency: frecuencia,
        next_date: fecha,
      });
      if (!res.success || !res.data) {
        setError(mensajeDeRechazo(res.error, CLAVES_ERROR, 'recurring_err_save', t));
        return;
      }
      onCreado(res.data);
    } catch {
      setError(t('recurring_err_save'));
    } finally {
      setGuardando(false);
    }
  };

  const segmento = (activo: boolean) =>
    `h-11 rounded-xl px-2 text-sm font-bold uv-focus-ring transition-colors ${
      activo
        ? 'bg-[var(--color-primary)] text-white'
        : 'bg-[var(--color-surface-muted)] uv-text-secondary dark:bg-[var(--color-surface-muted-dark)]'
    }`;

  return (
    <BottomSheet isOpen={abierta} onClose={onClose} dismissable={!guardando} title={t('recurring_new')}>
      <div className="space-y-5 pb-2">
        <div>
          <label htmlFor="pago-nombre" className="mb-1.5 block text-sm font-semibold uv-text-secondary">
            {t('recurring_field_name')}
          </label>
          <input
            id="pago-nombre"
            type="text"
            value={nombre}
            maxLength={LARGO_MAXIMO_NOMBRE}
            onChange={(e) => { setNombre(e.target.value); setError(null); }}
            placeholder={t('recurring_field_name_placeholder')}
            className="h-12 w-full rounded-xl border border-[var(--color-border)] px-4 text-base uv-surface-2 uv-text-primary outline-none focus:border-[var(--color-primary)] dark:border-[var(--color-border-dark)]"
          />
        </div>

        <fieldset>
          <legend className="mb-1.5 block text-sm font-semibold uv-text-secondary">{t('recurring_field_type')}</legend>
          <div className="grid grid-cols-3 gap-2">
            {TIPOS.map(({ id, clave }) => (
              <button key={id} type="button" onClick={() => setTipo(id)} aria-pressed={tipo === id} className={segmento(tipo === id)}>
                {t(clave)}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="pago-monto" className="mb-1.5 block text-sm font-semibold uv-text-secondary">
            {t('amount')}
          </label>
          <div
            className={`flex h-12 items-center gap-2 rounded-xl border px-4 uv-surface-2 ${
              avisoMonto ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
            }`}
          >
            <span className="text-lg font-bold uv-text-muted" aria-hidden="true">₡</span>
            <CampoMonto
              id="pago-monto"
              value={monto}
              onChange={(v) => { setMonto(v); setError(null); }}
              placeholder="0"
              aria-invalid={avisoMonto}
              aria-describedby={avisoMonto ? 'pago-monto-aviso' : undefined}
              className="min-w-0 flex-1 bg-transparent text-lg font-bold tabular-nums uv-text-primary outline-none"
            />
          </div>
          {avisoMonto && (
            <p id="pago-monto-aviso" className="mt-1.5 text-xs font-medium text-[var(--color-danger)]">
              {t('recurring_err_amount')}
            </p>
          )}
        </div>

        <fieldset>
          <legend className="mb-1.5 block text-sm font-semibold uv-text-secondary">{t('recurring_field_frequency')}</legend>
          <div className="grid grid-cols-3 gap-2">
            {FRECUENCIAS.map(({ id, clave }) => (
              <button key={id} type="button" onClick={() => setFrecuencia(id)} aria-pressed={frecuencia === id} className={segmento(frecuencia === id)}>
                {t(clave)}
              </button>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="pago-fecha" className="mb-1.5 block text-sm font-semibold uv-text-secondary">
            {t('recurring_field_next')}
          </label>
          <input
            id="pago-fecha"
            type="date"
            value={fecha}
            onChange={(e) => { setFecha(e.target.value); setError(null); }}
            className="h-12 w-full rounded-xl border border-[var(--color-border)] px-4 text-base uv-surface-2 uv-text-primary outline-none focus:border-[var(--color-primary)] dark:border-[var(--color-border-dark)]"
          />
        </div>

        {error && (
          <p role="alert" className="text-sm font-medium text-[var(--color-danger)]">
            {error}
          </p>
        )}

        <Button size="lg" fullWidth onClick={() => void guardar()} loading={guardando} disabled={!puedeGuardar}>
          {t('save')}
        </Button>
      </div>
    </BottomSheet>
  );
};

// ── Confirmar (ya lo pague, eliminar) ────────────────────────────────────────

interface HojaAccionProps {
  abierta: boolean;
  titulo: string;
  encabezado?: string;
  texto: string;
  confirmar: string;
  peligro?: boolean;
  onClose: () => void;
  /** Devuelve el mensaje de error, o null si salio bien. */
  ejecutar: () => Promise<string | null>;
}

const HojaAccion: React.FC<HojaAccionProps> = ({ abierta, titulo, encabezado, texto, confirmar, peligro, onClose, ejecutar }) => {
  const { t } = useLanguage();
  const [enCurso, setEnCurso] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [estabaAbierta, setEstabaAbierta] = useState(abierta);
  if (abierta !== estabaAbierta) {
    setEstabaAbierta(abierta);
    if (abierta) setError(null);
  }

  const aceptar = async () => {
    if (enCurso) return;
    setEnCurso(true);
    setError(null);
    try {
      setError(await ejecutar());
    } catch {
      setError(t('recurring_err_action'));
    } finally {
      setEnCurso(false);
    }
  };

  return (
    <BottomSheet isOpen={abierta} onClose={onClose} dismissable={!enCurso} title={titulo}>
      <div className="space-y-4 pb-2">
        {encabezado && <p className="font-bold uv-text-primary">{encabezado}</p>}
        <p className="text-[15px] leading-relaxed uv-text-secondary">{texto}</p>
        {error && (
          <p role="alert" className="text-sm font-medium text-[var(--color-danger)]">
            {error}
          </p>
        )}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" size="lg" fullWidth onClick={onClose} disabled={enCurso}>
            {t('cancel')}
          </Button>
          <Button variant={peligro ? 'danger' : 'primary'} size="lg" fullWidth onClick={() => void aceptar()} loading={enCurso}>
            {confirmar}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
};
