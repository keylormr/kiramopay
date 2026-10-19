import React, { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { Button } from '@/components/ui';
import { getApiLayer } from '@/api';
import { VENTAS_POR_PAGINA, type QRMerchant, type QRPayment } from '@/api/repositories/qrpayment.repository';
import { fechaLarga, rellenar } from '@/utils/planes';
import { useCapa } from '@/navegacion/pilaDeCapas';
import { BusinessMovementsView } from './BusinessMovementsView';
import { BusinessReportsView } from './BusinessReportsView';

interface Props {
  onClose: () => void;
}

type Pestana = 'movimientos' | 'reportes';

/** La inicial del comercio, en gris: un cerrado no lleva el color de los activos. */
const Inicial: React.FC<{ nombre: string; grande?: boolean }> = ({ nombre, grande = false }) => (
  <div
    aria-hidden="true"
    className={`${grande ? 'w-12 h-12 text-lg' : 'w-10 h-10 text-sm'} rounded-full bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] uv-text-muted font-bold flex items-center justify-center shrink-0`}
  >
    {nombre.trim().charAt(0).toUpperCase() || '?'}
  </div>
);

/**
 * Los comercios que su dueno cerro. Un cerrado no vuelve al selector de
 * negocios (ahi se cobra y se edita), pero lo que vendio sigue siendo suyo:
 * desde aqui ve las ventas y el reporte, y descarga el CSV aunque el comercio
 * no tuviera el plan de analitica. No hay nada que cobrar ni que cambiar.
 */
export const ClosedMerchantsView: React.FC<Props> = ({ onClose }) => {
  const { t, language } = useLanguage();
  const [comercios, setComercios] = useState<QRMerchant[] | null>(null);
  const [falloLista, setFalloLista] = useState(false);
  const [intento, setIntento] = useState(0);
  const [elegido, setElegido] = useState<QRMerchant | null>(null);
  const [pestana, setPestana] = useState<Pestana>('movimientos');
  const [ventas, setVentas] = useState<QRPayment[] | null>(null);
  const [falloVentas, setFalloVentas] = useState(false);
  // Las ventas llegan de a una pagina. Una llena puede tener mas detras: de un
  // comercio cerrado no hay otra forma de llegar a las viejas.
  const [hayMas, setHayMas] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [falloMas, setFalloMas] = useState(false);
  // Cada comercio que se abre es una consulta nueva: la pagina que llega tarde,
  // de uno que ya se cerro en pantalla, no se agrega a otro.
  const consulta = useRef(0);

  // Lo que se reinicia al reintentar o al abrir otro comercio se reinicia en
  // el gesto que lo pide, no aqui: el efecto solo pide y anota la respuesta.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(getApiLayer().qrPayments?.listClosedMerchants()).then((res) => {
      if (cancelled) return;
      if (res?.success && res.data) setComercios(res.data);
      else setFalloLista(true);
    }).catch(() => { if (!cancelled) setFalloLista(true); });
    return () => { cancelled = true; };
  }, [intento]);

  useEffect(() => {
    if (!elegido) return;
    let cancelled = false;
    Promise.resolve(getApiLayer().qrPayments?.getMerchantPayments(elegido.id)).then((res) => {
      if (cancelled) return;
      if (res?.success && res.data) {
        setVentas(res.data);
        setHayMas(res.data.length >= VENTAS_POR_PAGINA);
      } else { setVentas([]); setFalloVentas(true); }
    }).catch(() => { if (!cancelled) { setVentas([]); setFalloVentas(true); } });
    return () => { cancelled = true; };
  }, [elegido]);

  const reintentar = () => {
    setFalloLista(false);
    setComercios(null);
    setIntento((n) => n + 1);
  };
  const abrir = (m: QRMerchant) => {
    consulta.current += 1;
    setVentas(null);
    setFalloVentas(false);
    setHayMas(false);
    setCargandoMas(false);
    setFalloMas(false);
    setPestana('movimientos');
    setElegido(m);
  };
  const volverALaLista = () => {
    consulta.current += 1;
    setElegido(null);
  };

  const pedirMas = () => {
    const ultima = ventas?.[ventas.length - 1];
    if (!elegido || !ultima || cargandoMas) return;
    const esta = consulta.current;
    setCargandoMas(true);
    setFalloMas(false);
    Promise.resolve(getApiLayer().qrPayments?.getMerchantPayments(elegido.id, { antesDe: ultima.id })).then((res) => {
      if (esta !== consulta.current) return;
      if (res?.success && res.data) {
        const siguientes = res.data;
        setVentas((previas) => [...(previas ?? []), ...siguientes]);
        setHayMas(siguientes.length >= VENTAS_POR_PAGINA);
      } else {
        setFalloMas(true);
      }
    }).catch(() => {
      if (esta === consulta.current) setFalloMas(true);
    }).finally(() => {
      if (esta === consulta.current) setCargandoMas(false);
    });
  };

  // Atras con un comercio abierto vuelve a la lista, igual que la flecha; la
  // pantalla entera la cierra App.
  useCapa(elegido !== null, 'pantalla', volverALaLista);

  const cerradoEl = (m: QRMerchant) => rellenar(t('merchant_admin_closed_on'), { fecha: fechaLarga(m.closedAt, language) });

  const tabClass = (activa: boolean) =>
    `min-w-0 flex-1 px-1 py-2.5 rounded-lg text-xs font-bold leading-tight text-center transition-all flex items-center justify-center gap-1.5 ${
      activa ? 'bg-white dark:bg-gray-700 uv-text-primary shadow-sm' : 'text-gray-500'
    }`;

  const lista = (
    <div className="px-4 pt-4 pb-24 space-y-4 max-w-2xl w-full mx-auto">
      <p className="text-sm uv-text-muted leading-relaxed">{t('business_closed_intro')}</p>

      {falloLista ? (
        <div className="uv-surface-1 rounded-2xl p-8 text-center uv-shadow-soft">
          <Icons.AlertCircle size={40} className="mx-auto text-[var(--color-danger)] opacity-70 mb-3" />
          <p className="uv-text-muted text-sm mb-4">{t('business_closed_load_failed')}</p>
          <button
            type="button"
            onClick={reintentar}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-5 py-2.5 text-sm font-bold text-white transition-all hover:bg-[var(--color-primary-hover)] active:scale-[0.98] uv-focus-ring"
          >
            <Icons.RefreshCw size={16} aria-hidden="true" />
            {t('error_retry')}
          </button>
        </div>
      ) : comercios === null ? (
        <p className="text-sm uv-text-muted text-center py-10" role="status">{t('loading')}</p>
      ) : comercios.length === 0 ? (
        <div className="uv-surface-1 rounded-2xl p-8 text-center uv-shadow-soft">
          <Icons.Lock size={36} className="mx-auto uv-text-muted opacity-50 mb-3" />
          <p className="uv-text-muted text-sm">{t('business_closed_empty')}</p>
        </div>
      ) : (
        <div className="uv-surface-1 rounded-2xl uv-shadow-soft divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] overflow-hidden">
          {comercios.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => abrir(m)}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] transition-colors uv-focus-ring"
            >
              <Inicial nombre={m.name} />
              <span className="flex-1 min-w-0">
                <span className="block font-bold uv-text-primary truncate">{m.name}</span>
                <span className="block text-xs uv-text-muted">{cerradoEl(m)}</span>
              </span>
              <Icons.ChevronRight size={18} className="uv-text-muted shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const detalle = elegido && (
    <div className="max-w-2xl w-full mx-auto">
      <div className="px-4 pt-4 space-y-4">
        <div className="flex items-center gap-3">
          <Inicial nombre={elegido.name} grande />
          <div className="min-w-0">
            <h2 className="text-lg font-bold uv-text-primary truncate">{elegido.name}</h2>
            {elegido.legalName && elegido.legalName !== elegido.name && (
              <p className="text-xs uv-text-muted truncate">{elegido.legalName}</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-[var(--color-surface-2)] dark:bg-[var(--color-surface-2-dark)] px-4 py-3 flex items-start gap-3">
          <Icons.Lock size={18} className="uv-text-muted shrink-0 mt-0.5" />
          <p className="text-sm uv-text-primary leading-snug">
            {rellenar(t('business_closed_notice'), { fecha: fechaLarga(elegido.closedAt, language) })}
          </p>
        </div>

        <div role="tablist" aria-label={elegido.name} className="flex p-1 rounded-xl bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)]">
          <button
            type="button"
            role="tab"
            id="cerrado-tab-movimientos"
            aria-selected={pestana === 'movimientos'}
            aria-controls="cerrado-panel"
            onClick={() => setPestana('movimientos')}
            className={tabClass(pestana === 'movimientos')}
          >
            <Icons.Receipt size={14} aria-hidden="true" />
            {t('business_movements')}
          </button>
          <button
            type="button"
            role="tab"
            id="cerrado-tab-reportes"
            aria-selected={pestana === 'reportes'}
            aria-controls="cerrado-panel"
            onClick={() => setPestana('reportes')}
            className={tabClass(pestana === 'reportes')}
          >
            <Icons.TrendingUp size={14} aria-hidden="true" />
            {t('business_reports')}
          </button>
        </div>
      </div>

      <div role="tabpanel" id="cerrado-panel" aria-labelledby={`cerrado-tab-${pestana}`}>
        {pestana === 'reportes' ? (
          <BusinessReportsView merchant={elegido} />
        ) : ventas === null ? (
          <p className="text-sm uv-text-muted text-center py-10" role="status">{t('loading')}</p>
        ) : (
          <BusinessMovementsView
            payments={ventas}
            paymentsFailed={falloVentas}
            conTitulo={false}
            pie={hayMas && (
              <div className="space-y-2">
                {falloMas && (
                  <p role="alert" className="text-sm text-center text-[var(--color-danger)]">{t('business_closed_more_failed')}</p>
                )}
                <Button variant="secondary" size="md" fullWidth loading={cargandoMas} onClick={pedirMas}>
                  {t('business_closed_more')}
                </Button>
              </div>
            )}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-[var(--color-background)] dark:bg-[var(--color-background-dark)] flex flex-col animate-in slide-in-from-right duration-200">
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-surface-dark/80 backdrop-blur-md border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)] px-4 h-14 flex items-center justify-between flex-shrink-0">
        <button
          type="button"
          onClick={elegido ? volverALaLista : onClose}
          className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)] uv-focus-ring"
          aria-label={t('back')}
        >
          <Icons.ChevronLeft size={20} />
        </button>
        <h1 className="text-lg font-bold">{t('business_closed_menu')}</h1>
        <span className="w-9" />
      </div>
      <div className="flex-1 overflow-y-auto">{elegido ? detalle : lista}</div>
    </div>
  );
};
