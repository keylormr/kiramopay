import React, { useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKeys } from '@/i18n/translations';
import { Icons } from '@/components/Icons';
import { getApiLayer } from '@/api';
import { formatMoney } from '@/utils/money';
import type { PaidPlanId } from '@/api/repositories/plans.repository';

type Clave = keyof TranslationKeys;
type PlanId = 'gratuito' | PaidPlanId;
type Periodo = 'mensual' | 'anual';

// ── La aritmetica de la escalera ────────────────────────────────────────────
// Los precios NO se traducen: van en dolares en todas las lenguas, y con la
// convencion de money.ts (miles con coma, decimales con punto).
const CUOTA = { negocio: 34.99, cima: 54.99 } as const;
const CUOTA_ANUAL = { negocio: 349.9, cima: 549.9 } as const;
const MESES_DEL_ANO = 12;

const TASA_GRATUITO = 0.005;
const TASA_NEGOCIO = 0.0025;
const TASA_CIMA = 0.001;
const SIN_COMISION_NEGOCIO = 12000;
const SIN_COMISION_CIMA = 50000;

// Etiquetas de porcentaje escritas a mano para que sigan la misma convencion
// decimal que los montos; no se traducen.
const PCT = { gratuito: '0.5%', negocio: '0.25%', cima: '0.1%' } as const;

const COBRADO_PREDETERMINADO = 7000;
const TOPE_DESLIZADOR = 60000;
const PASO_DESLIZADOR = 500;
const TOPE_MANUAL = 1000000;

const dolares = (v: number) => formatMoney(v, 'USD', { decimals: 2 });
const dolaresRedondos = (v: number) => formatMoney(v, 'USD', { decimals: 0 });

// Los totales se comparan redondeados al centavo: 34.99 + 0.0025 * 8000 no da
// exactamente 54.99 en coma flotante, y sin esto el empate de los 20 mil
// -el punto exacto donde Cima alcanza a Negocio- se decidiria por ruido.
const alCentavo = (v: number) => Math.round(v * 100) / 100;

function costoDelMes(plan: PlanId, cobrado: number): number {
  if (plan === 'gratuito') return alCentavo(cobrado * TASA_GRATUITO);
  if (plan === 'negocio') {
    return alCentavo(CUOTA.negocio + Math.max(0, cobrado - SIN_COMISION_NEGOCIO) * TASA_NEGOCIO);
  }
  return alCentavo(CUOTA.cima + Math.max(0, cobrado - SIN_COMISION_CIMA) * TASA_CIMA);
}

interface DefinicionPlan {
  id: PlanId;
  nombre: Clave;
  lema: Clave;
  hereda: Clave | null;
  resalte: Clave;
  resalteNota: Clave;
  beneficios: readonly Clave[];
  destacado: boolean;
}

const PLANES: readonly DefinicionPlan[] = [
  {
    id: 'gratuito',
    nombre: 'plans_free_name',
    lema: 'plans_free_tagline',
    hereda: null,
    resalte: 'plans_free_highlight',
    resalteNota: 'plans_free_highlight_note',
    beneficios: [
      'plans_free_f1', 'plans_free_f2', 'plans_free_f3', 'plans_free_f4',
      'plans_free_f5', 'plans_free_f6', 'plans_free_f7', 'plans_free_f8',
    ],
    destacado: false,
  },
  {
    id: 'negocio',
    nombre: 'plans_business_name',
    lema: 'plans_business_tagline',
    hereda: 'plans_business_includes',
    resalte: 'plans_business_highlight',
    resalteNota: 'plans_business_highlight_note',
    beneficios: [
      'plans_business_f1', 'plans_business_f2', 'plans_business_f3', 'plans_business_f4',
      'plans_business_f5', 'plans_business_f6', 'plans_business_f7', 'plans_business_f8',
    ],
    destacado: true,
  },
  {
    id: 'cima',
    nombre: 'plans_peak_name',
    lema: 'plans_peak_tagline',
    hereda: 'plans_peak_includes',
    resalte: 'plans_peak_highlight',
    resalteNota: 'plans_peak_highlight_note',
    beneficios: [
      'plans_peak_f1', 'plans_peak_f2', 'plans_peak_f3',
      'plans_peak_f4', 'plans_peak_f5', 'plans_peak_f6',
    ],
    destacado: false,
  },
];

