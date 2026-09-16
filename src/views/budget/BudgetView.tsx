import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  UtensilsCrossed,
  Car,
  Gamepad2,
  Zap,
  ShoppingCart,
  Heart,
  Home,
  Wifi,
  Film,
  Gift,
  Plane,
  GraduationCap,
  Dumbbell,
  Stethoscope,
  PiggyBank,
  Music,
  Trash2,
} from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';
import { mensajeDeRechazo } from '@/i18n/mensajesDeError';
import { useAccountStore } from '@/stores/account.store';
import { getApiLayer } from '@/api';
import { Icons } from '@/components/Icons';
import { BottomSheet } from '@/components/BottomSheet';
import { Button } from '@/components/ui/Button';
import { CampoMonto } from '@/components/CampoMonto';
import { formatMoney, type CurrencyCode } from '@/utils/money';
import { rellenar } from '@/utils/planes';
import type { Budget } from '@/types';

type IconoLucide = React.FC<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;

// Todos los iconos que puede traer un presupuesto guardado (versiones viejas
// ofrecian 16). El selector ofrece ocho, con nombre, en una grilla que cabe en
// un telefono.
const ICONOS: Record<string, IconoLucide> = {
  utensils: UtensilsCrossed,
  car: Car,
  'gamepad-2': Gamepad2,
  zap: Zap,
  'shopping-cart': ShoppingCart,
  heart: Heart,
  home: Home,
  wifi: Wifi,
  film: Film,
  gift: Gift,
  plane: Plane,
  'graduation-cap': GraduationCap,
  dumbbell: Dumbbell,
  stethoscope: Stethoscope,
  'piggy-bank': PiggyBank,
  music: Music,
};

const ICONOS_OFRECIDOS: { id: string; clave: string }[] = [
  { id: 'utensils', clave: 'budget_icon_food' },
  { id: 'car', clave: 'budget_icon_transport' },
  { id: 'home', clave: 'budget_icon_home' },
  { id: 'zap', clave: 'budget_icon_utilities' },
  { id: 'shopping-cart', clave: 'budget_icon_shopping' },
  { id: 'heart', clave: 'budget_icon_health' },
  { id: 'gamepad-2', clave: 'budget_icon_fun' },
  { id: 'graduation-cap', clave: 'budget_icon_education' },
];

const COLORES = ['#f97316', '#3b82f6', '#a855f7', '#eab308', '#ef4444', '#22c55e', '#ec4899', '#14b8a6'];

// El largo de la columna (budgets.label).
const LARGO_MAXIMO_NOMBRE = 100;

// Los rechazos que la pantalla sabe explicar (backend/internal/budget).
const CLAVES_ERROR: Record<string, string> = {
  BUDGET_LABEL_REQUIRED: 'budget_err_label_required',
  BUDGET_LABEL_TOO_LONG: 'budget_err_label_too_long',
  BUDGET_INVALID_LIMIT: 'budget_err_amount',
  BUDGET_INVALID_SPENT: 'budget_err_amount',
  BUDGET_NOT_FOUND: 'budget_err_not_found',
};

const iconoDe = (nombre?: string): IconoLucide => (nombre && ICONOS[nombre]) || (Icons.Receipt as unknown as IconoLucide);

const decimalesDe = (ccy: string) => (ccy === 'USD' ? 2 : 0);

// Mayor a cero una vez en centimos, que es lo que viaja al servidor.
const montoPositivo = (valor: string) => {
  const n = Number.parseFloat(valor);
  return Number.isFinite(n) && Math.round(n * 100) > 0;
};

const redondear = (n: number) => Math.round(n * 100) / 100;

type Estado = 'bien' | 'cerca' | 'pasado';

function estadoDe(gastado: number, tope: number): Estado {
  if (tope > 0 && gastado > tope) return 'pasado';
  if (tope > 0 && gastado / tope >= 0.8) return 'cerca';
  return 'bien';
}

