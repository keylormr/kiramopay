import React, { useRef, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { getApiLayer } from '@/api';
import { formatMoney } from '@/utils/money';
import type { PlanDeInteres, PlanPersonal, Tarifas } from '@/api/repositories/plans.repository';
import { PLANES_PERSONALES, porcentajeDeBps, rellenar } from '@/utils/planes';
import { usePlanPersonal, useTarifas } from '@/hooks/usePlanes';

// ── Decision del dueno (2026-09-13) ─────────────────────────────────────────
// Personas: Gratis / Plus / Pro con tres beneficios que el servidor aplica de
// verdad (consultas al asistente, metas de ahorro activas, tarjetas activas).
// Comercios: 0.5% por cobro con QR, promocion de 0.25% los primeros 3 meses
// para comercios nuevos y Analitica opcional. Nada se puede cobrar todavia:
// cada precio va con "Proximamente" y un boton que solo anota el interes.
//
// Se retiraron Kiramo Negocio y Kiramo Cima con su calculadora: prometian
// umbrales sin comision, prueba de 30 dias y liquidacion prioritaria que no
// existen. Los numeros de esta pantalla salen de /transparency/fees.

const SECCION_PERSONAL = 'planes-para-ti';
const SECCION_COMERCIO = 'planes-para-tu-comercio';

const EXCLUSIONES = [
  'plans_excluded_1', 'plans_excluded_2', 'plans_excluded_3',
  'plans_excluded_4', 'plans_excluded_5', 'plans_excluded_6',
  'plans_excluded_7', 'plans_excluded_8', 'plans_excluded_9',
] as const;

const IGUAL_EN_TODOS = ['plans_same_1', 'plans_same_2', 'plans_same_3', 'plans_same_4'] as const;

const precioDe = (usd: number) => formatMoney(usd, 'USD', { decimals: usd === 0 ? 0 : 2 });

interface PlansViewProps {
  onClose: () => void;
}

export const PlansView: React.FC<PlansViewProps> = ({ onClose }) => {
  const { t } = useLanguage();
  const tarifas = useTarifas();
  const planActual = usePlanPersonal();

  const [registrados, setRegistrados] = useState<Partial<Record<PlanDeInteres, boolean>>>({});
  const [enviando, setEnviando] = useState<PlanDeInteres | null>(null);
  const [errores, setErrores] = useState<Partial<Record<PlanDeInteres, boolean>>>({});

  // Guarda sincronica contra el doble envio: el estado de React se aplica
  // despues del evento, asi que dos toques seguidos entrarian los dos antes de
  // que el boton llegue a deshabilitarse.
  const enviandoRef = useRef(false);

  const registrarInteres = async (plan: PlanDeInteres) => {
    if (enviandoRef.current || registrados[plan]) return;
    enviandoRef.current = true;
    setEnviando(plan);
    setErrores((previos) => ({ ...previos, [plan]: false }));
    try {
      const res = await getApiLayer().plans?.registrarInteres(plan);
      if (res?.success) setRegistrados((previos) => ({ ...previos, [plan]: true }));
      else setErrores((previos) => ({ ...previos, [plan]: true }));
    } catch {
      setErrores((previos) => ({ ...previos, [plan]: true }));
    } finally {
      enviandoRef.current = false;
      setEnviando(null);
    }
  };

  const irA = (id: string) => {
    const quieto = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(id)?.scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'start' });
  };

  const interes = (plan: PlanDeInteres, nombre: string) => ({
    registrado: registrados[plan] === true,
    enviando: enviando === plan,
    error: errores[plan] === true,
    nombre,
    onClick: () => void registrarInteres(plan),
  });

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] uv-focus-ring"
          aria-label={t('back')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('plans_title')}</h1>
        <span className="w-9" />
      </div>

      <div className="flex-1 overflow-y-auto pb-16">
        <div className="mx-auto w-full max-w-3xl">
          <section className="px-4 pt-6">
            <h2 className="text-2xl sm:text-3xl font-black leading-tight tracking-tight uv-text-primary text-balance">
              {t('plans_intro_title')}
            </h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed uv-text-secondary">{t('plans_intro')}</p>

            <nav aria-label={t('plans_jump_label')} className="mt-5 flex gap-2">
              {[
                { id: SECCION_PERSONAL, etiqueta: t('plans_personal_title'), Icono: Icons.User },
                { id: SECCION_COMERCIO, etiqueta: t('plans_business_title'), Icono: Icons.QrCode },
              ].map(({ id, etiqueta, Icono }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => irA(id)}
                  className="flex items-center gap-2 rounded-full border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-surface-1 px-4 h-10 text-sm font-bold uv-text-primary hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors uv-focus-ring"
                >
                  <Icono size={16} aria-hidden="true" className="text-[var(--color-primary)]" />
                  {etiqueta}
                </button>
              ))}
            </nav>
          </section>

          <PlanesPersonales
            tarifas={tarifas}
            planActual={planActual}
            interesPlus={interes('plus', t('plans_name_plus'))}
            interesPro={interes('pro', t('plans_name_pro'))}
          />

          <PlanesComercio tarifas={tarifas} interesAnalitica={interes('analitica', t('plans_analytics_name'))} />

          {/* ── Lo que no incluye: la misma letra y el mismo tamano que los
              beneficios. Una lista mas chica o mas gris seria esconderla. ── */}
          <section className="px-4 pt-12" aria-labelledby="planes-no-incluye">
            <h2 id="planes-no-incluye" className="text-xl font-black tracking-tight uv-text-primary">
              {t('plans_excluded_title')}
            </h2>
            <p className="mt-1.5 text-[15px] leading-relaxed uv-text-secondary">{t('plans_excluded_desc')}</p>
            <ul className="mt-4 uv-surface-1 rounded-3xl uv-shadow-soft p-2 grid sm:grid-cols-2">
              {EXCLUSIONES.map((clave) => (
                <li key={clave} className="flex items-start gap-3 px-3 py-3">
                  <Icons.XCircle size={18} className="mt-0.5 shrink-0 uv-text-secondary" aria-hidden="true" />
                  <span className="text-sm font-medium leading-relaxed uv-text-primary">{t(clave)}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};

// ── Para ti ─────────────────────────────────────────────────────────────────

interface EstadoInteres {
  registrado: boolean;
  enviando: boolean;
  error: boolean;
  nombre: string;
  onClick: () => void;
}

interface PlanesPersonalesProps {
  tarifas: Tarifas;
  planActual: PlanPersonal;
  interesPlus: EstadoInteres;
  interesPro: EstadoInteres;
}

const PlanesPersonales: React.FC<PlanesPersonalesProps> = ({ tarifas, planActual, interesPlus, interesPro }) => {
  const { t } = useLanguage();

  // El asistente solo se publica si el servidor lo tiene configurado. Ofrecer
  // consultas que no existen seria prometer un beneficio que no se entrega.
  const hayAsistente = PLANES_PERSONALES.some((p) => tarifas.planes[p].topes.asistente !== undefined);
  const filas: { etiqueta: string; valor: (p: PlanPersonal) => number | null | undefined }[] = [
    ...(hayAsistente ? [{ etiqueta: t('plans_row_assistant'), valor: (p: PlanPersonal) => tarifas.planes[p].topes.asistente }] : []),
    { etiqueta: t('plans_row_goals'), valor: (p: PlanPersonal) => tarifas.planes[p].topes.metas },
    { etiqueta: t('plans_row_cards'), valor: (p: PlanPersonal) => tarifas.planes[p].topes.tarjetas },
  ];

  const celdaActual = (p: PlanPersonal) =>
    p === planActual ? 'bg-[var(--color-primary-soft)]' : '';

  const interesDe: Partial<Record<PlanPersonal, EstadoInteres>> = { plus: interesPlus, pro: interesPro };
  // Solo los planes por encima del actual: a quien ya esta en Pro no se le
  // ofrece anotarse para Plus, y a quien esta en Plus solo se le ofrece Pro.
  const ofrecibles = (['plus', 'pro'] as const).filter(
    (p) => PLANES_PERSONALES.indexOf(p) > PLANES_PERSONALES.indexOf(planActual),
  );

  return (
    <section id={SECCION_PERSONAL} className="px-4 pt-12 scroll-mt-4" aria-labelledby="planes-personales-titulo">
      <h2 id="planes-personales-titulo" className="text-xl font-black tracking-tight uv-text-primary">
        {t('plans_personal_title')}
      </h2>
      <p className="mt-1.5 text-[15px] leading-relaxed uv-text-secondary">{t('plans_personal_desc')}</p>

      <div className="mt-5 uv-surface-1 rounded-3xl uv-shadow-soft overflow-hidden">
        {/* En el telefono cada fila pone su titulo arriba, a todo lo ancho, y los
            tres valores debajo: con el titulo como cuarta columna, a 390 px
            cada plan quedaba en ~80 px y "Proximamente" se cortaba. Los roles
            explicitos conservan la tabla para los lectores de pantalla aunque
            las filas se dibujen como grilla. */}
        <table role="table" className="w-full table-fixed border-collapse max-sm:block">
          <caption className="sr-only">{t('plans_personal_title')}</caption>
          <colgroup>
            <col className="sm:w-[40%]" />
            <col />
            <col />
            <col />
          </colgroup>
          <thead role="rowgroup" className="max-sm:block">
            <tr role="row" className="align-top max-sm:grid max-sm:grid-cols-3">
              <td role="cell" className="p-4 max-sm:sr-only" />
              {PLANES_PERSONALES.map((p) => (
                <th key={p} role="columnheader" scope="col" className={`px-2 py-4 sm:px-3 text-center font-normal ${celdaActual(p)}`}>
                  <span className="block text-sm sm:text-base font-black uv-text-primary">{t(`plans_name_${p}`)}</span>
                  <span className="mt-1 block text-xl sm:text-2xl font-black tabular-nums tracking-tight uv-text-primary">
                    {precioDe(tarifas.planes[p].precio)}
                  </span>
                  <span className="block text-[11px] uv-text-muted">{t('plans_per_month')}</span>
                  <span className="mt-2 flex justify-center min-h-[22px]">
                    {p === planActual ? (
                      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-[11px] font-bold text-white">
                        <Icons.Check size={12} aria-hidden="true" />
                        {t('plans_badge_current')}
                      </span>
                    ) : p !== 'free' ? (
                      <span className="whitespace-nowrap rounded-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] px-2 py-0.5 text-[11px] font-bold uv-text-secondary">
                        {t('plans_badge_soon')}
                      </span>
                    ) : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup" className="max-sm:block">
            {filas.map((fila) => (
              <tr
                key={fila.etiqueta}
                role="row"
                className="border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] max-sm:grid max-sm:grid-cols-3"
              >
                <th
                  role="rowheader"
                  scope="row"
                  className="p-4 text-left text-sm font-semibold leading-snug uv-text-primary max-sm:col-span-3 max-sm:pb-1"
                >
                  {fila.etiqueta}
                </th>
                {PLANES_PERSONALES.map((p) => {
                  const v = fila.valor(p);
                  return (
                    <td key={p} role="cell" className={`px-2 py-3 sm:px-3 text-center ${celdaActual(p)}`}>
                      {v === null || v === undefined ? (
                        <span className="text-[13px] sm:text-sm font-bold uv-text-primary">{t('plans_unlimited')}</span>
                      ) : (
                        <span className="text-2xl font-black tabular-nums uv-text-primary">{v}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        <div className="border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 py-3.5 space-y-2">
          {[t('plans_row_cards_note'), t('plans_keep_note')].map((nota) => (
            <p key={nota} className="flex gap-2 text-xs leading-relaxed uv-text-secondary">
              <Icons.Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{nota}</span>
            </p>
          ))}
        </div>

        <div className="border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 py-4">
          <h3 className="text-sm font-bold uv-text-primary">{t('plans_same_title')}</h3>
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {IGUAL_EN_TODOS.map((clave) => (
              <li key={clave} className="flex items-start gap-3">
                <Icons.Check size={18} className="mt-0.5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
                <span className="text-sm font-medium leading-relaxed uv-text-primary">{t(clave)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {ofrecibles.length > 0 && (
        <div className="mt-4">
          <p className="text-xs leading-relaxed uv-text-muted">{t('plans_cta_note')}</p>
          <div className={`mt-2.5 grid gap-3 ${ofrecibles.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {ofrecibles.map((p) => (
              <BotonInteres
                key={p}
                estado={interesDe[p]!}
                encabezado={`${t(`plans_name_${p}`)} · ${precioDe(tarifas.planes[p].precio)} ${t('plans_per_month')}`}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
};

// ── Para tu comercio ────────────────────────────────────────────────────────

const PlanesComercio: React.FC<{ tarifas: Tarifas; interesAnalitica: EstadoInteres }> = ({ tarifas, interesAnalitica }) => {
  const { t } = useLanguage();
  const std = porcentajeDeBps(tarifas.comisionBps);

  return (
    <section id={SECCION_COMERCIO} className="px-4 pt-12 scroll-mt-4" aria-labelledby="planes-comercio-titulo">
      <h2 id="planes-comercio-titulo" className="text-xl font-black tracking-tight uv-text-primary">
        {t('plans_business_title')}
      </h2>
      <p className="mt-1.5 text-[15px] leading-relaxed uv-text-secondary">{t('plans_business_desc')}</p>

      <div className="mt-5 uv-surface-1 rounded-3xl uv-shadow-soft overflow-hidden">
        <div className="p-5">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-5xl font-black tabular-nums tracking-tight uv-text-primary">{std}</span>
            <span className="text-base font-bold uv-text-primary">{t('plans_business_rate')}</span>
          </p>
          <p className="mt-2 text-sm leading-relaxed uv-text-secondary">{t('plans_business_rate_note')}</p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full uv-chip-success px-3 py-1 text-xs font-bold">
            <Icons.QrCode size={14} aria-hidden="true" />
            {t('plans_business_p2p')}
          </p>

          {tarifas.promo && (
            <div className="mt-5 rounded-2xl bg-[var(--color-success-soft)] p-4">
              <p className="text-base font-black leading-snug text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]">
                {rellenar(t('plans_promo_title'), { pct: porcentajeDeBps(tarifas.promo.bps), meses: tarifas.promo.meses })}
              </p>
              <p className="mt-1.5 text-sm leading-relaxed uv-text-primary">
                {rellenar(t('plans_promo_desc'), { std })}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed uv-text-secondary">{t('plans_promo_existing')}</p>
            </div>
          )}
        </div>

        {tarifas.analitica && (
          <div className="border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Icons.TrendingUp size={20} className="text-[var(--color-primary)]" aria-hidden="true" />
              <h3 className="text-lg font-black uv-text-primary">{t('plans_analytics_name')}</h3>
              <span className="rounded-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] px-2 py-0.5 text-[11px] font-bold uv-text-secondary">
                {t('plans_analytics_tag')}
              </span>
              <span className="rounded-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] px-2 py-0.5 text-[11px] font-bold uv-text-secondary">
                {t('plans_badge_soon')}
              </span>
            </div>
            <p className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-black tabular-nums tracking-tight uv-text-primary">{precioDe(tarifas.analitica.precio)}</span>
              <span className="text-sm font-semibold uv-text-muted">{t('plans_per_month')}</span>
            </p>
            <p className="mt-1 text-sm leading-relaxed uv-text-secondary">{t('plans_analytics_desc')}</p>
            <ul className="mt-3 space-y-2.5">
              {(['plans_analytics_f1', 'plans_analytics_f2'] as const).map((clave) => (
                <li key={clave} className="flex items-start gap-3">
                  <Icons.Check size={18} className="mt-0.5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
                  <span className="text-sm font-medium leading-relaxed uv-text-primary">{t(clave)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed uv-text-muted">{t('plans_cta_note')}</p>
            <div className="mt-2.5">
              <BotonInteres estado={interesAnalitica} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

// ── El boton que solo anota el interes ──────────────────────────────────────

const BotonInteres: React.FC<{ estado: EstadoInteres; encabezado?: string }> = ({ estado, encabezado }) => {
  const { t } = useLanguage();
  const etiqueta = estado.registrado
    ? t('plans_cta_registered')
    : estado.enviando
      ? t('plans_cta_sending')
      : t('plans_cta_interested');

  return (
    <div className={encabezado ? 'uv-surface-1 rounded-2xl uv-shadow-soft p-4' : ''}>
      {encabezado && <p className="mb-2.5 text-sm font-black tabular-nums uv-text-primary">{encabezado}</p>}
      <button
        type="button"
        onClick={estado.onClick}
        disabled={estado.enviando || estado.registrado}
        // Con dos o tres botones iguales en pantalla, el nombre del plan va en
        // el nombre accesible: "Avisarme" a secas no dice cual se enfoca.
        aria-label={`${etiqueta} ${estado.nombre}`}
        className={`flex w-full items-center justify-center gap-2 rounded-xl min-h-12 px-4 py-3 text-sm font-bold transition-colors uv-focus-ring disabled:cursor-default ${
          estado.registrado
            ? 'uv-chip-success'
            : 'border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] disabled:opacity-70'
        }`}
      >
        {estado.registrado ? <Icons.Check size={17} aria-hidden="true" /> : <Icons.Bell size={16} aria-hidden="true" />}
        {etiqueta}
      </button>
      {estado.error && (
        <p role="alert" className="mt-2 text-xs font-semibold text-[var(--color-danger)]">
          {t('plans_cta_error')}
        </p>
      )}
    </div>
  );
};
