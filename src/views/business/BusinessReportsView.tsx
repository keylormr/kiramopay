import React, { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useLanguage } from '@/i18n/LanguageContext';
import { useApp } from '@/hooks/useApp';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { getApiLayer } from '@/api';
import type {
  QRMerchant,
  BusinessReport,
  BusinessReportBucket,
  BusinessReportComparison,
} from '@/api/repositories/qrpayment.repository';
import { formatMoney, type CurrencyCode } from '@/utils/money';
import { useTarifas } from '@/hooks/usePlanes';
import { diaCorto, rellenar } from '@/utils/planes';
import { mensajeDeRechazo } from '@/i18n/mensajesDeError';

interface Props {
  merchant: QRMerchant;
}

const RANGES = [7, 30, 90] as const;

/** Local YYYY-MM-DD for a date, matching the server's client-tz bucketing. */
const localKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type EstadoExport = 'quieto' | 'exportando' | 'listo' | 'error' | 'plan' | 'solo_web';

/**
 * Entrega el CSV a quien lo pidio. En el navegador lo descarga. En la app del
 * telefono un enlace de descarga no hace nada (el WebView lo ignora en
 * silencio), asi que ahi se ofrece compartir el archivo si el sistema lo deja
 * y, si no, se dice que hoy se exporta desde la web: nunca un "listo" falso.
 */
async function entregarArchivo(blob: Blob, nombre: string): Promise<EstadoExport> {
  if (Capacitor.isNativePlatform()) {
    const nav = navigator as Navigator & { canShare?: (datos: ShareData) => boolean };
    const archivo = typeof File === 'function' ? new File([blob], nombre, { type: 'text/csv' }) : null;
    if (archivo && nav.share && nav.canShare?.({ files: [archivo] })) {
      try {
        await nav.share({ files: [archivo], title: nombre });
        return 'listo';
      } catch {
        return 'quieto';
      }
    }
    return 'solo_web';
  }
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'listo';
}

/**
 * The shop's numbers (owner/manager): headline totals, a single-series daily
 * bar chart, and the per-location / per-collector breakdowns built from the
 * attribution phase 3 records. One hue for one measure; text stays in ink
 * tokens; the grid is recessive.
 *
 * Con el plan Analitica suma la comparacion contra el periodo anterior y la
 * exportacion en CSV. Sin el plan muestra una vista previa honesta: la forma,
 * el precio y "Proximamente", sin un solo numero inventado.
 */
