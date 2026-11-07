import React, { useId } from 'react';
import { useLanguage } from '@/i18n/LanguageContext';
import { Icons } from '@/components/Icons';
import { MarcaKiramo } from '@/components/MarcaKiramo';
import { rellenar } from '@/utils/planes';
import { NOMBRE_DE_RED, numeroOculto, type RedDeTarjeta } from './redDeTarjeta';

// Cara de la tarjeta segun su red (concepto "Tarjetas" del rediseno oscuro,
// 2026-11-06). Proporcion real de una tarjeta (ISO/IEC 7810 ID-1, 85,60 x
// 53,98 mm) y todo medido en unidades del contenedor: la misma cara de 312 px
// en un plegable cerrado que de 448 px en una tablet, sin saltos de linea.
//
// Colores fijos: es un objeto fisico y se ve igual en los dos temas.
//
// Los nombres de las redes son TEXTO PROVISIONAL. Los logos oficiales salen de
// los centros de marca de cada red y los gestiona el dueno; no se dibujan ni se
// imitan aca. El arte real del emisor (Visa VTS, Mastercard MDES Digital Card
// Art) solo se obtiene como token requestor.

/**
 * Chip de contacto dibujado: oro con las placas de contacto. El rectangulo
 * amarillo plano de antes no se leia como chip.
 */