const COLOR_BARRA: Record<Estado, string> = {
  bien: 'bg-[var(--color-success)]',
  cerca: 'bg-[var(--color-warning)]',
  pasado: 'bg-[var(--color-danger)]',
};

interface BudgetViewProps {
  onClose: () => void;
}

type Formulario = { modo: 'nuevo' } | { modo: 'editar'; presupuesto: Budget };

/**
 * Presupuestos que la persona lleva a mano: pone el tope y anota lo que gasta.
 * Lee y escribe en el servidor (/api/v1/budgets). Nada de lo que muestra sale
 * de los movimientos de la cuenta, y la pantalla lo dice.
 */
export const BudgetView: React.FC<BudgetViewProps> = ({ onClose }) => {
  const { t } = useLanguage();
  const budgets = useAccountStore((s) => s.budgets);
  const setBudgets = useAccountStore((s) => s.setBudgets);
  const addBudget = useAccountStore((s) => s.addBudget);
  const updateBudget = useAccountStore((s) => s.updateBudget);
  const removeBudget = useAccountStore((s) => s.removeBudget);

  // Una consulta que falla no es "no tienes presupuestos".
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(false);
  const vivo = useRef(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setErrorCarga(false);
    try {
      const res = await getApiLayer().budgets.getBudgets();
      if (!vivo.current) return;
      if (res.success && res.data) setBudgets(res.data);
      else setErrorCarga(true);
    } catch {
      if (vivo.current) setErrorCarga(true);
    } finally {
      if (vivo.current) setCargando(false);
    }
  }, [setBudgets]);

  useEffect(() => {
    vivo.current = true;
    void cargar();
    return () => {
      vivo.current = false;
    };
  }, [cargar]);

  // Un "ya no existe" se corrige releyendo la lista, sin tapar el aviso.
  const recargarEnSilencio = useCallback(async () => {
    const res = await getApiLayer().budgets.getBudgets();
    if (vivo.current && res.success && res.data) setBudgets(res.data);
  }, [setBudgets]);

  const [formulario, setFormulario] = useState<Formulario | null>(null);
  const [aAnotar, setAAnotar] = useState<Budget | null>(null);
  const [aEliminar, setAEliminar] = useState<Budget | null>(null);
  const [verReinicio, setVerReinicio] = useState(false);

  // Totales por moneda: sumar colones con dolares no da ningun numero real.
  const totales = useMemo(() => {
    const porMoneda = new Map<string, { gastado: number; tope: number }>();
    for (const b of budgets) {
      const actual = porMoneda.get(b.ccy) ?? { gastado: 0, tope: 0 };
      porMoneda.set(b.ccy, { gastado: actual.gastado + b.spent, tope: actual.tope + b.limit });
    }
    return [...porMoneda.entries()].sort(([a], [b]) => (a === 'CRC' ? -1 : b === 'CRC' ? 1 : a.localeCompare(b)));
  }, [budgets]);

  const hayAnotado = budgets.some((b) => b.spent > 0);
  // Colones sin centimos de relleno (hasta 2 si los hay); dolares siempre con 2.
  const dinero = (monto: number, ccy: string) =>
    formatMoney(monto, ccy as CurrencyCode, { decimals: ccy === 'USD' ? 2 : undefined });

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
        <h1 className="text-lg font-bold uv-text-primary">{t('budget_title')}</h1>
        <button
          type="button"
          onClick={() => setFormulario({ modo: 'nuevo' })}
          disabled={cargando || errorCarga}
          aria-label={t('budget_new')}
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
            <p role="alert" className="font-semibold uv-text-primary">{t('budget_err_load')}</p>
            <Button className="mt-4" onClick={() => void cargar()}>
              {t('error_retry')}
            </Button>
          </div>
        ) : budgets.length === 0 ? (
          <div className="mx-auto flex max-w-sm flex-col items-center py-16 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-primary-soft)]">
              <PiggyBank size={30} className="text-[var(--color-primary)]" aria-hidden />
            </div>
            <h2 className="text-lg font-bold uv-text-primary">{t('budget_empty_title')}</h2>
            <p className="mt-1.5 text-sm leading-relaxed uv-text-secondary">{t('budget_empty_desc')}</p>
            <p className="mt-3 text-xs leading-relaxed uv-text-muted">{t('budget_manual_note')}</p>
            <Button className="mt-6" leftIcon={<Icons.Plus size={18} />} onClick={() => setFormulario({ modo: 'nuevo' })}>
              {t('budget_new')}
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="rounded-2xl uv-surface-1 p-5 uv-shadow-soft" aria-label={t('budget_summary_label')}>
              <p className="text-xs font-semibold uv-text-muted">{t('budget_summary_label')}</p>
              <div className="mt-1 space-y-4">
                {totales.map(([ccy, { gastado, tope }]) => {
                  const estado = estadoDe(gastado, tope);
                  const pct = tope > 0 ? Math.round((gastado / tope) * 100) : 0;
                  return (
                    <div key={ccy}>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-3xl font-black tabular-nums tracking-tight uv-text-primary">{dinero(gastado, ccy)}</p>
                        <p
                          className={`text-sm font-bold tabular-nums ${
                            estado === 'pasado' ? 'text-[var(--color-danger)]' : 'uv-text-secondary'
                          }`}
                        >
                          {pct}%
                        </p>
                      </div>
                      <p className="mt-0.5 text-sm uv-text-secondary">
                        {rellenar(t('budget_summary_of'), { monto: dinero(tope, ccy) })}
                      </p>
                      <Barra gastado={gastado} tope={tope} alto="h-2.5" />
                    </div>
                  );
                })}
              </div>
            </section>

            <p className="flex gap-2 text-xs leading-relaxed uv-text-secondary">
              <Icons.Info size={15} className="mt-px shrink-0 uv-text-muted" aria-hidden="true" />
              <span>{t('budget_manual_note')}</span>
            </p>

            <ul className="space-y-3">
              {budgets.map((b) => {
                const Icono = iconoDe(b.icon);
                const estado = estadoDe(b.spent, b.limit);
                const diferencia = Math.abs(b.limit - b.spent);
                return (
                  <li key={b.id} className="rounded-2xl uv-surface-1 p-4 uv-shadow-soft">
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                        style={{ backgroundColor: `${b.color || '#64748b'}1f`, color: b.color || '#64748b' }}
                      >
                        <Icono size={20} aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate font-bold uv-text-primary">{b.label}</h3>
                        <p className="mt-0.5 text-sm tabular-nums uv-text-secondary">
                          {rellenar(t('budget_spent_of'), { gastado: dinero(b.spent, b.ccy), tope: dinero(b.limit, b.ccy) })}
                        </p>
                      </div>
                    </div>
                    <Barra gastado={b.spent} tope={b.limit} alto="h-2" />
                    <p
                      className={`mt-2 text-sm font-semibold ${
                        estado === 'pasado'
                          ? 'text-[var(--color-danger)]'
                          : estado === 'cerca'
                            ? 'text-[var(--color-warning-strong)] dark:text-[var(--color-warning-strong-dark)]'
                            : 'text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]'
                      }`}
                    >
                      {rellenar(t(estado === 'pasado' ? 'budget_over' : 'budget_left'), { monto: dinero(diferencia, b.ccy) })}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setAAnotar(b)}
                        className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--color-primary-soft)] text-sm font-bold text-[var(--color-primary)] uv-focus-ring active:scale-[0.98]"
                      >
                        <Icons.Plus size={16} aria-hidden="true" />
                        {t('budget_add_expense')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormulario({ modo: 'editar', presupuesto: b })}
                        aria-label={`${t('edit')}: ${b.label}`}
                        className="flex h-11 w-11 items-center justify-center rounded-xl uv-surface-2 uv-text-secondary uv-focus-ring"
                      >
                        <Icons.Edit size={17} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setAEliminar(b)}
                        aria-label={`${t('delete')}: ${b.label}`}
                        className="flex h-11 w-11 items-center justify-center rounded-xl uv-surface-2 text-[var(--color-danger)] uv-focus-ring"
                      >
                        <Trash2 size={17} aria-hidden />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            {hayAnotado && (
              <button
                type="button"
                onClick={() => setVerReinicio(true)}
                className="mx-auto flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold uv-text-secondary uv-focus-ring hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]"
              >
                <Icons.RefreshCw size={15} aria-hidden="true" />
                {t('budget_reset')}
              </button>
            )}
          </div>
        )}
      </div>

      <HojaFormulario
        formulario={formulario}
        onClose={() => setFormulario(null)}
        onCreado={(b) => {
          addBudget(b);
          setFormulario(null);
        }}
        onEditado={(id, cambios) => {
          updateBudget(id, cambios);
          setFormulario(null);
        }}
        onNoExiste={() => void recargarEnSilencio()}
      />

      <HojaAnotar
        presupuesto={aAnotar}
        onClose={() => setAAnotar(null)}
        onAnotado={(id, gastado) => {
          updateBudget(id, { spent: gastado });
          setAAnotar(null);
        }}
        onNoExiste={() => void recargarEnSilencio()}
        dinero={dinero}
      />

      <HojaConfirmar
        abierta={aEliminar !== null}
        titulo={t('budget_delete_title')}
        texto={aEliminar ? rellenar(t('budget_delete_desc'), { name: aEliminar.label }) : ''}
        confirmar={t('delete')}
        claveError="budget_err_delete"
        peligro
        onClose={() => setAEliminar(null)}
        ejecutar={async () => {
          const b = aEliminar;
          if (!b) return null;
          const res = await getApiLayer().budgets.delete(b.id);
          if (res.success || res.error?.code === 'BUDGET_NOT_FOUND') {
            // Si ya no existia, el resultado que la persona pidio es el mismo.
            removeBudget(b.id);
            setAEliminar(null);
            return null;
          }
          return mensajeDeRechazo(res.error, CLAVES_ERROR, 'budget_err_delete', t);
        }}
      />

      <HojaConfirmar
        abierta={verReinicio}
        titulo={t('budget_reset')}
        texto={t('budget_reset_desc')}
        confirmar={t('budget_reset_btn')}
        claveError="budget_err_reset"
        onClose={() => setVerReinicio(false)}
        ejecutar={async () => {
          const res = await getApiLayer().budgets.resetAll();
          if (!res.success) return mensajeDeRechazo(res.error, CLAVES_ERROR, 'budget_err_reset', t);
          setBudgets(useAccountStore.getState().budgets.map((b) => ({ ...b, spent: 0 })));
          setVerReinicio(false);
          return null;
        }}
      />
    </div>
  );
};

