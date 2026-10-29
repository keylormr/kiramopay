import React from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { formatMoney, type CurrencyCode } from '@/utils/money';
import {
  fechaYHoraLocal,
  horaLocal,
  type MovimientoDelComercio,
  type TipoDeMovimiento,
} from '@/utils/movimientosDelComercio';

/** Un monto en su moneda, con miles y dos decimales, como el resto de la app. */
export const dinero = (valor: number, moneda: string) =>
  formatMoney(valor, moneda as CurrencyCode, { decimals: 2 });

/**
 * Lo que cada tipo de movimiento dice de si mismo: un icono, un tono y las
 * palabras. El icono nunca va solo: quien no distingue los colores o no ve la
 * forma lee la etiqueta.
 */
export const ESTILO_DE_MOVIMIENTO: Readonly<
  Record<TipoDeMovimiento, { icono: keyof typeof Icons; tono: string; etiqueta: string; detalle: string }>
> = {
  cobro: {
    icono: 'QrCode',
    tono: 'bg-[var(--color-success-soft)] text-[var(--color-success)]',
    etiqueta: 'business_move_type_charge',
    detalle: 'business_detail_charge',
  },
  devolucion: {
    icono: 'Undo2',
    tono: 'bg-[var(--color-warning-soft)] text-[var(--color-warning)]',
    etiqueta: 'business_move_type_refund',
    detalle: 'business_detail_refund',
  },
  retiro: {
    icono: 'ArrowUpRight',
    tono: 'bg-[var(--color-primary-soft)] text-[var(--color-primary)]',
    etiqueta: 'business_move_type_withdrawal',
    detalle: 'business_detail_withdrawal',
  },
};

export const IconoDeMovimiento: React.FC<{ tipo: TipoDeMovimiento; grande?: boolean }> = ({ tipo, grande = false }) => {
  const estilo = ESTILO_DE_MOVIMIENTO[tipo];
  const Icono = Icons[estilo.icono];
  return (
    <span
      aria-hidden="true"
      className={`${grande ? 'w-12 h-12' : 'w-10 h-10'} rounded-full flex items-center justify-center shrink-0 ${estilo.tono}`}
    >
      <Icono size={grande ? 22 : 18} />
    </span>
  );
};

/**
 * Lo que el movimiento hizo con el saldo del negocio, con su signo escrito: un
 * cobro suma lo que el negocio recibe (neto), una devolucion y un retiro restan.
 */
export function montoConSigno(m: MovimientoDelComercio): { texto: string; entra: boolean } {
  if (m.tipo === 'cobro') return { texto: `+${dinero(m.neto, m.moneda)}`, entra: true };
  return { texto: `−${dinero(m.monto, m.moneda)}`, entra: false };
}

interface Props {
  movimiento: MovimientoDelComercio;
  tzOffsetMin: number;
  onAbrir: (m: MovimientoDelComercio) => void;
  /** La fecha completa junto a la hora: para listas que no se agrupan por dia. */
  conFecha?: boolean;
}

/** Una fila de la lista de movimientos. Toda ella abre el detalle. */
export const MovimientoFila: React.FC<Props> = ({ movimiento: m, tzOffsetMin, onAbrir, conFecha = false }) => {
  const { t, language } = useLanguage();
  const estilo = ESTILO_DE_MOVIMIENTO[m.tipo];
  const { texto, entra } = montoConSigno(m);
  const cuando = conFecha ? fechaYHoraLocal(m.fecha, tzOffsetMin, language) : horaLocal(m.fecha, tzOffsetMin, language);
  // El nombre solo se escribe si el servidor lo dio; el detalle dice lo que falta.
  const quien = m.tipo === 'retiro' ? m.retiradoPor : m.pagador;
  const sinCompletar = m.tipo !== 'retiro' && m.estado !== 'completed' && m.estado !== 'refunded';

  return (
    <button
      type="button"
      data-testid="movimiento"
      data-tipo={m.tipo}
      aria-haspopup="dialog"
      // Una sola frase para quien lee con un lector de pantalla, en el orden de
      // la fila, en vez de un tramo de textos sueltos.
      aria-label={[t(estilo.etiqueta as Parameters<typeof t>[0]), cuando, quien, texto].filter(Boolean).join(', ')}
      onClick={() => onAbrir(m)}
      className="w-full flex items-center gap-3 px-4 py-3 min-h-[60px] text-left transition-colors hover:bg-[var(--color-surface-muted)] dark:hover:bg-[var(--color-surface-muted-dark)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)]"
    >
      <IconoDeMovimiento tipo={m.tipo} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-sm font-bold uv-text-primary">{t(estilo.etiqueta as Parameters<typeof t>[0])}</span>
          {sinCompletar && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${m.estado === 'failed' ? 'uv-chip-danger' : 'uv-chip-warning'}`}>
              {t(`tx_status_${m.estado}` as Parameters<typeof t>[0])}
            </span>
          )}
        </span>
        <span className="block truncate text-xs uv-text-muted tabular-nums">
          {quien ? `${cuando} · ${quien}` : cuando}
        </span>
      </span>
      <span
        className={`shrink-0 text-sm font-bold tabular-nums ${
          entra ? 'text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]' : 'uv-text-primary'
        }`}
      >
        {texto}
      </span>
    </button>
  );
};