export const BusinessReportsView: React.FC<Props> = ({ merchant }) => {
  const { t, language } = useLanguage();
  const { state } = useApp();
  const tarifas = useTarifas();
  const ccy = (state.accounts.find((a) => a.ccy === state.baseCurrency) || state.accounts[0])?.ccy ?? 'CRC';
  // utils/money y no `symbol + toFixed(2)`: el atajo perdia los miles con coma.
  const money = (v: number) => formatMoney(v, ccy as CurrencyCode, { decimals: 2 });

  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  // La ultima respuesta buena y el rango al que corresponde. Mientras llega la
  // de otro rango se sigue viendo, atenuada y rotulada "Actualizando": antes
  // la pantalla pintaba guiones y un grafico en cero, identico a un comercio
  // sin ventas (hallazgo QA n=35).
  const [carga, setCarga] = useState<{ dias: number; reporte: BusinessReport } | null>(null);
  const [pidiendo, setPidiendo] = useState<number | null>(days);
  // El error crudo, no el texto: `t` no entra en las dependencias de la carga.
  const [error, setError] = useState<{ code?: string; message?: string } | null>(null);
  const [intento, setIntento] = useState(0);

  const [exportacion, setExportacion] = useState<EstadoExport>('quieto');
  const exportandoRef = useRef(false);

  const [interes, setInteres] = useState<'quieto' | 'enviando' | 'anotado' | 'error'>('quieto');
  const interesRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setPidiendo(days);
      setError(null);
      const api = getApiLayer().qrPayments;
      try {
        const res = api ? await api.getMerchantReport(merchant.id, days) : null;
        if (cancelled) return;
        if (res?.success && res.data) setCarga({ dias: days, reporte: res.data });
        else setError(res?.error ?? {});
      } catch {
        if (!cancelled) setError({});
      } finally {
        if (!cancelled) setPidiendo(null);
      }
    })();
    return () => { cancelled = true; };
  }, [merchant.id, days, intento]);

  const report = carga?.reporte ?? null;
  const primeraCarga = !carga && !error;
  const desactualizado = !!carga && (carga.dias !== days || pidiendo !== null);
  // Un fallo es del rango elegido: no se muestran los numeros de otro rango
  // como si fueran de este.
  const fallo = error !== null;

  // El plan con el que el servidor armo el reporte manda; el del comercio
  // cargado antes es solo el respaldo mientras llega.
  const conAnalitica = (report?.plan ?? merchant.plan) === 'analitica';

  const exportar = async () => {
    const api = getApiLayer().qrPayments;
    if (!api || exportandoRef.current) return;
    exportandoRef.current = true;
    setExportacion('exportando');
    try {
      const res = await api.exportMerchantReportCsv(merchant.id, days);
      if (!res.success || !res.data) {
        setExportacion(res.error?.code === 'PLAN_REQUIRED' ? 'plan' : 'error');
        return;
      }
      setExportacion(await entregarArchivo(res.data.blob, res.data.nombre));
    } catch {
      setExportacion('error');
    } finally {
      exportandoRef.current = false;
    }
  };

  const avisarme = async () => {
    if (interesRef.current || interes === 'anotado') return;
    interesRef.current = true;
    setInteres('enviando');
    try {
      const res = await getApiLayer().plans?.registrarInteres('analitica');
      setInteres(res?.success ? 'anotado' : 'error');
    } catch {
      setInteres('error');
    } finally {
      interesRef.current = false;
    }
  };

  // Zero-fill the window so every day gets a bar, sparse data included. El eje
  // es el del reporte que se muestra: mientras llega otro rango, los 30 dias
  // viejos no se dibujan sobre un eje de 90.
  const diasDelGrafico = carga?.dias ?? days;
  const byDate = new Map((report?.daily ?? []).map((d) => [d.date, d]));
  const series: { date: string; net: number }[] = [];
  for (let i = diasDelGrafico - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = localKey(d);
    series.push({ date: key, net: byDate.get(key)?.net ?? 0 });
  }
  const maxNet = Math.max(1, ...series.map((s) => s.net));

  // "Sin ventas" solo con la respuesta del rango elegido en la mano.
  const empty = !!carga && !desactualizado && !fallo && carga.reporte.totals.count === 0;

  const bucketRows = (buckets: BusinessReportBucket[], title: string) => {
    if (buckets.length === 0) return null;
    const maxBucket = Math.max(1, ...buckets.map((b) => b.net));
    return (
      <div>
        <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-2">{title}</h3>
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
          {buckets.map((b) => (
            <div key={b.key ?? 'none'} className="px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold uv-text-primary truncate">
                  {b.label || t('business_report_unattributed')}
                </p>
                <p className="text-sm font-bold uv-text-primary tabular-nums shrink-0">{money(b.net)}</p>
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex-1 h-1 rounded-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[var(--color-primary)]"
                    style={{ width: `${Math.max(2, (b.net / maxBucket) * 100)}%` }}
                  />
                </div>
                <span className="text-[11px] uv-text-muted tabular-nums shrink-0">× {b.count}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const mensajeExport: Partial<Record<EstadoExport, { clave: string; tono: 'ok' | 'mal' }>> = {
    listo: { clave: 'business_report_exported', tono: 'ok' },
    error: { clave: 'business_report_export_failed', tono: 'mal' },
    plan: { clave: 'business_report_export_plan', tono: 'mal' },
    solo_web: { clave: 'business_report_export_web_only', tono: 'mal' },
  };
  const aviso = mensajeExport[exportacion];

  return (
    <div className="pb-24 pt-4 px-4 space-y-5">
      {/* Range selector */}
      <div className="flex gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => { setDays(r); if (exportacion !== 'exportando') setExportacion('quieto'); }}
            aria-pressed={days === r}
            className={`flex-1 h-9 rounded-xl text-sm font-bold transition-colors ${
              days === r
                ? 'bg-[var(--color-primary)] text-white'
                : 'uv-surface-1 uv-text-muted border border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
            }`}
          >
            {t(`business_report_range_${r}` as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {/* Para el lector de pantalla; lo visible va dentro de cada tarjeta. */}
      <p aria-live="polite" className="sr-only">
        {primeraCarga ? t('business_report_loading') : desactualizado && !fallo ? t('business_report_updating') : ''}
      </p>

      {fallo ? (
        <div className="uv-surface-1 rounded-3xl p-6 uv-shadow-soft flex flex-col items-center text-center">
          <Icons.AlertCircle size={24} className="mb-2 text-[var(--color-danger)]" aria-hidden="true" />
          <p role="alert" className="text-sm font-semibold uv-text-primary">
            {mensajeDeRechazo(error ?? undefined, {}, 'business_report_err_load', t)}
          </p>
          <Button className="mt-4" variant="secondary" onClick={() => setIntento((n) => n + 1)}>
            {t('error_retry')}
          </Button>
        </div>
      ) : primeraCarga ? (
        <div aria-busy="true" className="space-y-5">
          <div className="uv-surface-1 rounded-3xl p-5 uv-shadow-soft">
            <p className="flex items-center gap-2 text-xs font-semibold uv-text-muted" aria-hidden="true">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
              {t('business_report_loading')}
            </p>
            <div className="animate-pulse motion-reduce:animate-none">
              <div className="mt-3 h-8 w-44 rounded-lg bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]" />
              <div className="mt-4 flex gap-6">
                <div className="h-4 w-20 rounded bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]" />
                <div className="h-4 w-24 rounded bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]" />
              </div>
            </div>
          </div>
          <div className="uv-surface-1 rounded-2xl p-4 uv-shadow-soft animate-pulse motion-reduce:animate-none">
            <div className="h-3 w-24 rounded bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]" />
            <div className="mt-3 h-28 rounded-xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]" />
          </div>
        </div>
      ) : (
        <div
          aria-busy={desactualizado}
          className={`space-y-5 transition-opacity duration-200 ${desactualizado ? 'opacity-60' : 'opacity-100'}`}
        >
        {/* Headline totals */}
        <div className="uv-surface-1 rounded-3xl p-5 uv-shadow-soft">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider uv-text-muted">
              {t('business_report_net')}
            </span>
            {desactualizado && (
              <span className="flex items-center gap-1.5 text-xs font-semibold uv-text-secondary" aria-hidden="true">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
                {t('business_report_updating')}
              </span>
            )}
          </div>
          <div className="text-3xl font-black uv-text-primary mt-1 tabular-nums">
            {report ? money(report.totals.net) : '—'}
          </div>
          <div className="flex gap-6 mt-3 text-sm">
            <div>
              <span className="uv-text-muted">{t('business_report_sales')}</span>{' '}
              <span className="font-bold uv-text-primary tabular-nums">{report?.totals.count ?? '—'}</span>
            </div>
            <div>
              <span className="uv-text-muted">{t('business_report_commission')}</span>{' '}
              <span className="font-bold uv-text-primary tabular-nums">{report ? money(report.totals.fee) : '—'}</span>
            </div>
          </div>
        </div>

        {/* ── Analitica: la comparacion y el CSV, o la vista previa honesta ── */}
        {report && conAnalitica && (
          <>
            {report.comparison && (
              <Comparacion comp={report.comparison} actual={report.totals} money={money} idioma={language} />
            )}
            <div>
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => void exportar()}
                loading={exportacion === 'exportando'}
                leftIcon={<Icons.Download size={18} />}
              >
                {exportacion === 'exportando' ? t('business_report_exporting') : t('business_report_export')}
              </Button>
              {aviso && (
                <p
                  role={aviso.tono === 'ok' ? 'status' : 'alert'}
                  className={`mt-2 text-sm ${aviso.tono === 'ok' ? 'text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]' : 'text-[var(--color-danger)]'}`}
                >
                  {t(aviso.clave)}
                </p>
              )}
            </div>
          </>
        )}

        {report && !conAnalitica && tarifas.analitica && (
          <section className="uv-surface-1 rounded-3xl uv-shadow-soft p-5" aria-labelledby="analitica-bloqueada">
            <div className="flex flex-wrap items-center gap-2">
              <Icons.Lock size={16} className="uv-text-secondary" aria-hidden="true" />
              <h3 id="analitica-bloqueada" className="text-base font-black uv-text-primary">
                {t('business_report_locked_title')}
              </h3>
              <span className="rounded-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] px-2 py-0.5 text-[11px] font-bold uv-text-secondary">
                {t('plans_badge_soon')}
              </span>
            </div>
            <p className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-2xl font-black tabular-nums tracking-tight uv-text-primary">
                {formatMoney(tarifas.analitica.precio, 'USD', { decimals: 2 })}
              </span>
              <span className="text-sm font-semibold uv-text-muted">{t('plans_per_month')}</span>
            </p>
            <p className="mt-2 text-sm leading-relaxed uv-text-secondary">{t('business_report_locked_desc')}</p>

            {/* La forma de lo que traeria, sin un solo numero: nada inventado. */}
            <div
              aria-hidden="true"
              className="mt-4 rounded-2xl border border-dashed border-[var(--color-border-strong)] dark:border-[var(--color-border-dark)] p-4"
            >
              <p className="text-xs font-semibold uv-text-muted">{t('business_report_locked_preview')}</p>
              <div className="mt-3 space-y-3">
                {[t('business_report_net'), t('business_report_sales')].map((etiqueta) => (
                  <div key={etiqueta} className="flex items-center justify-between gap-3">
                    <span className="text-sm uv-text-secondary">{etiqueta}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-bold uv-text-muted">—</span>
                      <span className="rounded-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] px-2 py-0.5 text-[11px] font-bold uv-text-muted">
                        ± —%
                      </span>
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm uv-text-secondary">{t('business_report_export')}</span>
                  <Icons.Download size={16} className="uv-text-muted" />
                </div>
              </div>
            </div>

            <p className="mt-4 text-xs leading-relaxed uv-text-muted">{t('plans_cta_note')}</p>
            <button
              type="button"
              onClick={() => void avisarme()}
              disabled={interes === 'enviando' || interes === 'anotado'}
              aria-label={`${t(interes === 'anotado' ? 'plans_cta_registered' : interes === 'enviando' ? 'plans_cta_sending' : 'plans_cta_interested')} ${t('plans_analytics_name')}`}
              className={`mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl min-h-12 px-4 py-3 text-sm font-bold transition-colors uv-focus-ring disabled:cursor-default ${
                interes === 'anotado'
                  ? 'uv-chip-success'
                  : 'border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-soft)] disabled:opacity-70'
              }`}
            >
              {interes === 'anotado' ? <Icons.Check size={17} aria-hidden="true" /> : <Icons.Bell size={16} aria-hidden="true" />}
              {t(interes === 'anotado' ? 'plans_cta_registered' : interes === 'enviando' ? 'plans_cta_sending' : 'plans_cta_interested')}
            </button>
            {interes === 'error' && (
              <p role="alert" className="mt-2 text-xs font-semibold text-[var(--color-danger)]">{t('plans_cta_error')}</p>
            )}
          </section>
        )}

        {empty ? (
          <div className="flex flex-col items-center py-10 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] flex items-center justify-center mb-3">
              <Icons.TrendingUp size={24} className="uv-text-muted" />
            </div>
            <p className="text-sm uv-text-muted max-w-[260px]">{t('business_report_empty')}</p>
          </div>
        ) : (
          <>
            {/* Daily series — one measure, one hue, recessive frame. */}
            <div className="uv-surface-1 rounded-2xl p-4 uv-shadow-soft">
              <h3 className="text-xs font-bold uv-text-muted uppercase tracking-wider mb-3">
                {t('business_report_daily')}
              </h3>
              <div className="flex items-end gap-px h-28">
                {series.map((s) => (
                  <div key={s.date} className="flex-1 flex flex-col justify-end h-full" title={`${s.date}: ${money(s.net)}`}>
                    <div
                      className="w-full rounded-t bg-[var(--color-primary)]"
                      style={{ height: s.net > 0 ? `${Math.max(3, (s.net / maxNet) * 100)}%` : '0%' }}
                    />
                  </div>
                ))}
              </div>
              <div className="h-px bg-[var(--color-border)] dark:bg-[var(--color-border-dark)]" />
              <div className="flex justify-between mt-1.5 text-[10px] uv-text-muted tabular-nums">
                <span>{series[0]?.date.slice(5)}</span>
                <span>{series[series.length - 1]?.date.slice(5)}</span>
              </div>
            </div>

            {bucketRows(report?.byLocation ?? [], t('business_report_by_location'))}
            {bucketRows(report?.byCollector ?? [], t('business_report_by_collector'))}
          </>
        )}
        </div>
      )}
    </div>
  );
};

// ── La comparacion contra el periodo anterior (plan Analitica) ───────────────

interface ComparacionProps {
  comp: BusinessReportComparison;
  actual: BusinessReportBucket;
  money: (v: number) => string;
  idioma: string;
}

const Comparacion: React.FC<ComparacionProps> = ({ comp, actual, money, idioma }) => {
  const { t } = useLanguage();

  const filas = [
    { etiqueta: t('business_report_net'), ahora: money(actual.net), antes: money(comp.previousTotals.net), pct: comp.delta.netPct },
    { etiqueta: t('merchant_gross'), ahora: money(actual.gross), antes: money(comp.previousTotals.gross), pct: comp.delta.grossPct },
    { etiqueta: t('business_report_sales'), ahora: String(actual.count), antes: String(comp.previousTotals.count), pct: comp.delta.countPct },
  ];

  return (
    <section className="uv-surface-1 rounded-3xl uv-shadow-soft p-5" aria-labelledby="comparacion-titulo">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="comparacion-titulo" className="text-base font-black uv-text-primary">
          {t('business_report_compare_title')}
        </h3>
        <p className="text-xs uv-text-muted tabular-nums">
          {rellenar(t('business_report_compare_range'), {
            desde: diaCorto(comp.previousFrom, idioma),
            hasta: diaCorto(comp.previousTo, idioma),
          })}
        </p>
      </div>
      <ul className="mt-3 divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]">
        {filas.map((f) => (
          <li key={f.etiqueta} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold uv-text-primary">{f.etiqueta}</p>
              <p className="mt-0.5 text-xs uv-text-muted tabular-nums">
                {rellenar(t('business_report_compare_prev'), { valor: f.antes })}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-sm font-bold tabular-nums uv-text-primary">{f.ahora}</span>
              <ChipVariacion pct={f.pct} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

// El signo va escrito: el color solo no le dice nada a quien no lo distingue.
const ChipVariacion: React.FC<{ pct: number | null }> = ({ pct }) => {
  const { t } = useLanguage();
  if (pct === null) {
    return (
      <span className="rounded-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] px-2 py-0.5 text-[11px] font-bold uv-text-muted">
        {t('business_report_compare_no_base')}
      </span>
    );
  }
  const valor = Number(pct.toFixed(2));
  const tono = valor > 0 ? 'uv-chip-success' : valor < 0 ? 'uv-chip-danger' : 'bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] uv-text-secondary';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${tono}`}>
      {valor > 0 ? '+' : ''}
      {valor}%
    </span>
  );
};
