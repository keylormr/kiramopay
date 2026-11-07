import React from 'react';
import type { Transaction } from '@/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { txTitle } from '@/utils/txTitle';
import { estaCompletado, estiloDeEstado, noMovioDinero } from '@/utils/estadoMovimiento';
import { localeDe } from '@/utils/periodos';
import { arteDelMovimiento } from '@/utils/arteDelMovimiento';
import { Icono3D, Ilustracion3D } from '@/components/arte3d/Arte3D';

// La actividad del Inicio, como en el concepto: los movimientos agrupados por
// dia ("Hoy", "Ayer", "4 nov."), con la cara de la persona (iniciales) o el
// icono 3D de su categoria, y el monto y la hora a la derecha. Sin puntos
// medios: cada dato en su linea.

interface ActividadRecienteProps {
  movimientos: Transaction[];
  onAbrir: (tx: Transaction) => void;
  onVerTodo?: () => void;
  formatearMonto: (monto: number, moneda: string) => string;
  /** El ojo de la tarjeta de saldo: tapa los montos (y su color, que dice si
   *  entro o salio dinero). */
  oculto?: boolean;
}

function claveDelDia(fecha: Date): string {
  return `${fecha.getFullYear()}-${fecha.getMonth()}-${fecha.getDate()}`;
}

function fechaDe(tx: Transaction): Date | null {
  if (!tx.dateISO) return null;
  const f = new Date(tx.dateISO);
  return Number.isNaN(f.getTime()) ? null : f;
}

export const ActividadReciente: React.FC<ActividadRecienteProps> = ({ movimientos, onAbrir, onVerTodo, formatearMonto, oculto = false }) => {
  const { t, language } = useLanguage();
  const locale = localeDe(language);
  const hoy = new Date();
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);

  const nombreDelDia = (fecha: Date | null): string => {
    if (!fecha) return '';
    const clave = claveDelDia(fecha);
    if (clave === claveDelDia(hoy)) return t('business_day_today');
    if (clave === claveDelDia(ayer)) return t('business_day_yesterday');
    try {
      return new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        ...(fecha.getFullYear() !== hoy.getFullYear() ? { year: 'numeric' as const } : {}),
      }).format(fecha);
    } catch {
      return fecha.toISOString().slice(0, 10);
    }
  };

  const horaDe = (fecha: Date | null): string => {
    if (!fecha) return '';
    try {
      return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(fecha);
    } catch {
      return '';
    }
  };

  // La linea de abajo del nombre: que fue (el tipo), cuando el titulo es el de
  // la persona. Si el titulo ya es el tipo, no se repite.
  const detalleDe = (tx: Transaction, titulo: string): string => {
    const kind = (tx.kind || '').trim();
    if (kind) {
      const clave = `tx_title_${kind}`;
      const tipo = t(clave);
      if (tipo !== clave && !titulo.startsWith(tipo)) return tipo;
      return '';
    }
    return (tx.category || '').trim();
  };

  // El encabezado del dia va sobre el primer movimiento de cada dia. Un
  // movimiento sin fecha de maquina no corta el dia: el siguiente del mismo
  // dia no repite el encabezado.
  const filas: { tx: Transaction; fecha: Date | null; dia: string; mostrarDia: boolean }[] = [];
  let ultimoDia = '';
  for (const tx of movimientos) {
    const fecha = fechaDe(tx);
    const dia = nombreDelDia(fecha);
    filas.push({ tx, fecha, dia, mostrarDia: dia !== '' && dia !== ultimoDia });
    if (dia !== '') ultimoDia = dia;
  }

  return (
    <section aria-labelledby="actividad-titulo">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="actividad-titulo" className="text-[17px] font-semibold tracking-[-0.01em] uv-text-primary">
          {t('recent_transactions')}
        </h2>
        <button
          type="button"
          onClick={onVerTodo}
          className="kp-foco -my-2 min-h-11 rounded-lg px-1 text-sm font-semibold text-[var(--color-primary)] hover:underline dark:text-[var(--color-primary-light)]"
        >
          {t('view_all')}
        </button>
      </div>

      <div className="rounded-[20px] border border-[var(--color-border)] uv-surface-1 px-3.5 py-1 dark:border-[var(--color-border-dark)]">
        {movimientos.length === 0 ? (
          <div className="flex flex-col items-center px-4 pb-6 pt-4 text-center">
            <Ilustracion3D nombre="sinMovimientos" tamano={112} />
            <p className="mt-2 text-sm font-semibold uv-text-primary">{t('no_transactions_yet')}</p>
            <p className="mt-1 text-xs uv-text-secondary">{t('actividad_vacia_desc')}</p>
          </div>
        ) : (
          filas.map(({ tx, fecha, dia, mostrarDia }) => {
            const titulo = txTitle(tx, t);
            const detalle = detalleDe(tx, titulo);
            const incoming = tx.amount > 0;
            // Lo completado va como siempre, sin rotulo. Lo demas dice su
            // estado: un SINPE que fallo se veia igual que uno que salio.
            const completado = estaCompletado(tx);
            const estado = estiloDeEstado(tx);
            const tachado = noMovioDinero(tx);
            const arte = arteDelMovimiento(tx);
            // Sin fecha de maquina (filas viejas) queda el texto que traian.
            const cuando = fecha ? horaDe(fecha) : tx.date;
            return (
              <React.Fragment key={tx.id}>
                {mostrarDia && (
                  <p className="px-0.5 pb-0.5 pt-2.5 text-xs font-semibold uv-text-muted first:pt-2">{dia}</p>
                )}
                <button
                  type="button"
                  data-movimiento
                  onClick={() => onAbrir(tx)}
                  className="kp-foco -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors hover:bg-[var(--color-surface-2)] dark:hover:bg-[var(--color-surface-2-dark)]"
                >
                  <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[13px] bg-[var(--color-surface-3)] text-[13px] font-semibold text-[var(--color-primary)] dark:bg-[var(--color-surface-3-dark)] dark:text-[#C9DAFF]">
                    {arte.tipo === 'icono' ? (
                      <Icono3D nombre={arte.nombre} tamano={34} />
                    ) : (
                      <span aria-hidden="true">{arte.texto}</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold uv-text-primary">{titulo}</span>
                    {(detalle || !completado) && (
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs uv-text-secondary">
                        {detalle && <span className="truncate">{detalle}</span>}
                        {!completado && (
                          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold ${estado.chip}`}>
                            {t(estado.clave)}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span
                      className={`kp-num block whitespace-nowrap text-sm font-semibold ${
                        oculto
                          ? 'uv-text-primary'
                          : tachado
                            ? 'uv-text-muted line-through'
                            : incoming
                              ? 'text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]'
                              : 'uv-text-primary'
                      }`}
                    >
                      {oculto ? (
                        <>
                          <span aria-hidden="true">••••</span>
                          <span className="sr-only">{t('monto_oculto')}</span>
                        </>
                      ) : (
                        <>
                          {incoming ? '+' : ''}
                          {formatearMonto(tx.amount, tx.ccy)}
                        </>
                      )}
                    </span>
                    {cuando && <span className="kp-num mt-0.5 block text-xs uv-text-muted">{cuando}</span>}
                  </span>
                </button>
              </React.Fragment>
            );
          })
        )}
      </div>
    </section>
  );
};
