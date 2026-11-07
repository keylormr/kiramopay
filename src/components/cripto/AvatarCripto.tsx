import React from 'react';
import { LogoCripto, tieneLogoCripto } from '@/components/LogoCripto';

// La cara de una criptomoneda en las listas y hojas de Cripto. BTC y ETH llevan
// su logo oficial (LogoCripto). Las demas no tienen todavia un logo con licencia
// verificada en el repo: van en un disco con su color de marca y su glifo (el
// mismo dato del catalogo), con un brillo de vidrio para que no parezca un
// circulo plano junto a los logos de verdad. Siempre decorativo: el nombre de
// la moneda va al lado.

interface AvatarCriptoProps {
  simbolo: string;
  /** Color de marca del catalogo (#F7931A...). */
  color?: string;
  /** Glifo del catalogo (₿, Ξ, ◎...). Sin glifo, la primera letra del simbolo. */
  icono?: string;
  /** Lado en px. */
  tamano?: number;
  className?: string;
}

export const AvatarCripto: React.FC<AvatarCriptoProps> = ({ simbolo, color, icono, tamano = 44, className = '' }) => {
  if (tieneLogoCripto(simbolo)) {
    return <LogoCripto simbolo={simbolo} size={tamano} className={className} />;
  }
  const glifo = (icono && icono.trim()) || simbolo.slice(0, 1);
  return (
    <span
      aria-hidden="true"
      data-cripto={simbolo}
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),inset_0_0_0_1px_rgba(255,255,255,0.12)] ${className}`}
      style={{
        width: tamano,
        height: tamano,
        fontSize: Math.round(tamano * 0.44),
        background: `radial-gradient(120% 120% at 30% 20%, rgba(255,255,255,0.22), rgba(255,255,255,0) 55%), ${color || '#33415C'}`,
      }}
    >
      {glifo}
    </span>
  );
};
