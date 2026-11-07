import React from 'react';
import { partesDelMonto } from '@/utils/partesDelMonto';
import { formatMoney, type CurrencyCode } from '@/utils/money';

// Las piezas de la hoja "revisa antes de mover dinero" del rediseno (fase 3,
// HojaRevisarEnvio de SINPE), sueltas para que el pago con QR y el envio de
// cripto se vean y se lean igual: a quien, cuanto en grande, que va a pasar
// en filas, y un solo boton que dice lo que hace.

/** La placa de quien recibe: iniciales, un icono o un logo. */
export const CaraDeRevision: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-[var(--color-surface-2)] text-xl font-semibold uv-text-primary shadow-[inset_0_0_0_1px_var(--color-border-strong)] dark:bg-[var(--color-surface-2-dark)] dark:shadow-[inset_0_0_0_1px_var(--color-border-strong-dark)]">
    {children}
  </div>
);

/** Un monto en dinero, grande, con el simbolo y los decimales tenues. */
export const CifraGrande: React.FC<{ valor: number; moneda: string; tachada?: boolean; className?: string }> = ({
  valor,
  moneda,
  tachada = false,
  className = '',
}) => {
  const partes = partesDelMonto(valor, moneda);
  // Se achica con el largo, como CantidadGrande: "₡12,345,678.00" a 48 px no
  // cabe en la hoja de un telefono de 344 px y el monto tecleado es libre.
  const tamano = partes.entero.length > 9 ? 'text-3xl' : partes.entero.length > 7 ? 'text-4xl' : 'text-5xl';
  return (
    <p
      className={`kp-num whitespace-nowrap font-semibold leading-none tracking-[-0.035em] ${
        tachada ? 'uv-text-muted line-through decoration-2' : 'uv-text-primary'
      } ${className}`}
    >
      {/* El lector de pantalla oye el monto entero, no tres pedazos. */}
      <span className="sr-only">{formatMoney(valor, moneda as CurrencyCode, { decimals: 2 })}</span>
      <span aria-hidden="true">
        {partes.signo}
        <span className="mr-0.5 align-[0.4em] text-[26px] uv-text-secondary">{partes.simbolo}</span>
        <span className={tamano}>{partes.entero}</span>
        <span className="text-[26px] uv-text-muted">{partes.decimales}</span>
      </span>
    </p>
  );
};

/**
 * Una cantidad que no es dinero (0.0025 BTC): la cifra grande y la unidad
 * tenue al lado. Se achica sola si es larga, para no salirse de la hoja.
 */
export const CantidadGrande: React.FC<{ cantidad: string; unidad: string; className?: string }> = ({ cantidad, unidad, className = '' }) => (
  <p className={`kp-num flex max-w-full items-baseline justify-center gap-2 font-semibold leading-none tracking-[-0.035em] uv-text-primary ${className}`}>
    <span className="sr-only">{`${cantidad} ${unidad}`}</span>
    <span aria-hidden="true" className={`min-w-0 break-all ${cantidad.length > 10 ? 'text-4xl' : 'text-5xl'}`}>{cantidad}</span>
    <span aria-hidden="true" className="shrink-0 text-[22px] uv-text-secondary">{unidad}</span>
  </p>
);

export interface FilaDeRevision {
  clave: string;
  etiqueta: string;
  valor: React.ReactNode;
  nota?: string;
  tono?: 'exito' | 'peligro';
}

const TONO: Record<NonNullable<FilaDeRevision['tono']> | 'normal', string> = {
  normal: 'uv-text-primary',
  exito: 'text-[var(--color-success-strong)] dark:text-[var(--color-success-strong-dark)]',
  peligro: 'text-[var(--color-danger)] dark:text-[var(--color-danger-strong-dark)]',
};

/** Lo que va a pasar, en filas de etiqueta y valor. */
export const FilasDeRevision: React.FC<{ filas: FilaDeRevision[] }> = ({ filas }) => (
  <dl className="rounded-[20px] border border-[var(--color-border)] uv-surface-2 px-4 py-1.5 dark:border-[var(--color-border-dark)]">
    {filas.map((f, i) => (
      <div
        key={f.clave}
        className={`flex items-start justify-between gap-3 py-3 ${i < filas.length - 1 ? 'border-b border-[var(--color-border)] dark:border-[var(--color-border-dark)]' : ''}`}
      >
        <dt className="shrink-0 text-sm uv-text-secondary">{f.etiqueta}</dt>
        <dd className="min-w-0 text-right">
          <span className={`kp-num block break-words text-sm font-semibold ${TONO[f.tono ?? 'normal']}`}>{f.valor}</span>
          {f.nota && <span className="mt-0.5 block text-xs uv-text-muted">{f.nota}</span>}
        </dd>
      </div>
    ))}
  </dl>
);

interface BotonDeRevisionProps {
  onClick: () => void;
  /** Bloqueado por algo que falta (se ve apagado). */
  bloqueado?: boolean;
  /** El movimiento esta en curso (se ve casi entero, con el giro). */
  procesando?: boolean;
  etiqueta: string;
  etiquetaProcesando: string;
  describedBy?: string;
}

/** El unico boton principal: dice que hace y por cuanto ("Pagar ₡5,000.00"). */
export const BotonDeRevision: React.FC<BotonDeRevisionProps> = ({
  onClick,
  bloqueado = false,
  procesando = false,
  etiqueta,
  etiquetaProcesando,
  describedBy,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={procesando || bloqueado}
    aria-busy={procesando}
    aria-describedby={describedBy}
    className={`kp-toque kp-foco flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-[var(--color-primary-fill)] px-4 text-base font-semibold text-white shadow-[0_10px_22px_-10px_rgba(45,123,255,0.75)] hover:bg-[var(--color-primary-hover)] disabled:cursor-not-allowed ${
      procesando ? 'disabled:opacity-80' : 'disabled:opacity-45 disabled:shadow-none'
    }`}
  >
    {procesando ? (
      <>
        <span aria-hidden="true" className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        {etiquetaProcesando}
      </>
    ) : (
      <span className="truncate">{etiqueta}</span>
    )}
  </button>
);

/** La salida sin mover dinero, discreta debajo del boton principal. */
export const BotonSecundarioDeRevision: React.FC<{ onClick: () => void; disabled?: boolean; children: React.ReactNode }> = ({
  onClick,
  disabled,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="kp-toque kp-foco h-12 w-full rounded-[16px] text-[15px] font-semibold uv-text-secondary hover:bg-[var(--color-surface-2)] disabled:opacity-50 dark:hover:bg-[var(--color-surface-2-dark)]"
  >
    {children}
  </button>
);
