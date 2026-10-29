import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { getApiLayer } from '@/api';
import {
  VENTAS_POR_PAGINA,
  type PeriodoDeVentas,
  type QRMerchant,
  type QRPayment,
  type RetiroDelComercio,
  type TotalDelDia,
} from '@/api/repositories/qrpayment.repository';
import { entregarArchivo, type EstadoExport } from '@/utils/entregarArchivo';
import { fusionarMovimientos } from '@/utils/movimientosDelComercio';
import { ListaDeMovimientos } from './ListaDeMovimientos';

interface Props {
  merchant: QRMerchant;
  /** Sin el titulo cuando la pantalla que la contiene ya lo dice. */
  conTitulo?: boolean;
}

const PERIODOS: ReadonlyArray<{ id: PeriodoDeVentas; clave: string }> = [
  { id: 'today', clave: 'business_period_today' },
  { id: 'week', clave: 'business_period_week' },
  { id: 'month', clave: 'business_period_month' },
  { id: 'prev_month', clave: 'business_period_prev_month' },
];

// El servidor exporta el periodo por su nombre; los dias son solo el tamano
// aproximado que el contrato todavia pide.
const DIAS_DEL_PERIODO: Readonly<Record<PeriodoDeVentas, number>> = { today: 1, week: 7, month: 30, prev_month: 31 };

const AVISO_DE_EXPORTACION: Partial<Record<EstadoExport, { clave: string; tono: 'ok' | 'mal' }>> = {
  listo: { clave: 'business_report_exported', tono: 'ok' },
  error: { clave: 'business_report_export_failed', tono: 'mal' },
  plan: { clave: 'business_report_export_plan', tono: 'mal' },
  solo_web: { clave: 'business_report_export_web_only', tono: 'mal' },
};

/**
 * Los movimientos del comercio: cobros, devoluciones y retiros, por dia, con el
 * total de cada dia por moneda, un filtro de periodo y la exportacion.
 *
 * Cada periodo lo cuenta el SERVIDOR en el dia de calendario de quien mira. El
 * filtro no recorta lo que ya se cargo: cambiar de periodo pide de nuevo, porque
 * una pagina de 50 cobros no es "el mes".
 */
