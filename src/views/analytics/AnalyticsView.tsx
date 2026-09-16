import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/hooks/useApp';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { getApiLayer } from '@/api';
import type { TransactionSummary } from '@/api/repositories/transaction.repository';
import type { Transaction } from '@/types';
import { COLOR, colorDeCategoria } from '@/components/graficos/tokens';
import { GraficoFlujo } from '@/components/graficos/GraficoFlujo';
import { GraficoDonaCategorias } from '@/components/graficos/GraficoDonaCategorias';
import { GraficoComparacion } from '@/components/graficos/GraficoComparacion';
import { txTitle } from '@/utils/txTitle';
import { resumirMovimientos } from '@/utils/resumenMovimientos';
import {
  etiquetaDeTramo,
  etiquetaLargaDeTramo,
  fechaParaFormato,
  hoyCR,
  localeDe,
  nombreDeRango,
  periodoAnterior,
  rangoPreset,
  mismosRangos,
  type Rango,
} from '@/utils/periodos';
import { analizar, totalesEn, variacion } from './calculosAnalitica';
import { SelectorPeriodo } from './SelectorPeriodo';

/**
 * Analisis de gastos.
 *
 * Las cifras salen del RESUMEN del periodo que calcula el servidor sobre todos
 * los movimientos completados del rango (GET /transactions/summary). Antes esta
 * pantalla descargaba la ventana fila por fila con un techo de mil: con rangos
 * largos ese techo se alcanza y un total pasa a describir solo una parte.
 *
 * Si el servidor no responde, se resume lo que el telefono tiene guardado (los
 * movimientos recientes) y la pantalla lo dice: nunca se presenta un total
 * calculado sobre datos incompletos como si fuera el del periodo.
 */

// Texto de montos con contraste suficiente sobre la tarjeta (los tonos base de
// estado no llegan a 4.5:1 como texto).
const TEXTO_INGRESO = 'text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]';
const TEXTO_GASTO = 'text-[var(--color-danger-strong)] dark:text-[var(--color-danger-strong-dark)]';

const TARJETA = 'uv-surface-1 rounded-3xl p-5 sm:p-6 shadow-[var(--shadow-soft)] min-w-0';
const RELLENO = 'bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]';

/** Cuantos principales se muestran: la lista completa pesa mas de lo que dice. */
const PRINCIPALES_VISIBLES = { all: 8, in: 6, out: 6 } as const;

/** Tras este tiempo sin respuesta, la espera se explica con texto. */
const ESPERA_LARGA_MS = 2500;

type Direccion = 'all' | 'in' | 'out';

interface Carga {
  clave: string;
  rango: Rango;
  resumen: TransactionSummary | null;
  /** El servidor no respondio: se resume lo guardado en el telefono. */
  fallo: boolean;
}

/** El periodo anterior viaja aparte y puede no llegar: cada estado se dice. */
type Anterior =
  | { clave: string; estado: 'cargando' }
  | { clave: string; estado: 'fallo' }
  | { clave: string; estado: 'listo'; rango: Rango; resumen: TransactionSummary };

const claveDe = (r: Rango) => `${r.desde}|${r.hasta}`;

/** Si la pantalla cumple la consulta de medios (y se actualiza al cambiar). */
function useConsultaMedios(consulta: string): boolean {
  const [cumple, setCumple] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(consulta).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(consulta);
    const cambiar = () => setCumple(mq.matches);
    mq.addEventListener?.('change', cambiar);
    return () => mq.removeEventListener?.('change', cambiar);
  }, [consulta]);
  return cumple;
}