const EXCLUSIONES: readonly Clave[] = [
  'plans_excluded_1', 'plans_excluded_2', 'plans_excluded_3',
  'plans_excluded_4', 'plans_excluded_5',
];

// El degradado de marca de CryptoView aclara demasiado en su extremo azul para
// sostener texto secundario blanco (queda bajo 4.5:1). Este baja el tono sin
// salirse de la paleta: navy-950 -> navy-800 -> primary-700.
const DEGRADADO_CALCULADORA = 'linear-gradient(135deg, #060E1F 0%, #12294F 55%, #1858CC 100%)';

interface PlansViewProps {
  onClose: () => void;
}

export const PlansView: React.FC<PlansViewProps> = ({ onClose }) => {
  const { t } = useLanguage();

  const [cobrado, setCobrado] = useState(COBRADO_PREDETERMINADO);
  const [periodo, setPeriodo] = useState<Periodo>('mensual');
  const [registrados, setRegistrados] = useState<Partial<Record<PaidPlanId, boolean>>>({});
  const [enviando, setEnviando] = useState<PaidPlanId | null>(null);
  const [errores, setErrores] = useState<Partial<Record<PaidPlanId, string>>>({});

  // Guarda sincronica contra el doble envio: el estado de React se aplica
  // despues del evento, asi que dos toques seguidos entrarian los dos antes de
  // que el boton llegue a deshabilitarse.
  const enviandoRef = useRef(false);

  const conDatos = (clave: Clave, datos: Record<string, string>) =>
    Object.entries(datos).reduce((texto, [k, v]) => texto.replace(`{${k}}`, v), t(clave));

  const escribirMonto = (valor: string) => {
    const digitos = valor.replace(/\D/g, '');
    setCobrado(digitos === '' ? 0 : Math.min(Number(digitos), TOPE_MANUAL));
  };

  const calculo = useMemo(() => {
    const filas = PLANES.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      costo: costoDelMes(p.id, cobrado),
    }));
    // Empate: gana el primero de la lista, es decir el plan mas barato de
    // contratar. En los 20 mil exactos Cima iguala a Negocio y el comercio no
    // tiene por que pagar la cuota mayor para quedar igual.
    const ganadora = filas.reduce((mejor, fila) => (fila.costo < mejor.costo ? fila : mejor), filas[0]);
    const techo = Math.max(...filas.map((f) => f.costo));
    return { filas, ganador: ganadora.id, costoGanador: ganadora.costo, techo };
  }, [cobrado]);

  const desglose = (plan: PlanId): string => {
    if (plan === 'gratuito') {
      return conDatos('plans_calc_breakdown_rate', {
        pct: PCT.gratuito,
        amount: dolaresRedondos(cobrado),
      });
    }
    const franquicia = plan === 'negocio' ? SIN_COMISION_NEGOCIO : SIN_COMISION_CIMA;
    const exceso = Math.max(0, cobrado - franquicia);
    if (exceso === 0) return t('plans_calc_breakdown_fee_only');
    return conDatos('plans_calc_breakdown_fee_plus', {
      fee: dolares(CUOTA[plan]),
      pct: PCT[plan],
      excess: dolaresRedondos(exceso),
    });
  };

  const veredicto = (): string => {
    const monto = dolaresRedondos(cobrado);
    if (calculo.ganador === 'gratuito') return conDatos('plans_calc_verdict_free', { amount: monto });
    return conDatos('plans_calc_verdict_paid', {
      amount: monto,
      plan: t(calculo.ganador === 'negocio' ? 'plans_business_name' : 'plans_peak_name'),
      total: dolares(calculo.costoGanador),
      free: dolares(costoDelMes('gratuito', cobrado)),
    });
  };

  const registrarInteres = async (plan: PaidPlanId) => {
    if (enviandoRef.current || registrados[plan]) return;
    enviandoRef.current = true;
    setEnviando(plan);
    setErrores((previos) => ({ ...previos, [plan]: undefined }));
    try {
      const res = await getApiLayer().plans?.registrarInteres(plan);
      if (res?.success) setRegistrados((previos) => ({ ...previos, [plan]: true }));
      else setErrores((previos) => ({ ...previos, [plan]: t('plans_cta_error') }));
    } catch {
      setErrores((previos) => ({ ...previos, [plan]: t('plans_cta_error') }));
    } finally {
      enviandoRef.current = false;
      setEnviando(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]"
          aria-label={t('back')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('plans_title')}</h1>
        <span className="w-9" />
      </div>

      <div className="flex-1 overflow-y-auto pb-12">
        <div className="mx-auto w-full max-w-3xl">

          {/* La tesis de la pagina, antes de cualquier precio. */}
          <section className="px-4 pt-6">
            <h2 className="text-2xl font-black leading-tight tracking-tight uv-text-primary">
              {t('plans_intro_title')}
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed uv-text-secondary">{t('plans_intro')}</p>
          </section>

          {/* ── La calculadora: una sola superficie, sin tarjetas anidadas ── */}
          <section className="px-4 pt-6">
            <div
              className="relative overflow-hidden rounded-3xl p-5 text-white uv-shadow-floating"
              style={{ backgroundImage: DEGRADADO_CALCULADORA }}
            >
              <div
                className="absolute -right-16 -top-20 w-56 h-56 rounded-full opacity-40 pointer-events-none"
                style={{ background: 'radial-gradient(closest-side, rgba(45,123,255,0.55), transparent)' }}
                aria-hidden="true"
              />

              <div className="relative">
                <h3 className="text-lg font-bold">{t('plans_calc_title')}</h3>

                <label
                  htmlFor="plans-cobrado"
                  className="mt-5 block text-xs font-semibold uppercase tracking-wider text-white/80"
                >
                  {t('plans_calc_label')}
                </label>
                <div className="mt-1.5 flex items-baseline gap-1 border-b border-white/25 pb-2 focus-within:border-white">
                  <span className="text-2xl font-bold text-white/80" aria-hidden="true">$</span>
                  <input
                    id="plans-cobrado"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={new Intl.NumberFormat('en-US').format(cobrado)}
                    onChange={(e) => escribirMonto(e.target.value)}
                    className="w-full bg-transparent text-4xl font-black tabular-nums text-white outline-none"
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={TOPE_DESLIZADOR}
                  step={PASO_DESLIZADOR}
                  value={Math.min(cobrado, TOPE_DESLIZADOR)}
                  onChange={(e) => setCobrado(Number(e.target.value))}
                  aria-label={t('plans_calc_label')}
                  className="mt-4 w-full accent-white cursor-pointer"
                />
                <div className="flex justify-between text-[11px] font-medium tabular-nums text-white/80">
                  <span>{dolaresRedondos(0)}</span>
                  <span>{dolaresRedondos(TOPE_DESLIZADOR)}</span>
                </div>

                {/* Los tres totales, a escala. La barra es el argumento: con 50
                    mil cobrados, la del gratuito mide cinco veces la de Cima. */}
                <ul className="mt-6 space-y-4">
                  {calculo.filas.map((fila) => {
                    const ganadora = fila.id === calculo.ganador;
                    const ancho = calculo.techo > 0 ? (fila.costo / calculo.techo) * 100 : 0;
                    return (
                      <li key={fila.id} aria-current={ganadora ? 'true' : undefined}>
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-bold text-white">
                            {t(fila.nombre)}
                            {ganadora && (
                              <span className="ml-2 align-middle rounded-full bg-white px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-[#0A152B]">
                                {t('plans_calc_best')}
                              </span>
                            )}
                          </p>
                          <p className="shrink-0 text-lg font-black tabular-nums text-white">
                            {dolares(fila.costo)}
                          </p>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/15">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ease-out ${ganadora ? 'bg-white' : 'bg-white/40'}`}
                            style={{ width: `${ancho}%` }}
                          />
                        </div>
                        <p className="mt-1.5 text-xs tabular-nums text-white/80">{desglose(fila.id)}</p>
                      </li>
                    );
                  })}
                </ul>

                {/* El veredicto se dice con todas las letras, tambien -sobre
                    todo- cuando lo que conviene es no pagar nada. */}
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-6 border-t border-white/20 pt-4 text-[15px] font-semibold leading-relaxed text-white"
                >
                  {veredicto()}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-white/80">{t('plans_calc_note')}</p>
              </div>
            </div>
          </section>

          {/* ── Los planes ─────────────────────────────────────────────────── */}
          <section className="px-4 pt-9">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-bold uv-text-primary">{t('plans_section_title')}</h3>
              <div className="flex flex-col items-start gap-1.5 sm:items-end">
                <div className="flex items-center rounded-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] p-1 border border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
                  {(['mensual', 'anual'] as const).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPeriodo(p)}
                      aria-pressed={periodo === p}
                      className={`rounded-full px-3.5 py-1.5 text-sm font-bold transition-colors ${
                        periodo === p
                          ? 'bg-[var(--color-primary)] text-white uv-shadow-soft'
                          : 'uv-text-secondary'
                      }`}
                    >
                      {t(p === 'mensual' ? 'plans_billing_monthly' : 'plans_billing_yearly')}
                    </button>
                  ))}
                </div>
                <p className="text-xs uv-text-muted">{t('plans_billing_hint')}</p>
              </div>
            </div>

            <div className="mt-6 grid gap-5 md:grid-cols-3">
              {PLANES.map((plan) => (
                <TarjetaPlan
                  key={plan.id}
                  plan={plan}
                  periodo={periodo}
                  conviene={calculo.ganador === plan.id}
                  registrado={plan.id !== 'gratuito' && registrados[plan.id] === true}
                  enviando={plan.id !== 'gratuito' && enviando === plan.id}
                  error={plan.id !== 'gratuito' ? errores[plan.id] : undefined}
                  onInteres={() => {
                    if (plan.id !== 'gratuito') void registrarInteres(plan.id);
                  }}
                />
              ))}
            </div>
          </section>

          {/* ── Lo que no incluye: mismo peso visual que los beneficios ────── */}
          <section className="px-4 pt-9">
            <h3 className="text-lg font-bold uv-text-primary">{t('plans_excluded_title')}</h3>
            <p className="mt-1.5 text-[15px] leading-relaxed uv-text-secondary">{t('plans_excluded_desc')}</p>
            <ul className="mt-4 uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
              {EXCLUSIONES.map((clave) => (
                <li key={clave} className="flex gap-3 px-4 py-3.5">
                  <Icons.XCircle size={18} className="mt-0.5 shrink-0 uv-text-secondary" aria-hidden="true" />
                  <span className="text-sm leading-relaxed uv-text-secondary">{t(clave)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};

interface TarjetaPlanProps {
  plan: DefinicionPlan;
  periodo: Periodo;
  conviene: boolean;
  registrado: boolean;
  enviando: boolean;
  error?: string;
  onInteres: () => void;
}

const TarjetaPlan: React.FC<TarjetaPlanProps> = ({
  plan,
  periodo,
  conviene,
  registrado,
  enviando,
  error,
  onInteres,
}) => {
  const { t } = useLanguage();
  const esDePago = plan.id !== 'gratuito';
  const cuotaMensual = esDePago ? CUOTA[plan.id as PaidPlanId] : 0;
  const cuotaAnual = esDePago ? CUOTA_ANUAL[plan.id as PaidPlanId] : 0;

  const conDatos = (clave: Clave, datos: Record<string, string>) =>
    Object.entries(datos).reduce((texto, [k, v]) => texto.replace(`{${k}}`, v), t(clave));

  const etiquetaBoton = registrado
    ? t('plans_cta_registered')
    : enviando
      ? t('plans_cta_sending')
      : t('plans_cta_interested');

  return (
    <article
      className={`relative flex flex-col rounded-3xl p-5 ${
        plan.destacado
          ? 'bg-[var(--color-surface-1)] dark:bg-[var(--color-surface-1-dark)] border-2 border-[var(--color-primary)] uv-shadow-floating md:-mt-2'
          : 'uv-surface-1 uv-shadow-soft'
      }`}
    >
      {(plan.destacado || conviene) && (
        <span
          className={`absolute -top-3 left-5 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide uv-shadow-soft ${
            conviene ? 'uv-chip-success' : 'bg-[var(--color-primary)] text-white'
          }`}
        >
          {t(conviene ? 'plans_calc_best' : 'plans_recommended')}
        </span>
      )}

      <h4 className={`text-xl font-black uv-text-primary ${plan.destacado || conviene ? 'mt-2' : ''}`}>
        {t(plan.nombre)}
      </h4>
      <p className="mt-1 text-sm leading-snug uv-text-muted">{t(plan.lema)}</p>

      <div className="mt-4">
        {esDePago ? (
          <>
            <p className="flex items-baseline gap-1.5">
              <span className="text-4xl font-black tabular-nums uv-text-primary">
                {dolares(periodo === 'mensual' ? cuotaMensual : cuotaAnual)}
              </span>
              <span className="text-sm font-semibold uv-text-muted">
                {t(periodo === 'mensual' ? 'plans_per_month' : 'plans_per_year')}
              </span>
            </p>
            <p className="mt-1.5 text-xs leading-relaxed uv-text-secondary">
              {periodo === 'mensual'
                ? conDatos('plans_or_yearly', { amount: dolares(cuotaAnual) })
                : conDatos('plans_yearly_equivalent', { amount: dolares(cuotaAnual / MESES_DEL_ANO) })}
            </p>
          </>
        ) : (
          <>
            <p className="text-4xl font-black uv-text-primary">{t('plans_free_price')}</p>
            <p className="mt-1.5 text-xs leading-relaxed uv-text-secondary">{t('plans_free_forever')}</p>
          </>
        )}
      </div>

      {/* El unico numero que decide cada plan, fuera de la lista de vinetas. */}
      <div className="mt-5 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] pt-4">
        <p className="text-base font-bold leading-snug uv-text-primary">{t(plan.resalte)}</p>
        <p className="mt-1 text-sm leading-relaxed uv-text-secondary">{t(plan.resalteNota)}</p>
      </div>

      {plan.hereda && <p className="mt-5 text-sm font-bold uv-text-primary">{t(plan.hereda)}</p>}
      <ul className={`${plan.hereda ? 'mt-2.5' : 'mt-5'} space-y-2.5`}>
        {plan.beneficios.map((clave) => (
          <li key={clave} className="flex gap-2.5">
            <Icons.Check size={17} className="mt-px shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
            <span className="text-sm leading-relaxed uv-text-secondary">{t(clave)}</span>
          </li>
        ))}
      </ul>

      {esDePago ? (
        <div className="mt-auto pt-6">
          <p className="text-xs leading-relaxed uv-text-muted">{t('plans_cta_note')}</p>
          <button
            onClick={onInteres}
            disabled={enviando || registrado}
            // El nombre del plan va en el aria-label y no en la etiqueta
            // visible: con dos botones iguales en pantalla, "Me interesa" a
            // secas no le dice a nadie cual de los dos esta enfocando.
            aria-label={`${etiquetaBoton} ${t(plan.nombre)}`}
            className={`mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl py-3 font-bold transition-colors disabled:cursor-default ${
              registrado
                ? 'uv-chip-success'
                : plan.destacado
                  ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white disabled:opacity-70'
                  : 'border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] disabled:opacity-70'
            }`}
          >
            {registrado && <Icons.Check size={17} aria-hidden="true" />}
            {etiquetaBoton}
          </button>
          {error && (
            <p role="alert" className="mt-2 text-xs font-semibold text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-auto pt-6">
          <p className="rounded-xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] px-3 py-2.5 text-sm font-semibold uv-text-secondary">
            {t('plans_current_plan')}
          </p>
        </div>
      )}
    </article>
  );
};
