import React, { useState } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { BottomSheet } from '@/components/BottomSheet';
import { fechaYHoraLocal, type MovimientoDelComercio } from '@/utils/movimientosDelComercio';
import { dinero, ESTILO_DE_MOVIMIENTO, IconoDeMovimiento, montoConSigno } from './MovimientoFila';

interface Props {
  movimiento: MovimientoDelComercio | null;
  tzOffsetMin: number;
  onClose: () => void;
}

const Fila: React.FC<{ etiqueta: string; children: React.ReactNode }> = ({ etiqueta, children }) => (
  <div className="flex items-start justify-between gap-4 py-3">
    <dt className="shrink-0 text-sm uv-text-muted">{etiqueta}</dt>
    <dd className="min-w-0 break-words text-right text-sm font-semibold uv-text-primary">{children}</dd>
  </div>
);

/**
 * El detalle de un movimiento del comercio.
 *
 * Solo escribe lo que el servidor dio. Cuando un dato falta lo dice con
 * palabras: "No disponible" si debia estar (hay sucursal pero no su nombre), y
 * "Sin sucursal asignada" o "Sin cajero registrado" cuando lo que falta es un
 * hecho (la venta es de antes del equipo). Un guion o un cero ahi se leerian
 * como un dato.
 */
export const DetalleDeMovimiento: React.FC<Props> = ({ movimiento, tzOffsetMin, onClose }) => {
  const { t, language } = useLanguage();

  // Mientras la hoja se cierra, conserva el ultimo movimiento para que su
  // contenido no desaparezca antes que la hoja.
  const [ultimo, setUltimo] = useState(movimiento);
  if (movimiento && movimiento !== ultimo) setUltimo(movimiento);
  const m = movimiento ?? ultimo;

  const noDisponible = t('business_no_disponible');
  const estilo = m ? ESTILO_DE_MOVIMIENTO[m.tipo] : null;

  return (
    <BottomSheet
      isOpen={movimiento !== null}
      onClose={onClose}
      title={estilo ? t(estilo.detalle as Parameters<typeof t>[0]) : ''}
    >
      {m && estilo && (
        <div className="space-y-2">
          <div className="flex flex-col items-center gap-2 pb-2 text-center">
            <IconoDeMovimiento tipo={m.tipo} grande />
            <p className="text-3xl font-black uv-text-primary tabular-nums">{montoConSigno(m).texto}</p>
            <p className="text-sm uv-text-muted">{t(estilo.etiqueta as Parameters<typeof t>[0])}</p>
          </div>

          <dl className="divide-y divide-[var(--color-border)] dark:divide-[var(--color-border-dark)] border-t border-[var(--color-border)] dark:border-[var(--color-border-dark)]">
            {m.tipo === 'retiro' ? (
              <Fila etiqueta={t('business_detail_withdrawn_by')}>{m.retiradoPor ?? noDisponible}</Fila>
            ) : (
              <>
                <Fila etiqueta={t('business_detail_payer')}>{m.pagador ?? noDisponible}</Fila>
                <Fila etiqueta={t('business_detail_location')}>
                  {m.sucursalId ? (m.sucursal ?? noDisponible) : t('business_detail_no_location')}
                </Fila>
                <Fila etiqueta={t('business_role_cashier')}>
                  {m.cajeroId ? (m.cajero ?? noDisponible) : t('business_detail_no_cashier')}
                </Fila>
              </>
            )}
            <Fila etiqueta={t('business_detail_reference')}>
              <span className="font-mono text-xs">{m.referencia}</span>
            </Fila>
            <Fila etiqueta={t('status')}>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${claseDeEstado(m.estado)}`}>
                {t(claveDeEstado(m.estado) as Parameters<typeof t>[0])}
              </span>
            </Fila>
            <Fila etiqueta={t('date')}>
              <span className="tabular-nums">{fechaYHoraLocal(m.fecha, tzOffsetMin, language)}</span>
            </Fila>
            {m.nota && <Fila etiqueta={t('transaction_note')}>{m.nota}</Fila>}
            {m.tipo === 'cobro' && (
              <>
                <Fila etiqueta={t('amount')}>
                  <span className="tabular-nums">{dinero(m.monto, m.moneda)}</span>
                </Fila>
                <Fila etiqueta={t('merchant_fee_label')}>
                  <span className="tabular-nums">{dinero(m.comision, m.moneda)}</span>
                </Fila>
                <Fila etiqueta={t('merchant_net_received')}>
                  <span className="tabular-nums">{dinero(m.neto, m.moneda)}</span>
                </Fila>
              </>
            )}
          </dl>
        </div>
      )}
    </BottomSheet>
  );
};

function claveDeEstado(estado: MovimientoDelComercio['estado']): string {
  return estado === 'refunded' ? 'business_status_refunded' : `tx_status_${estado}`;
}

function claseDeEstado(estado: MovimientoDelComercio['estado']): string {
  if (estado === 'completed') return 'uv-chip-success';
  if (estado === 'failed') return 'uv-chip-danger';
  return 'uv-chip-warning';
}
