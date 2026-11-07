import React from 'react';

/**
 * Logos de criptomonedas con sus marcas oficiales, en SVG en linea (sin CDN:
 * la app tambien corre sin red).
 *
 * - Bitcoin: el logo de Bitcoin.svg de Wikimedia Commons (dominio publico), la
 *   moneda naranja #F7931A con el simbolo blanco. Geometria sin tocar.
 * - Ethereum: el diamante "ETH diamond (purple)" de ethereum.org/assets, con
 *   sus seis caras y sus tres tonos originales. Va sobre un disco claro porque
 *   las caras oscuras (#454A75) se pierden sobre el fondo medianoche.
 *
 * Una moneda sin logo aqui devuelve null: quien lo usa decide el respaldo.
 */

export type MonedaConLogo = 'BTC' | 'ETH';

const LOGOS: Record<MonedaConLogo, () => React.ReactNode> = {
  BTC: () => (
    <svg viewBox="0 0 64 64">
      <g transform="translate(0.00630876,-0.00301984)">
        <path
          fill="#F7931A"
          d="m63.033,39.744c-4.274,17.143-21.637,27.576-38.782,23.301-17.138-4.274-27.571-21.638-23.295-38.78,4.272-17.145,21.635-27.579,38.775-23.305,17.144,4.274,27.576,21.64,23.302,38.784z"
        />
        <path
          fill="#FFFFFF"
          d="m46.103,27.444c0.637-4.258-2.605-6.547-7.038-8.074l1.438-5.768-3.511-0.875-1.4,5.616c-0.923-0.23-1.871-0.447-2.813-0.662l1.41-5.653-3.509-0.875-1.439,5.766c-0.764-0.174-1.514-0.346-2.242-0.527l0.004-0.018-4.842-1.209-0.934,3.75s2.605,0.597,2.55,0.634c1.422,0.355,1.679,1.296,1.636,2.042l-1.638,6.571c0.098,0.025,0.225,0.061,0.365,0.117-0.117-0.029-0.242-0.061-0.371-0.092l-2.296,9.205c-0.174,0.432-0.615,1.08-1.609,0.834,0.035,0.051-2.552-0.637-2.552-0.637l-1.743,4.019,4.569,1.139c0.85,0.213,1.683,0.436,2.503,0.646l-1.453,5.834,3.507,0.875,1.439-5.772c0.958,0.26,1.888,0.5,2.798,0.726l-1.434,5.745,3.511,0.875,1.453-5.823c5.987,1.133,10.489,0.676,12.384-4.739,1.527-4.36-0.076-6.875-3.226-8.515,2.294-0.529,4.022-2.038,4.483-5.155zm-8.022,11.249c-1.085,4.36-8.426,2.003-10.806,1.412l1.928-7.729c2.38,0.594,10.012,1.77,8.878,6.317zm1.086-11.312c-0.99,3.966-7.1,1.951-9.082,1.457l1.748-7.01c1.982,0.494,8.365,1.416,7.334,5.553z"
        />
      </g>
    </svg>
  ),
  ETH: () => (
    <svg viewBox="0 0 1920 1920">
      <circle cx="960" cy="960" r="960" fill="#ECEFFB" />
      {/* El diamante oficial ocupa ~92 % de su lienzo; se reduce para que
          respire dentro del disco, igual que la moneda de Bitcoin. */}
      <g transform="translate(960 960) scale(0.62) translate(-960 -960)">
        <path d="m959.8 80.7-539.7 895.6 539.7-245.3z" fill="#8A92B2" />
        <path d="m959.8 731-539.7 245.3 539.7 319.1z" fill="#62688F" />
        <path d="m1499.6 976.3-539.8-895.6v650.3z" fill="#62688F" />
        <path d="m959.8 1295.4 539.8-319.1-539.8-245.3z" fill="#454A75" />
        <path d="m420.1 1078.7 539.7 760.6v-441.7z" fill="#8A92B2" />
        <path d="m959.8 1397.6v441.7l540.1-760.6z" fill="#62688F" />
      </g>
    </svg>
  ),
};

export function tieneLogoCripto(simbolo: string): simbolo is MonedaConLogo {
  return simbolo in LOGOS;
}

interface LogoCriptoProps {
  simbolo: string;
  /** Lado en px. */
  size?: number;
  /** Nombre accesible. Sin el, el logo es decoracion (el nombre ya esta al lado). */
  titulo?: string;
  className?: string;
}

export const LogoCripto: React.FC<LogoCriptoProps> = ({ simbolo, size = 24, titulo, className = '' }) => {
  if (!tieneLogoCripto(simbolo)) return null;
  const accesible = titulo ? { role: 'img' as const, 'aria-label': titulo } : { 'aria-hidden': true as const };
  return (
    <span
      data-cripto={simbolo}
      className={`inline-flex shrink-0 [&>svg]:h-full [&>svg]:w-full ${className}`.trim()}
      style={{ width: size, height: size }}
      {...accesible}
    >
      {LOGOS[simbolo]()}
    </span>
  );
};