export const AnalyticsView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { state } = useApp();
  const { t, language } = useLanguage();
  const locale = localeDe(language);

  const [hoy] = useState(() => hoyCR());
  const [rango, setRango] = useState<Rango>(() => rangoPreset('este_mes', hoyCR()));
  const [intento, setIntento] = useState(0);
  const [carga, setCarga] = useState<Carga | null>(null);
  const [pidiendo, setPidiendo] = useState<string | null>(claveDe(rango));
  const [anterior, setAnterior] = useState<Anterior | null>(null);
  const [direccion, setDireccion] = useState<Direccion>('all');
  // null: la regla de siempre (moneda base, o la que tenga datos).
  const [monedaElegida, setMonedaElegida] = useState<string | null>(null);
  // En escritorio el flujo comparte fila con el balance: se estira a su alto.
  const escritorio = useConsultaMedios('(min-width: 1024px)');

  const clave = claveDe(rango);

  useEffect(() => {
    let cancelado = false;
    const pedido = { desde: rango.desde, hasta: rango.hasta };
    const k = `${pedido.desde}|${pedido.hasta}`;
    const api = getApiLayer();

    (async () => {
      setPidiendo(k);
      try {
        const res = await api.transactions.getSummary({ from: pedido.desde, to: pedido.hasta });
        if (cancelado) return;
        if (!res.success || !res.data) throw new Error('summary');
        setCarga({ clave: k, rango: pedido, resumen: res.data, fallo: false });
      } catch {
        if (!cancelado) setCarga({ clave: k, rango: pedido, resumen: null, fallo: true });
      } finally {
        if (!cancelado) setPidiendo((p) => (p === k ? null : p));
      }
    })();

    // El periodo anterior viaja en paralelo y nunca bloquea la vista.
    (async () => {
      const prev = periodoAnterior(pedido, hoy);
      if (!prev) {
        if (!cancelado) setAnterior({ clave: k, estado: 'fallo' });
        return;
      }
      setAnterior({ clave: k, estado: 'cargando' });
      try {
        const res = await api.transactions.getSummary({ from: prev.desde, to: prev.hasta });
        if (cancelado) return;
        setAnterior(
          res.success && res.data
            ? { clave: k, estado: 'listo', rango: prev, resumen: res.data }
            : { clave: k, estado: 'fallo' },
        );
      } catch {
        if (!cancelado) setAnterior({ clave: k, estado: 'fallo' });
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [rango.desde, rango.hasta, hoy, intento]);

  // Lo que se muestra: la ultima carga, aunque sea del periodo anterior mientras
  // llega el nuevo (se atenua, sin saltos ni esqueletos al cambiar de periodo).
  const resumen = useMemo(() => {
    if (!carga) return null;
    return carga.fallo ? resumirMovimientos(state.transactions, carga.rango) : carga.resumen;
  }, [carga, state.transactions]);

  const analisis = useMemo(
    () => (carga && resumen ? analizar(resumen, carga.rango, hoy, state.baseCurrency || 'CRC', monedaElegida) : null),
    [carga, resumen, hoy, state.baseCurrency, monedaElegida],
  );

  const cargando = pidiendo === clave;
  const desactualizada = !!carga && carga.clave !== clave;
  const rangoMostrado = carga?.rango ?? rango;
  const falloActual = !!carga?.fallo && carga.clave === clave;

  const plural = useMemo(() => {
    try {
      return new Intl.PluralRules(locale);
    } catch {
      return new Intl.PluralRules('es');
    }
  }, [locale]);
  // Los miles van con coma en toda la app (utils/money.ts), tambien en conteos.
  const contar = (n: number, llave: string) =>
    t(plural.select(n) === 'one' ? `${llave}_one` : llave).replace('{n}', n.toLocaleString('en-US'));

  const formatoMonto = (monto: number) => {
    const ccy = analisis?.moneda ?? 'CRC';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currencyDisplay: 'narrowSymbol', currency: ccy }).format(monto);
    } catch {
      return `${monto.toFixed(2)} ${ccy}`;
    }
  };
  const formatoCompacto = (monto: number) => {
    const ccy = analisis?.moneda ?? 'CRC';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currencyDisplay: 'narrowSymbol',
        currency: ccy,
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(monto);
    } catch {
      return `${Math.round(monto)}`;
    }
  };

  const nombreCategoria = (cat: string) => t(`analytics_cat_${cat}`);
  const nombreDia = (dia: number) => {
    // 4 de enero de 2026 fue domingo: sumar el dia da su nombre en el idioma.
    const s = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 4 + dia)));
    return s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
  };
  const fechaLarga = (f: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(fechaParaFormato(f));
    } catch {
      return f;
    }
  };
  const nombreMoneda = (ccy: string) =>
    ccy === 'CRC' ? t('analytics_currency_crc') : ccy === 'USD' ? t('analytics_currency_usd') : ccy;

  // Sin servidor y sin nada guardado del periodo: no es un periodo vacio, es
  // un periodo que no se pudo leer.
  const sinDatos = falloActual && !!analisis?.vacio;

  // El periodo anterior se compara solo si llego para ESTA carga y la carga no
  // salio de lo guardado en el telefono (mezclaria dos fuentes). Y si empieza
  // antes del primer movimiento de la persona esta incompleto: compararlo
  // inventaria un porcentaje enorme que no significa nada.
  const anteriorListo = !carga?.fallo && anterior?.clave === carga?.clave && anterior?.estado === 'listo' ? anterior : null;
  const primeraFecha = anteriorListo?.resumen.firstDate ?? null;
  const anteriorIncompleto = !!anteriorListo && primeraFecha !== null && primeraFecha > anteriorListo.rango.desde;

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button
          onClick={onClose}
          className="p-2 -ml-2 rounded-full hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] transition-colors uv-focus-ring"
          aria-label={t('back')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('analytics_title')}</h1>
        <div className="w-8" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-4 pt-4 pb-10 sm:px-6 lg:px-8">
          <SelectorPeriodo rango={rango} hoy={hoy} onCambiar={setRango} />

          {falloActual && !sinDatos && (
            <AvisoFallo texto={t('analytics_offline')} reintentar={t('error_retry')} onReintentar={() => setIntento((n) => n + 1)} />
          )}

          {analisis && (analisis.monedas.length > 1 || analisis.otrasMonedas > 0) && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {analisis.monedas.length > 1 && (
                <div
                  className={`flex p-1 rounded-full ${RELLENO}`}
                  role="group"
                  aria-label={t('analytics_currency_label')}
                >
                  {analisis.monedas.map((ccy) => (
                    <button
                      key={ccy}
                      type="button"
                      aria-pressed={analisis.moneda === ccy}
                      onClick={() => setMonedaElegida(ccy)}
                      className={`h-9 px-4 rounded-full text-sm font-bold transition-colors uv-focus-ring ${
                        analisis.moneda === ccy
                          ? 'uv-surface-1 uv-text-primary shadow-[var(--shadow-soft)]'
                          : 'border border-transparent uv-text-muted'
                      }`}
                    >
                      {nombreMoneda(ccy)}
                    </button>
                  ))}
                </div>
              )}
              {analisis.otrasMonedas > 0 && (
                <p className="flex items-center gap-1.5 text-xs uv-text-muted">
                  <Icons.Info size={14} aria-hidden="true" />
                  {t('other_currency_note').replace('{n}', String(analisis.otrasMonedas))}
                </p>
              )}
            </div>
          )}

          {!analisis ? (
            <Esqueleto aviso={t('analytics_loading_slow')} />
          ) : sinDatos ? (
            <section className={`${TARJETA} mt-4 flex flex-col items-center text-center py-10`} role="alert">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center uv-chip-warning mb-4">
                <Icons.AlertTriangle size={26} aria-hidden="true" />
              </div>
              <h2 className="text-base font-bold uv-text-primary">{t('analytics_load_failed')}</h2>
              <button
                type="button"
                onClick={() => setIntento((n) => n + 1)}
                className="mt-5 h-11 px-5 rounded-full bg-[var(--color-primary)] text-white text-sm font-bold uv-focus-ring"
              >
                {t('error_retry')}
              </button>
            </section>
          ) : analisis.vacio ? (
            <section
              className={`${TARJETA} mt-4 flex flex-col items-center text-center py-10 transition-opacity duration-200 ${desactualizada ? 'opacity-50' : ''}`}
              aria-busy={cargando}
            >
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-[var(--color-primary-soft)] text-[var(--color-primary)] mb-4">
                <Icons.Calendar size={26} aria-hidden="true" />
              </div>
              <h2 className="text-base font-bold uv-text-primary">{t('analytics_no_moves')}</h2>
              <p className="mt-1 text-sm uv-text-muted max-w-xs">{t('analytics_empty_hint')}</p>
              {!mismosRangos(rango, rangoPreset('este_ano', hoy)) && (
                <button
                  type="button"
                  onClick={() => setRango(rangoPreset('este_ano', hoy))}
                  className="mt-5 h-11 px-5 rounded-full bg-[var(--color-primary)] text-white text-sm font-bold uv-focus-ring"
                >
                  {t('analytics_preset_this_year')}
                </button>
              )}
            </section>
          ) : (
            <div
              aria-busy={cargando}
              className={`mt-4 grid gap-4 lg:grid-cols-12 transition-opacity duration-200 ${desactualizada ? 'opacity-50' : 'opacity-100'}`}
            >
              {/* Balance: el neto manda; ingresos y gastos en una misma escala. */}
              <section aria-labelledby="an-balance" className={`${TARJETA} lg:col-span-5`}>
                <h2 id="an-balance" className="text-sm font-semibold uv-text-secondary">
                  {t('analytics_balance_title')}
                </h2>
                <p className={`mt-1 text-[2rem] leading-tight font-extrabold tracking-tight break-words ${analisis.neto >= 0 ? TEXTO_INGRESO : TEXTO_GASTO}`}>
                  {analisis.neto >= 0 ? '+' : '-'}
                  {formatoMonto(Math.abs(analisis.neto))}
                </p>
                <p className="text-xs uv-text-muted">{t('analytics_balance_hint')}</p>

                <div className="mt-5 space-y-3.5">
                  <BarraMonto
                    etiqueta={t('analytics_dir_in')}
                    monto={formatoMonto(analisis.ingresos)}
                    fraccion={analisis.ingresos / Math.max(analisis.ingresos, analisis.gastos, 0.01)}
                    color={COLOR.ingreso}
                    claseTexto={TEXTO_INGRESO}
                  />
                  <BarraMonto
                    etiqueta={t('analytics_dir_out')}
                    monto={formatoMonto(analisis.gastos)}
                    fraccion={analisis.gastos / Math.max(analisis.ingresos, analisis.gastos, 0.01)}
                    color={COLOR.gasto}
                    claseTexto={TEXTO_GASTO}
                  />
                </div>

                {analisis.ingresos > 0 && analisis.gastos > 0 && (
                  <p className="mt-4 text-sm font-medium uv-text-secondary">
                    {t('analytics_spent_share').replace('{pct}', String(Math.round((analisis.gastos / analisis.ingresos) * 100)))}
                  </p>
                )}
                <p className="mt-1 text-xs uv-text-muted">
                  {t('analytics_tx_line')
                    .replace('{total}', contar(analisis.cantidadIngresos + analisis.cantidadGastos, 'analytics_tx_count'))
                    .replace('{in}', contar(analisis.cantidadIngresos, 'analytics_tx_in'))
                    .replace('{out}', contar(analisis.cantidadGastos, 'analytics_tx_out'))}
                </p>

                {(analisis.promedioDiario > 0 || analisis.diaPico) && (
                  <dl className="mt-5 pt-4 border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)] grid grid-cols-2 gap-4">
                    <div className="min-w-0">
                      <dt className="text-xs uv-text-muted">{t('analytics_daily_avg')}</dt>
                      <dd className="mt-0.5 text-base font-bold uv-text-primary truncate">{formatoMonto(analisis.promedioDiario)}</dd>
                    </div>
                    {analisis.diaPico && (
                      <div className="min-w-0">
                        <dt className="text-xs uv-text-muted">{t('analytics_peak_day')}</dt>
                        <dd className="mt-0.5 text-base font-bold uv-text-primary truncate">{nombreDia(analisis.diaPico.dia)}</dd>
                        <dd className="text-xs uv-text-muted tabular-nums truncate">{formatoMonto(analisis.diaPico.monto)}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </section>

              {/* Flujo por tramos del periodo. */}
              <section aria-labelledby="an-flujo" className={`${TARJETA} lg:col-span-7`}>
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-4">
                  <div>
                    <h2 id="an-flujo" className="text-sm font-semibold uv-text-primary">{t('analytics_flow_title')}</h2>
                    <p className="text-xs uv-text-muted">
                      {t(analisis.granularidad === 'dia' ? 'analytics_group_day' : analisis.granularidad === 'semana' ? 'analytics_group_week' : 'analytics_group_month')}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-xs font-medium uv-text-secondary">
                    <Leyenda color={COLOR.ingreso} texto={t('analytics_dir_in')} />
                    <Leyenda color={COLOR.gasto} texto={t('analytics_dir_out')} />
                  </div>
                </div>
                <GraficoFlujo
                  tramos={analisis.tramos.map((tr) => ({
                    clave: tr.clave,
                    etiqueta: etiquetaDeTramo(
                      tr,
                      analisis.granularidad,
                      language,
                      rangoMostrado.desde.slice(0, 4) !== rangoMostrado.hasta.slice(0, 4) && analisis.tramos.length > 12,
                    ),
                    etiquetaLarga: etiquetaLargaDeTramo(tr, analisis.granularidad, language),
                    ingresos: tr.ingresos,
                    gastos: tr.gastos,
                  }))}
                  formatoEje={formatoCompacto}
                  formatoMonto={formatoMonto}
                  alto={escritorio ? 280 : 220}
                  rotulos={{
                    ingresos: t('analytics_dir_in'),
                    gastos: t('analytics_dir_out'),
                    neto: t('net_balance'),
                    tabla: t('analytics_chart_table'),
                    ayuda: t('analytics_chart_help'),
                  }}
                />
              </section>

              {/* Contra el periodo anterior, en los mismos dias. */}
              <section aria-labelledby="an-comparacion" className={`${TARJETA} lg:col-span-5`}>
                <h2 id="an-comparacion" className="text-sm font-semibold uv-text-primary">{t('analytics_compare_title')}</h2>
                {anteriorListo && anteriorIncompleto && primeraFecha ? (
                  <p className="mt-4 flex items-start gap-2 text-sm uv-text-muted">
                    <Icons.Info size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                    {t('analytics_compare_partial').replace('{fecha}', fechaLarga(primeraFecha))}
                  </p>
                ) : anteriorListo ? (
                  <Comparacion
                    actual={{ ingresos: analisis.ingresos, gastos: analisis.gastos }}
                    previo={totalesEn(anteriorListo.resumen.groups, analisis.moneda)}
                    nombrePrevio={nombreDeRango(anteriorListo.rango, language)}
                    formato={formatoCompacto}
                  />
                ) : carga?.fallo || (anterior?.clave === carga?.clave && anterior?.estado === 'fallo') ? (
                  <p className="mt-4 flex items-start gap-2 text-sm uv-text-muted">
                    <Icons.Info size={16} className="shrink-0 mt-0.5" aria-hidden="true" />
                    {t('analytics_compare_failed')}
                  </p>
                ) : (
                  <div className="mt-4 space-y-3 animate-pulse" aria-hidden="true">
                    <div className={`h-3 w-32 rounded ${RELLENO}`} />
                    <div className={`h-16 rounded-xl ${RELLENO}`} />
                    <div className={`h-16 rounded-xl ${RELLENO}`} />
                  </div>
                )}
              </section>

              {/* Gastos por categoria: las porciones suman la cifra del centro. */}
              <section aria-labelledby="an-categorias" className={`${TARJETA} lg:col-span-7`}>
                <h2 id="an-categorias" className="text-sm font-semibold uv-text-primary">{t('analytics_by_category')}</h2>
                {analisis.categorias.length === 0 ? (
                  <div className="flex flex-col items-center py-8 uv-text-muted">
                    <Icons.PiggyBank size={36} className="mb-2 opacity-60" aria-hidden="true" />
                    <p className="text-sm font-medium">{t('analytics_no_expenses')}</p>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col sm:flex-row items-center gap-6">
                    {/* El centro es angosto: montos compactos; los exactos van en la lista. */}
                    <GraficoDonaCategorias
                      porciones={analisis.categorias.map((c) => ({ ...c, nombre: nombreCategoria(c.categoria) }))}
                      formatoMonto={formatoCompacto}
                      etiquetaAccesible={t('analytics_categories_chart').replace(
                        '{detalle}',
                        analisis.categorias.map((c) => `${nombreCategoria(c.categoria)} ${c.porcentaje.toFixed(1)}%`).join(', '),
                      )}
                    >
                      <p className="text-xs uv-text-muted">{t('analytics_spent_center')}</p>
                      <p className="text-lg font-extrabold uv-text-primary leading-tight">{formatoCompacto(analisis.gastos)}</p>
                    </GraficoDonaCategorias>
                    <ul className="w-full flex-1 min-w-0 space-y-3">
                      {analisis.categorias.map((c) => (
                        <li key={c.categoria}>
                          <div className="flex items-center gap-2.5">
                            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ backgroundColor: colorDeCategoria(c.categoria) }} />
                            <span className="flex-1 min-w-0 truncate text-sm font-semibold uv-text-primary">{nombreCategoria(c.categoria)}</span>
                            <span className="text-sm font-bold uv-text-primary tabular-nums">{formatoMonto(c.monto)}</span>
                            <span className="w-12 text-right text-xs uv-text-muted tabular-nums">{c.porcentaje.toFixed(1)}%</span>
                          </div>
                          <div className={`mt-1.5 ml-5 h-1.5 rounded-full overflow-hidden ${RELLENO}`}>
                            <div
                              className="h-full rounded-full transition-[width] duration-500 ease-out"
                              style={{ width: `${Math.max(c.porcentaje, 1)}%`, backgroundColor: colorDeCategoria(c.categoria) }}
                            />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>

              {/* Principales movimientos: nombres y montos que el usuario reconoce. */}
              <section aria-labelledby="an-principales" className={`${TARJETA} lg:col-span-12`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 id="an-principales" className="text-sm font-semibold uv-text-primary">{t('analytics_top_moves')}</h2>
                  <div className={`flex p-1 rounded-full ${RELLENO}`} role="group" aria-label={t('analytics_top_moves')}>
                    {([['all', 'analytics_dir_all'], ['in', 'analytics_dir_in'], ['out', 'analytics_dir_out']] as const).map(([dir, key]) => (
                      <button
                        key={dir}
                        type="button"
                        aria-pressed={direccion === dir}
                        onClick={() => setDireccion(dir)}
                        className={`h-8 px-3.5 rounded-full text-xs font-bold transition-colors uv-focus-ring ${
                          direccion === dir ? 'uv-surface-1 uv-text-primary shadow-[var(--shadow-soft)]' : 'border border-transparent uv-text-muted'
                        }`}
                      >
                        {t(key)}
                      </button>
                    ))}
                  </div>
                </div>
                <Principales
                  movimientos={analisis.principales
                    .filter((tx) => (direccion === 'all' ? true : direccion === 'in' ? tx.amount > 0 : tx.amount < 0))
                    .slice(0, PRINCIPALES_VISIBLES[direccion])}
                  formatoMonto={formatoMonto}
                  locale={locale}
                  vacio={t('analytics_no_moves')}
                  titulo={(tx) => txTitle(tx, t)}
                />
              </section>
            </div>
          )}

          {analisis && !sinDatos && (
            <p className="mt-6 text-center text-xs uv-text-muted">{t('analytics_footnote')}</p>
          )}
        </div>
      </div>
    </div>
  );
};

const AvisoFallo: React.FC<{ texto: string; reintentar: string; onReintentar: () => void }> = ({ texto, reintentar, onReintentar }) => (
  <div className="mt-3 flex items-start gap-2 rounded-2xl uv-chip-warning px-3 py-2.5 text-xs font-medium" role="status">
    <Icons.AlertTriangle size={16} className="shrink-0 mt-px" aria-hidden="true" />
    <p className="flex-1">{texto}</p>
    <button type="button" onClick={onReintentar} className="shrink-0 font-bold underline underline-offset-2 uv-focus-ring rounded">
      {reintentar}
    </button>
  </div>
);

const Leyenda: React.FC<{ color: string; texto: string }> = ({ color, texto }) => (
  <span className="inline-flex items-center gap-1.5">
    <span aria-hidden="true" className="w-2.5 h-2.5 rounded-[3px]" style={{ backgroundColor: color }} />
    {texto}
  </span>
);

const BarraMonto: React.FC<{ etiqueta: string; monto: string; fraccion: number; color: string; claseTexto: string }> = ({
  etiqueta,
  monto,
  fraccion,
  color,
  claseTexto,
}) => (
  <div>
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-sm font-medium uv-text-secondary">{etiqueta}</span>
      <span className={`text-base font-bold tabular-nums truncate ${claseTexto}`}>{monto}</span>
    </div>
    <div className={`mt-1.5 h-2 rounded-full overflow-hidden ${RELLENO}`}>
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${fraccion > 0 ? Math.max(fraccion * 100, 1.5) : 0}%`, backgroundColor: color }}
      />
    </div>
  </div>
);

const Comparacion: React.FC<{
  actual: { ingresos: number; gastos: number };
  previo: { ingresos: number; gastos: number };
  nombrePrevio: string;
  formato: (n: number) => string;
}> = ({ actual, previo, nombrePrevio, formato }) => {
  const { t } = useLanguage();
  const maximo = Math.max(actual.ingresos, actual.gastos, previo.ingresos, previo.gastos, 0.01);
  const pctGastos = variacion(actual.gastos, previo.gastos);
  const rotulos = { actual: t('analytics_this_period'), anterior: t('analytics_prev_short') };

  let frase: string;
  if (pctGastos === null) frase = t('analytics_vs_none');
  else if (pctGastos <= -1) frase = t('analytics_vs_less').replace('{pct}', Math.abs(pctGastos).toFixed(0));
  else if (pctGastos >= 1) frase = t('analytics_vs_more').replace('{pct}', pctGastos.toFixed(0));
  else frase = t('analytics_vs_flat');
  frase = frase.replace('{prev}', nombrePrevio);

  return (
    <div>
      <p className="text-xs uv-text-muted">{nombrePrevio}</p>
      <div className="mt-4 space-y-4">
        <BloqueComparacion titulo={t('analytics_dir_in')} pct={variacion(actual.ingresos, previo.ingresos)} subirEsBueno>
          <GraficoComparacion actual={actual.ingresos} anterior={previo.ingresos} maximo={maximo} color={COLOR.ingreso} rotulos={rotulos} formato={formato} />
        </BloqueComparacion>
        <BloqueComparacion titulo={t('analytics_dir_out')} pct={pctGastos} subirEsBueno={false}>
          <GraficoComparacion actual={actual.gastos} anterior={previo.gastos} maximo={maximo} color={COLOR.gasto} rotulos={rotulos} formato={formato} />
        </BloqueComparacion>
      </div>
      <p className="mt-4 text-sm font-medium uv-text-secondary">{frase}</p>
    </div>
  );
};

const BloqueComparacion: React.FC<{ titulo: string; pct: number | null; subirEsBueno: boolean; children: React.ReactNode }> = ({
  titulo,
  pct,
  subirEsBueno,
  children,
}) => {
  let chip: React.ReactNode = null;
  if (pct !== null) {
    const plano = Math.abs(pct) < 1;
    const bueno = subirEsBueno ? pct > 0 : pct < 0;
    const clase = plano ? 'uv-chip-info' : bueno ? 'uv-chip-success' : 'uv-chip-danger';
    const Icono = pct >= 0 ? Icons.TrendingUp : Icons.TrendingDown;
    chip = (
      <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-xs font-bold tabular-nums ${clase}`}>
        {!plano && <Icono size={13} aria-hidden="true" />}
        {pct > 0 && !plano ? '+' : ''}
        {plano ? '0' : pct.toFixed(0)}%
      </span>
    );
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold uv-text-primary">{titulo}</span>
        {chip}
      </div>
      {children}
    </div>
  );
};

const Principales: React.FC<{
  movimientos: Transaction[];
  formatoMonto: (n: number) => string;
  locale: string;
  vacio: string;
  titulo: (tx: Transaction) => string;
}> = ({ movimientos, formatoMonto, locale, vacio, titulo }) => {
  if (movimientos.length === 0) {
    return <p className="text-sm uv-text-muted py-6 text-center">{vacio}</p>;
  }
  const fecha = (iso?: string, respaldo?: string) => {
    const ms = iso ? Date.parse(iso) : NaN;
    if (Number.isNaN(ms)) return respaldo ?? '';
    try {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Costa_Rica' }).format(ms);
    } catch {
      return respaldo ?? '';
    }
  };
  return (
    <ul className="mt-2 grid lg:grid-cols-2 lg:gap-x-10">
      {movimientos.map((tx) => {
        const entra = tx.amount > 0;
        return (
          <li
            key={tx.id}
            className="flex items-center gap-3 py-3 border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] last:border-b-0 lg:[&:nth-last-child(2):nth-child(odd)]:border-b-0"
          >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${entra ? 'uv-chip-success' : 'uv-chip-danger'}`}>
              {entra ? <Icons.ArrowDownLeft size={16} aria-hidden="true" /> : <Icons.ArrowUpRight size={16} aria-hidden="true" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold uv-text-primary truncate">{titulo(tx)}</p>
              <p className="text-xs uv-text-muted">{fecha(tx.dateISO, tx.date)}</p>
            </div>
            <span className={`text-sm font-bold tabular-nums shrink-0 ${entra ? TEXTO_INGRESO : TEXTO_GASTO}`}>
              {entra ? '+' : ''}
              {formatoMonto(tx.amount)}
            </span>
          </li>
        );
      })}
    </ul>
  );
};

/**
 * Esqueleto de la primera carga. Si la espera se alarga (el servidor puede
 * estar despertando), lo dice con texto: un bloque gris que no cambia parece
 * una pantalla colgada.
 */
const Esqueleto: React.FC<{ aviso: string }> = ({ aviso }) => {
  const [larga, setLarga] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setLarga(true), ESPERA_LARGA_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <div className="mt-4">
      <p role="status" aria-live="polite" className={`mb-3 min-h-[1.25rem] text-sm uv-text-muted text-center transition-opacity duration-300 ${larga ? 'opacity-100' : 'opacity-0'}`}>
        {larga ? aviso : ''}
      </p>
      <div className="grid gap-4 lg:grid-cols-12 animate-pulse" aria-hidden="true">
        {['lg:col-span-5 h-72', 'lg:col-span-7 h-72', 'lg:col-span-12 h-56'].map((c) => (
          <div key={c} className={`${TARJETA} ${c}`}>
            <div className={`h-3 w-28 rounded ${RELLENO}`} />
            <div className={`mt-3 h-8 w-44 rounded ${RELLENO}`} />
            <div className={`mt-6 h-24 rounded-xl ${RELLENO}`} />
          </div>
        ))}
      </div>
    </div>
  );
};