const ChipDeTarjeta: React.FC<{ className?: string }> = ({ className }) => {
  const id = useId();
  return (
    <svg width="44" height="34" viewBox="0 0 44 34" aria-hidden="true" focusable="false" className={`block drop-shadow-sm ${className ?? ''}`}>
      <defs>
        <linearGradient id={`${id}-oro`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F7E7B0" />
          <stop offset="0.5" stopColor="#DDB866" />
          <stop offset="1" stopColor="#B8893A" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="0.5" width="43" height="33" rx="6.5" fill={`url(#${id}-oro)`} stroke="rgba(92,64,16,0.4)" />
      <path
        d="M14.5 0.5v33M29.5 0.5v33M0.5 11.5h14M0.5 22.5h14M29.5 11.5h14M29.5 22.5h14M14.5 17h15"
        fill="none"
        stroke="rgba(92,64,16,0.45)"
        strokeWidth="1"
      />
    </svg>
  );
};

/** El nombre de la red abajo a la derecha, donde las tarjetas llevan el logo. */
const MarcaDeRed: React.FC<{ red: RedDeTarjeta; soloEnApp: string }> = ({ red, soloEnApp }) => {
  switch (red) {
    case 'visa':
      return <span aria-hidden="true" className="text-[clamp(20px,7.4cqw,32px)] font-bold italic leading-none tracking-tight">VISA</span>;
    case 'mastercard':
      return <span aria-hidden="true" className="text-[clamp(13px,4.4cqw,19px)] font-semibold leading-none tracking-[-0.01em]">mastercard</span>;
    case 'amex':
      return (
        <span aria-hidden="true" className="block text-right text-[clamp(9px,2.9cqw,13px)] font-bold leading-[1.15] tracking-[0.08em]">
          AMERICAN
          <br />
          EXPRESS
        </span>
      );
    default:
      // Decia VISA: prometia una red de pago a la que la tarjeta no pertenece.
      // Es una tarjeta de KiramoPay y se dice.
      return <span className="whitespace-nowrap text-[clamp(10px,3.1cqw,13px)] font-semibold">{soloEnApp}</span>;
  }
};

export interface CaraDeTarjetaProps {
  red: RedDeTarjeta;
  ultimos4: string;
  titular: string;
  venceMes?: number;
  venceAnio?: number;
  tipo?: 'virtual' | 'physical';
  congelada?: boolean;
  className?: string;
}

export const CaraDeTarjeta: React.FC<CaraDeTarjetaProps> = ({
  red,
  ultimos4,
  titular,
  venceMes,
  venceAnio,
  tipo = 'virtual',
  congelada = false,
  className = '',
}) => {
  const { t } = useLanguage();
  const propia = red === 'kiramopay';
  const vence =
    venceMes && venceAnio ? `${String(venceMes).padStart(2, '0')}/${String(venceAnio).slice(-2)}` : '';

  return (
    // El contenedor da las unidades cqw a todo lo de adentro.
    <div className={`@container/cara mx-auto w-full max-w-md ${className}`}>
      <div
        data-red={red}
        className={`kp-cara kp-cara-${red} relative aspect-[1.586] w-full overflow-hidden rounded-[clamp(16px,5.4cqw,24px)] text-white`}
      >
        {/* El brillo que cruza la tarjeta cada 6 s; con movimiento reducido no esta. */}
        <span aria-hidden="true" className="kp-brillo pointer-events-none absolute -bottom-[30%] -top-[30%] left-0 w-[24%]" />

        {propia && (
          <>
            {/* Filo naranja y marca de agua: la firma de la tarjeta propia. */}
            <span aria-hidden="true" className="absolute left-[7cqw] top-0 h-[3px] w-[12.5cqw] rounded-b-[3px] bg-[var(--color-accent)]" />
            <MarcaKiramo
              monocromo
              size={190}
              className="pointer-events-none absolute -right-[6cqw] top-[3cqw] h-[64cqw] w-auto opacity-[0.07]"
            />
          </>
        )}

        <p className="sr-only">{rellenar(t('card_face_aria'), { red: NOMBRE_DE_RED[red], last4: ultimos4 })}</p>

        <div className="relative z-10 flex h-full flex-col p-[6.2cqw]">
          <div className="flex items-start justify-between gap-3">
            {propia ? (
              // El nombre ya lo dice la linea para el lector de pantalla.
              <span aria-hidden="true" className="inline-flex items-center gap-[2.2cqw]">
                <MarcaKiramo size={22} className="h-[6.4cqw] w-auto" />
                <span className="text-[clamp(13px,4.2cqw,18px)] font-semibold tracking-[-0.01em]">KiramoPay</span>
              </span>
            ) : (
              <span className="text-[clamp(11px,3.4cqw,15px)] font-medium text-white/85">
                {tipo === 'physical' ? t('card_tipo_fisica') : t('card_tipo_virtual')}
              </span>
            )}
            {/* Ondas de pago sin contacto; eran las barras de senal de un telefono. */}
            <Icons.Nfc strokeWidth={1.75} className="h-[6.6cqw] w-[6.6cqw] shrink-0 opacity-80" aria-hidden="true" />
          </div>

          <div className="mt-[5cqw] flex items-center justify-between">
            <ChipDeTarjeta className="h-auto w-[12.6cqw]" />
            {/* American Express imprime su codigo de 4 cifras (CID) al frente,
                sobre el numero. La app no lo guarda: se ve oculto. */}
            {red === 'amex' && (
              <span aria-hidden="true" className="font-mono text-[clamp(10px,3.3cqw,14px)] tabular-nums text-white/85">
                CID ••••
              </span>
            )}
          </div>

          <p
            aria-hidden="true"
            className="mt-[3.4cqw] whitespace-nowrap font-mono text-[clamp(15px,5.7cqw,25px)] font-medium tabular-nums tracking-[0.06em] drop-shadow-md"
          >
            {numeroOculto(ultimos4, red)}
          </p>

          <div className="mt-auto flex items-end gap-[4.5cqw]">
            <div className="min-w-0 flex-1">
              <p className="text-[clamp(10px,2.9cqw,12px)] font-medium text-white/85">{t('card_holder')}</p>
              <p className="mt-0.5 truncate text-[clamp(11px,3.7cqw,16px)] font-medium uppercase tracking-[0.06em]">{titular}</p>
            </div>
            {vence && (
              <div className="shrink-0">
                <p className="text-[clamp(10px,2.9cqw,12px)] font-medium text-white/85">{t('card_expiry_label')}</p>
                <p className="mt-0.5 text-[clamp(11px,3.7cqw,16px)] font-medium tabular-nums">{vence}</p>
              </div>
            )}
            <div className="shrink-0 text-right">
              <MarcaDeRed red={red} soloEnApp={t('card_only_in_app')} />
            </div>
          </div>
        </div>

        {congelada && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-[inherit] bg-[var(--color-navy-950)]/80 backdrop-blur-sm">
            <Icons.Lock size={48} className="mb-2 text-white/60" aria-hidden="true" />
            <span className="font-bold tracking-widest text-white/85">{t('card_frozen_label')}</span>
          </div>
        )}
      </div>
    </div>
  );
};

/** Una tarjeta en miniatura para el selector: el mismo fondo de la cara, sin
 *  su sombra (a 22 px solo ensucia). */
export const MiniaturaDeTarjeta: React.FC<{ red: RedDeTarjeta; className?: string }> = ({ red, className = '' }) => (
  <span
    aria-hidden="true"
    data-red={red}
    className={`kp-cara-${red} relative inline-block h-[14px] w-[22px] shrink-0 overflow-hidden rounded-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] ${className}`}
  >
    {red === 'kiramopay' && <span className="absolute left-[3px] top-0 h-[1.5px] w-[6px] bg-[var(--color-accent)]" />}
  </span>
);