export const BusinessMovementsView: React.FC<Props> = ({ merchant, conTitulo = true }) => {
  const { t, language } = useLanguage();
  const [periodo, setPeriodo] = useState<PeriodoDeVentas>('week');
  const [intento, setIntento] = useState(0);

  // null = cargando. Un arreglo vacio es un dato: el servidor conto cero.
  const [cobros, setCobros] = useState<QRPayment[] | null>(null);
  const [falloCobros, setFalloCobros] = useState(false);
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [falloMas, setFalloMas] = useState(false);
  // undefined = cargando, null = no se pudo traer.
  const [totales, setTotales] = useState<TotalDelDia[] | null | undefined>(undefined);
  const [retiros, setRetiros] = useState<RetiroDelComercio[]>([]);
  const [falloRetiros, setFalloRetiros] = useState(false);

  const [exportacion, setExportacion] = useState<EstadoExport>('quieto');
  const exportandoRef = useRef(false);
  // Cada carga lleva su numero: la respuesta de un periodo que ya no es el
  // elegido se descarta.
  const consulta = useRef(0);

  // El saldo del negocio no es de un cajero: ni sus retiros ni el reporte.
  const esDelNegocio = merchant.role === 'owner' || merchant.role === 'manager';
  // Un comercio cerrado se exporta con cualquier plan: lo que vendio es de su dueno.
  const puedeExportar = merchant.plan === 'analitica' || !!merchant.closedAt;

  useEffect(() => {
    const api = getApiLayer().qrPayments;
    if (!api) return;
    const esta = ++consulta.current;
    const vigente = () => esta === consulta.current;

    setCobros(null);
    setFalloCobros(false);
    setHayMas(false);
    setFalloMas(false);
    setCargandoMas(false);
    setTotales(undefined);
    setRetiros([]);
    setFalloRetiros(false);

    void Promise.resolve(api.getMerchantPayments(merchant.id, { periodo }))
      .then((res) => {
        if (!vigente()) return;
        if (res.success && res.data) {
          setCobros(res.data);
          setHayMas(res.data.length >= VENTAS_POR_PAGINA);
        } else {
          setCobros([]);
          setFalloCobros(true);
        }
      })
      .catch(() => {
        if (!vigente()) return;
        setCobros([]);
        setFalloCobros(true);
      });

    void Promise.resolve(api.getMerchantDailyTotals(merchant.id, periodo))
      .then((res) => {
        if (vigente()) setTotales(res.success && res.data ? res.data : null);
      })
      .catch(() => {
        if (vigente()) setTotales(null);
      });

    if (esDelNegocio) {
      void Promise.resolve(api.getMerchantWithdrawals(merchant.id, periodo))
        .then((res) => {
          if (!vigente()) return;
          if (res.success && res.data) setRetiros(res.data);
          else setFalloRetiros(true);
        })
        .catch(() => {
          if (vigente()) setFalloRetiros(true);
        });
    }
  }, [merchant.id, periodo, intento, esDelNegocio]);

  const pedirMas = () => {
    const api = getApiLayer().qrPayments;
    const ultima = cobros?.[cobros.length - 1];
    if (!api || !ultima || cargandoMas) return;
    const esta = consulta.current;
    setCargandoMas(true);
    setFalloMas(false);
    void Promise.resolve(api.getMerchantPayments(merchant.id, { periodo, antesDe: ultima.id }))
      .then((res) => {
        if (esta !== consulta.current) return;
        if (res.success && res.data) {
          const siguientes = res.data;
          setCobros((previos) => [...(previos ?? []), ...siguientes]);
          setHayMas(siguientes.length >= VENTAS_POR_PAGINA);
        } else {
          setFalloMas(true);
        }
      })
      .catch(() => {
        if (esta === consulta.current) setFalloMas(true);
      })
      .finally(() => {
        if (esta === consulta.current) setCargandoMas(false);
      });
  };

  const exportar = async () => {
    // Sin el plan no hay nada que pedir: el aviso de abajo ya lo dice.
    if (!puedeExportar || exportandoRef.current) return;
    const api = getApiLayer().qrPayments;
    if (!api) return;
    exportandoRef.current = true;
    setExportacion('exportando');
    try {
      // En el idioma de la app: el servidor escribe el reporte en ese idioma.
      const res = await api.exportMerchantReportCsv(merchant.id, DIAS_DEL_PERIODO[periodo], language, periodo);
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

  const elegirPeriodo = (p: PeriodoDeVentas) => {
    if (p === periodo) return;
    setPeriodo(p);
    if (exportacion !== 'exportando') setExportacion('quieto');
  };

  // Los retiros que no se pudieron traer faltan de la lista: se dice. Mientras
  // falten cobros por cargar, un retiro entre dos huecos no se muestra todavia.
  const movimientos = useMemo(
    () => fusionarMovimientos(cobros ?? [], retiros, hayMas),
    [cobros, retiros, hayMas],
  );
  const tzOffsetMin = new Date().getTimezoneOffset();

  const aviso = !puedeExportar && esDelNegocio
    ? { clave: 'business_report_export_plan', tono: 'mal' as const }
    : AVISO_DE_EXPORTACION[exportacion];

  return (
    <div className="pb-24 pt-4 px-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        {conTitulo ? <h2 className="text-lg font-bold uv-text-primary">{t('business_movements')}</h2> : <span />}
        {esDelNegocio && (
          <button
            type="button"
            onClick={exportar}
            aria-disabled={!puedeExportar || exportacion === 'exportando'}
            className={`inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] text-sm font-bold uv-text-primary transition-colors ${
              puedeExportar ? 'hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)]' : 'opacity-60'
            }`}
          >
            <Icons.Download size={16} aria-hidden="true" />
            {exportacion === 'exportando' ? t('business_report_exporting') : t('business_report_export')}
          </button>
        )}
      </div>

      <div role="group" aria-label={t('business_period_label')} className="grid grid-cols-4 gap-1.5">
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => elegirPeriodo(p.id)}
            aria-pressed={periodo === p.id}
            className={`h-10 rounded-xl px-1 text-[13px] font-bold leading-tight transition-colors ${
              periodo === p.id
                ? 'bg-[var(--color-primary)] text-white'
                : 'uv-surface-1 uv-text-muted border border-[var(--color-border)] dark:border-[var(--color-border-dark)]'
            }`}
          >
            {t(p.clave as Parameters<typeof t>[0])}
          </button>
        ))}
      </div>

      {aviso && (
        <p
          role="status"
          className={`text-sm ${aviso.tono === 'ok' ? 'text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]' : 'uv-text-muted'}`}
        >
          {t(aviso.clave as Parameters<typeof t>[0])}
        </p>
      )}

      {cobros === null ? (
        <div aria-busy="true" role="status" className="space-y-2">
          <span className="sr-only">{t('loading')}</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[60px] rounded-2xl uv-surface-1 animate-pulse" />
          ))}
        </div>
      ) : falloCobros ? (
        <div className="uv-surface-1 rounded-2xl p-8 text-center uv-shadow-soft">
          <Icons.AlertCircle size={40} className="mx-auto text-[var(--color-danger)] opacity-70 mb-3" aria-hidden="true" />
          <p className="uv-text-muted text-sm">{t('business_sales_load_failed')}</p>
          <div className="mt-4">
            <Button variant="secondary" size="md" onClick={() => setIntento((n) => n + 1)}>
              {t('error_retry')}
            </Button>
          </div>
        </div>
      ) : (
        <>
          {movimientos.length === 0 ? (
            <div className="uv-surface-1 rounded-2xl p-8 text-center uv-shadow-soft">
              <Icons.Receipt size={40} className="mx-auto uv-text-muted opacity-50 mb-3" aria-hidden="true" />
              <p className="uv-text-muted text-sm">{t('business_move_none')}</p>
            </div>
          ) : (
            <ListaDeMovimientos movimientos={movimientos} tzOffsetMin={tzOffsetMin} totales={totales === undefined ? [] : totales} />
          )}

          {falloRetiros && (
            <p role="status" className="text-sm uv-text-muted">{t('business_move_withdrawals_failed')}</p>
          )}

          {hayMas && (
            <div className="space-y-2">
              {falloMas && (
                <p role="alert" className="text-sm text-center text-[var(--color-danger)]">{t('business_move_more_failed')}</p>
              )}
              <Button variant="secondary" size="md" fullWidth loading={cargandoMas} onClick={pedirMas}>
                {t('business_move_more')}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