const Barra: React.FC<{ gastado: number; tope: number; alto: string }> = ({ gastado, tope, alto }) => {
  const estado = estadoDe(gastado, tope);
  const ancho = tope > 0 ? Math.min(100, (gastado / tope) * 100) : 0;
  return (
    <div className={`mt-3 w-full overflow-hidden rounded-full bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] ${alto}`} aria-hidden="true">
      <div className={`h-full rounded-full transition-[width] duration-500 ease-out ${COLOR_BARRA[estado]}`} style={{ width: `${ancho}%` }} />
    </div>
  );
};

// ── Crear o editar ───────────────────────────────────────────────────────────

interface HojaFormularioProps {
  formulario: Formulario | null;
  onClose: () => void;
  onCreado: (b: Budget) => void;
  onEditado: (id: string, cambios: Partial<Budget>) => void;
  onNoExiste: () => void;
}

const HojaFormulario: React.FC<HojaFormularioProps> = ({ formulario, onClose, onCreado, onEditado, onNoExiste }) => {
  const { t } = useLanguage();
  const [nombre, setNombre] = useState('');
  const [tope, setTope] = useState('');
  const [gastado, setGastado] = useState('');
  const [moneda, setMoneda] = useState('CRC');
  const [icono, setIcono] = useState('utensils');
  const [color, setColor] = useState(COLORES[0]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Al abrir, el formulario arranca con lo que corresponde. Se ajusta durante
  // el render (patron de React para "estado que depende de una prop").
  const [abiertoCon, setAbiertoCon] = useState<Formulario | null>(null);
  if (formulario !== abiertoCon) {
    setAbiertoCon(formulario);
    if (formulario) {
      const b = formulario.modo === 'editar' ? formulario.presupuesto : null;
      setNombre(b?.label ?? '');
      setTope(b ? String(b.limit) : '');
      setGastado(b ? String(b.spent) : '');
      setMoneda(b?.ccy ?? 'CRC');
      setIcono(b?.icon || 'utensils');
      setColor(b?.color || COLORES[0]);
      setError(null);
    }
  }

  const editando = formulario?.modo === 'editar' ? formulario.presupuesto : null;
  const nombreLimpio = nombre.trim();
  const topeOk = montoPositivo(tope);
  const gastadoOk = !editando || gastado === '' || Number.isFinite(Number.parseFloat(gastado));
  const puedeGuardar = !!nombreLimpio && topeOk && gastadoOk && !guardando;

  const guardar = async () => {
    if (!formulario || !puedeGuardar) return;
    setGuardando(true);
    setError(null);
    try {
      const api = getApiLayer().budgets;
      const limite = redondear(Number.parseFloat(tope));
      if (editando) {
        const gastadoNuevo = gastado === '' ? 0 : redondear(Number.parseFloat(gastado));
        const cambios = { label: nombreLimpio, amount_limit: limite, amount_spent: gastadoNuevo, icon: icono, color };
        const res = await api.update(editando.id, cambios);
        if (!res.success) {
          if (res.error?.code === 'BUDGET_NOT_FOUND') onNoExiste();
          setError(mensajeDeRechazo(res.error, CLAVES_ERROR, 'budget_err_save', t));
          return;
        }
        onEditado(editando.id, { label: nombreLimpio, limit: limite, spent: gastadoNuevo, icon: icono, color });
      } else {
        const res = await api.create({ label: nombreLimpio, amount_limit: limite, currency: moneda, icon: icono, color, period: 'monthly' });
        if (!res.success || !res.data) {
          setError(mensajeDeRechazo(res.error, CLAVES_ERROR, 'budget_err_save', t));
          return;
        }
        onCreado(res.data);
      }
    } catch {
      setError(t('budget_err_save'));
    } finally {
      setGuardando(false);
    }
  };

  const avisoTope = tope !== '' && !topeOk;

  return (
    <BottomSheet
      isOpen={formulario !== null}
      onClose={onClose}
      dismissable={!guardando}
      title={editando ? t('budget_edit') : t('budget_new')}
    >
      <div className="space-y-5 pb-2">
        <div>
          <label htmlFor="presupuesto-nombre" className="mb-1.5 block text-sm font-semibold uv-text-secondary">
            {t('category')}
          </label>
          <input
            id="presupuesto-nombre"
            type="text"
            value={nombre}
            maxLength={LARGO_MAXIMO_NOMBRE}
            onChange={(e) => { setNombre(e.target.value); setError(null); }}
            placeholder={t('budget_field_name_placeholder')}
            className="h-12 w-full rounded-xl border border-[var(--color-border)] px-4 text-base uv-surface-2 uv-text-primary outline-none focus:border-[var(--color-primary)] dark:border-[var(--color-border-dark)]"
          />
        </div>

        {!editando && (
          <fieldset>
            <legend className="mb-1.5 block text-sm font-semibold uv-text-secondary">{t('currency')}</legend>
            <div className="grid grid-cols-2 gap-2">
              {['CRC', 'USD'].map((ccy) => (
                <button
                  key={ccy}
                  type="button"
                  onClick={() => { setMoneda(ccy); setTope(''); }}
                  aria-pressed={moneda === ccy}
                  className={`h-11 rounded-xl text-sm font-bold uv-focus-ring transition-colors ${
                    moneda === ccy
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'bg-[var(--color-surface-muted)] uv-text-secondary dark:bg-[var(--color-surface-muted-dark)]'
                  }`}
                >
                  {ccy === 'CRC' ? '₡ CRC' : '$ USD'}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className={editando ? 'grid grid-cols-2 gap-3' : ''}>
          <div className="min-w-0">
            <label htmlFor="presupuesto-tope" className="mb-1.5 block text-sm font-semibold uv-text-secondary">
              {t('budget_field_limit')}
            </label>
            <CampoMonto
              id="presupuesto-tope"
              value={tope}
              decimals={decimalesDe(moneda)}
              onChange={(v) => { setTope(v); setError(null); }}
              placeholder="0"
              aria-invalid={avisoTope}
              aria-describedby={avisoTope ? 'presupuesto-tope-aviso' : undefined}
              className={`h-12 w-full rounded-xl border px-4 text-base font-bold tabular-nums uv-surface-2 uv-text-primary outline-none focus:border-[var(--color-primary)] ${
                avisoTope ? 'border-[var(--color-danger)]' : 'border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
              }`}
            />
          </div>
          {editando && (
            <div className="min-w-0">
              <label htmlFor="presupuesto-gastado" className="mb-1.5 block text-sm font-semibold uv-text-secondary">
                {t('budget_summary_label')}
              </label>
              <CampoMonto
                id="presupuesto-gastado"
                value={gastado}
                decimals={decimalesDe(moneda)}
                onChange={(v) => { setGastado(v); setError(null); }}
                placeholder="0"
                className="h-12 w-full rounded-xl border border-[var(--color-border)] px-4 text-base font-bold tabular-nums uv-surface-2 uv-text-primary outline-none focus:border-[var(--color-primary)] dark:border-[var(--color-border-dark)]"
              />
            </div>
          )}
        </div>
        {avisoTope && (
          <p id="presupuesto-tope-aviso" className="-mt-3 text-xs font-medium text-[var(--color-danger)]">
            {t('budget_err_amount')}
          </p>
        )}

        <fieldset>
          <legend className="mb-2 block text-sm font-semibold uv-text-secondary">{t('icon')}</legend>
          <div className="grid grid-cols-4 gap-2">
            {ICONOS_OFRECIDOS.map(({ id, clave }) => {
              const Icono = ICONOS[id];
              const elegido = icono === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setIcono(id)}
                  aria-pressed={elegido}
                  className={`flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-xl border-2 px-1 py-2 uv-focus-ring transition-colors ${
                    elegido ? 'border-[var(--color-primary)] bg-[var(--color-primary-soft)]' : 'border-transparent uv-surface-2'
                  }`}
                >
                  <Icono size={20} className={elegido ? 'text-[var(--color-primary)]' : 'uv-text-secondary'} aria-hidden />
                  <span className="w-full truncate text-center text-[11px] font-medium uv-text-secondary">{t(clave)}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 block text-sm font-semibold uv-text-secondary">{t('color')}</legend>
          {/* Ocho en una fila en cualquier telefono; el relleno deja ver el anillo. */}
          <div className="grid grid-cols-8 gap-1.5 p-1">
            {COLORES.map((c, i) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-pressed={color === c}
                aria-label={`${t('color')} ${i + 1}`}
                className={`flex aspect-square w-full max-w-10 items-center justify-center justify-self-center rounded-full uv-focus-ring transition-transform ${
                  color === c ? 'ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--color-surface-1)] dark:ring-offset-[var(--color-surface-1-dark)]' : ''
                }`}
                style={{ backgroundColor: c }}
              >
                {color === c && <Icons.Check size={16} className="text-white" />}
              </button>
            ))}
          </div>
        </fieldset>

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

// ── Anotar un gasto ──────────────────────────────────────────────────────────

interface HojaAnotarProps {
  presupuesto: Budget | null;
  onClose: () => void;
  onAnotado: (id: string, gastado: number) => void;
  onNoExiste: () => void;
  dinero: (monto: number, ccy: string) => string;
}

const HojaAnotar: React.FC<HojaAnotarProps> = ({ presupuesto, onClose, onAnotado, onNoExiste, dinero }) => {
  const { t } = useLanguage();
  const [monto, setMonto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [abiertaCon, setAbiertaCon] = useState<Budget | null>(null);
  if (presupuesto !== abiertaCon) {
    setAbiertaCon(presupuesto);
    setMonto('');
    setError(null);
  }

  const valido = montoPositivo(monto);

  const anotar = async () => {
    if (!presupuesto || !valido || guardando) return;
    setGuardando(true);
    setError(null);
    // El servidor guarda el total (PATCH amount_spent). Se parte del valor que
    // la pantalla acaba de leer del servidor al abrir.
    const nuevoTotal = redondear(presupuesto.spent + Number.parseFloat(monto));
    try {
      const res = await getApiLayer().budgets.update(presupuesto.id, { amount_spent: nuevoTotal });
      if (!res.success) {
        if (res.error?.code === 'BUDGET_NOT_FOUND') onNoExiste();
        setError(mensajeDeRechazo(res.error, CLAVES_ERROR, 'budget_err_save', t));
        return;
      }
      onAnotado(presupuesto.id, nuevoTotal);
    } catch {
      setError(t('budget_err_save'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <BottomSheet isOpen={presupuesto !== null} onClose={onClose} dismissable={!guardando} title={t('budget_add_expense')}>
      {presupuesto && (
        <div className="space-y-5 pb-2">
          <div className="text-center">
            <p className="font-bold uv-text-primary">{presupuesto.label}</p>
            <p className="mt-0.5 text-sm tabular-nums uv-text-secondary">
              {rellenar(t('budget_spent_of'), {
                gastado: dinero(presupuesto.spent, presupuesto.ccy),
                tope: dinero(presupuesto.limit, presupuesto.ccy),
              })}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2">
            <span className="text-3xl font-bold uv-text-muted" aria-hidden="true">
              {presupuesto.ccy === 'USD' ? '$' : '₡'}
            </span>
            <CampoMonto
              value={monto}
              decimals={decimalesDe(presupuesto.ccy)}
              onChange={(v) => { setMonto(v); setError(null); }}
              placeholder="0"
              aria-label={t('amount')}
              autoWidth
              autoFocus
              className="bg-transparent text-center text-4xl font-black tabular-nums uv-text-primary outline-none placeholder:text-[var(--color-text-muted)]"
            />
          </div>
          <p className="text-center text-sm leading-relaxed uv-text-secondary">
            {rellenar(t('budget_add_expense_hint'), { name: presupuesto.label })}
          </p>
          {error && (
            <p role="alert" className="text-center text-sm font-medium text-[var(--color-danger)]">
              {error}
            </p>
          )}
          <Button size="lg" fullWidth onClick={() => void anotar()} loading={guardando} disabled={!valido || guardando}>
            {t('budget_add_expense_btn')}
          </Button>
        </div>
      )}
    </BottomSheet>
  );
};

// ── Confirmar (eliminar, empezar de cero) ────────────────────────────────────

interface HojaConfirmarProps {
  abierta: boolean;
  titulo: string;
  texto: string;
  confirmar: string;
  /** El generico si algo falla sin respuesta del servidor. */
  claveError: string;
  peligro?: boolean;
  onClose: () => void;
  /** Devuelve el mensaje de error, o null si salio bien. */
  ejecutar: () => Promise<string | null>;
}

const HojaConfirmar: React.FC<HojaConfirmarProps> = ({ abierta, titulo, texto, confirmar, claveError, peligro, onClose, ejecutar }) => {
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
      setError(t(claveError));
    } finally {
      setEnCurso(false);
    }
  };

  return (
    <BottomSheet isOpen={abierta} onClose={onClose} dismissable={!enCurso} title={titulo}>
      <div className="space-y-5 pb-2">
        <p className="text-[15px] leading-relaxed uv-text-secondary">{texto}</p>
        {error && (
          <p role="alert" className="text-sm font-medium text-[var(--color-danger)]">
            {error}
          </p>
        )}
        <div className="flex gap-3">
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
