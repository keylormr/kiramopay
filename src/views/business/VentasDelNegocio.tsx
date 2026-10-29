import React, { useId } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Button } from '@/components/ui';
import type {
  PeriodoDeVentas,
  ResumenDelComercio,
  ResumenDelPeriodo,
  VentasPorMoneda,
} from '@/api/repositories/qrpayment.repository';
import { conteoConPlural } from '@/utils/conteo';
import { dinero } from './MovimientoFila';
import { ChipVariacion } from './ChipVariacion';

/** Los periodos del inicio, en el orden en que se leen. */
const PERIODOS_DEL_INICIO: ReadonlyArray<{ id: PeriodoDeVentas; etiqueta: string; contra: string }> = [
  { id: 'today', etiqueta: 'business_period_today', contra: 'business_sales_vs_yesterday' },
  { id: 'week', etiqueta: 'business_period_week', contra: 'business_sales_vs_week' },
  { id: 'month', etiqueta: 'business_period_month', contra: 'business_sales_vs_month' },
];

/**
 * Las ventas de un periodo en las monedas que tuvo, la moneda base primero. Un
 * periodo sin ventas es un cero que el servidor conto: se escribe en la moneda
 * base, no se deja un hueco.
 */
export function ventasDelPeriodo(periodo: ResumenDelPeriodo, monedaBase: string): VentasPorMoneda[] {
  const filas = [...periodo.currencies];
  if (!filas.some((f) => f.currency === monedaBase)) {
    filas.push({ currency: monedaBase, gross: 0, fee: 0, net: 0, count: 0 });
  }
  return filas.sort((a, b) => (a.currency === monedaBase ? -1 : b.currency === monedaBase ? 1 : a.currency.localeCompare(b.currency)));
}

interface Props {
  /** undefined = cargando; null = no se pudo traer. */
  resumen: ResumenDelComercio | null | undefined;
  monedaBase: string;
  /** Dueno o encargado: lo que ve un cajero es solo el dia de hoy y sin comparar. */
  esDelNegocio: boolean;
  onReintentar: () => void;
}

/**
 * Ventas de hoy, de los ultimos 7 dias y del mes, con la cantidad de cobros
 * rotulada. Las cifras las cuenta el servidor en el dia de calendario de quien
 * mira, y con el plan Analitica trae la comparacion con el periodo anterior.
 *
 * Una consulta que falla se dice: no se pinta como un cero.
 */
export const VentasDelNegocio: React.FC<Props> = ({ resumen, monedaBase, esDelNegocio, onReintentar }) => {
  const { t } = useLanguage();
  const idTitulo = useId();
  const cuenta = (n: number) => conteoConPlural(t as (clave: string) => string, 'business_charges_count', n);

  return (
    <section aria-labelledby={idTitulo} aria-busy={resumen === undefined} className="space-y-2">
      <h3 id={idTitulo} className="text-xs font-bold uv-text-muted uppercase tracking-wider">
        {t('business_sales_title')}
      </h3>

      {resumen === undefined ? (
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)]" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-4 py-4 flex items-center justify-between">
              <span className="h-4 w-16 rounded bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] animate-pulse" />
              <span className="h-5 w-28 rounded bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] animate-pulse" />
            </div>
          ))}
        </div>
      ) : resumen === null ? (
        <div className="uv-surface-1 rounded-2xl p-4 uv-shadow-soft space-y-3">
          <p role="alert" className="text-sm uv-text-muted">{t('business_sales_summary_failed')}</p>
          <Button variant="secondary" size="md" fullWidth onClick={onReintentar}>
            {t('error_retry')}
          </Button>
        </div>
      ) : (
        <>
          <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
            {PERIODOS_DEL_INICIO.map(({ id, etiqueta, contra }) => {
              const periodo = resumen.periods.find((p) => p.period === id);
              if (!periodo) return null;
              const nombre = t(etiqueta as Parameters<typeof t>[0]);
              const filas = ventasDelPeriodo(periodo, monedaBase);
              return (
                <div key={id} role="group" aria-label={nombre} className="flex items-start justify-between gap-4 px-4 py-3.5">
                  <span className="pt-0.5 text-sm font-semibold uv-text-secondary">{nombre}</span>
                  <div className="min-w-0 space-y-2.5 text-right">
                    {filas.map((f) => (
                      <div key={f.currency}>
                        <p className="text-lg font-bold uv-text-primary tabular-nums">{dinero(f.gross, f.currency)}</p>
                        <p className="text-xs uv-text-muted tabular-nums">{cuenta(f.count)}</p>
                        {f.delta && (
                          <p className="mt-1 flex items-center justify-end gap-1.5 text-xs uv-text-muted">
                            <ChipVariacion pct={f.delta.grossPct} />
                            <span>{t(contra as Parameters<typeof t>[0])}</span>
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {esDelNegocio && resumen.plan !== 'analitica' && (
            <p className="px-1 text-xs uv-text-muted">{t('business_sales_compare_locked')}</p>
          )}
        </>
      )}
    </section>
  );
};
