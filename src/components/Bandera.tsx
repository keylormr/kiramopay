import React from 'react';

/**
 * Banderas como SVG en linea.
 *
 * Windows no trae glifos para los emojis de bandera: el de Costa Rica se ve como
 * las dos letras "CR", y el selector de idioma, las cuentas y las monedas del
 * cobro mostraban "CR", "US", "FR"... Aqui cada bandera es un dibujo, sin tipografia y
 * sin pedir nada a un CDN (la app tambien corre sin red).
 *
 * Los datos de la app guardan la bandera como emoji (el idioma, la cuenta, el
 * pais del backend): el componente acepta ese emoji o el codigo del pais ISO
 * ("CR"). Lo que no es una bandera —el edificio de una cuenta sin pais, el
 * circulo de una moneda cripto— se escribe tal cual, que esos emojis si se ven.
 *
 * Son aproximaciones a 24 px, no escudos: lo justo para reconocer el pais.
 */

const INDICADOR_REGIONAL_A = 0x1f1e6;

/**
 * El codigo ISO de un pais a partir de lo que traen los datos: el emoji de la
 * bandera (dos indicadores regionales) o el codigo de dos letras. Null si no es
 * una bandera.
 */
export function codigoDePais(valor: string): string | null {
  const texto = valor.trim();
  if (/^[A-Za-z]{2}$/.test(texto)) return texto.toUpperCase();
  const puntos = [...texto].map((c) => c.codePointAt(0) ?? 0);
  if (puntos.length === 2 && puntos.every((p) => p >= INDICADOR_REGIONAL_A && p <= INDICADOR_REGIONAL_A + 25)) {
    return puntos.map((p) => String.fromCharCode(65 + p - INDICADOR_REGIONAL_A)).join('');
  }
  return null;
}

// Estrella de cinco puntas con punta hacia arriba, como la de cada bandera.
function estrella(cx: number, cy: number, radio: number): string {
  const interior = radio * 0.382;
  const puntos: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? radio : interior;
    const angulo = (-90 + i * 36) * (Math.PI / 180);
    puntos.push(`${(cx + r * Math.cos(angulo)).toFixed(2)},${(cy + r * Math.sin(angulo)).toFixed(2)}`);
  }
  return puntos.join(' ');
}

// Los dibujos usan un lienzo de 30 x 20 (3:2), el de casi todas las banderas.
const BANDERAS: Record<string, () => React.ReactNode> = {
  CR: () => (
    <>
      <rect width="30" height="20" fill="#002B7F" />
      <rect y="3.33" width="30" height="13.34" fill="#FFFFFF" />
      <rect y="6.67" width="30" height="6.66" fill="#CE1126" />
    </>
  ),
  US: () => (
    <>
      <rect width="30" height="20" fill="#FFFFFF" />
      {[0, 2, 4, 6, 8, 10, 12].map((i) => (
        <rect key={i} y={(i * 20) / 13} width="30" height={20 / 13} fill="#B22234" />
      ))}
      <rect width="12" height={(7 * 20) / 13} fill="#3C3B6E" />
      {[0, 1, 2, 3, 4].flatMap((fila) =>
        [0, 1, 2, 3].map((col) => (
          <circle key={`${fila}-${col}`} cx={1.8 + col * 2.8 + (fila % 2 ? 1.4 : 0)} cy={1.5 + fila * 1.8} r="0.5" fill="#FFFFFF" />
        )),
      )}
    </>
  ),
  FR: () => (
    <>
      <rect width="10" height="20" fill="#0055A4" />
      <rect x="10" width="10" height="20" fill="#FFFFFF" />
      <rect x="20" width="10" height="20" fill="#EF4135" />
    </>
  ),
  BR: () => (
    <>
      <rect width="30" height="20" fill="#009C3B" />
      <polygon points="15,2 27.5,10 15,18 2.5,10" fill="#FFDF00" />
      <circle cx="15" cy="10" r="4.8" fill="#002776" />
      <path d="M10.4 9.2 Q15 7.4 19.6 11" stroke="#FFFFFF" strokeWidth="0.9" fill="none" />
    </>
  ),
  CN: () => (
    <>
      <rect width="30" height="20" fill="#DE2910" />
      <polygon points={estrella(5, 5.2, 3)} fill="#FFDE00" />
      <polygon points={estrella(10, 2, 1)} fill="#FFDE00" />
      <polygon points={estrella(12, 4, 1)} fill="#FFDE00" />
      <polygon points={estrella(12, 7, 1)} fill="#FFDE00" />
      <polygon points={estrella(10, 9, 1)} fill="#FFDE00" />
    </>
  ),
  JP: () => (
    <>
      <rect width="30" height="20" fill="#FFFFFF" />
      <circle cx="15" cy="10" r="6" fill="#BC002D" />
    </>
  ),
  IN: () => (
    <>
      <rect width="30" height="6.67" fill="#FF9933" />
      <rect y="6.67" width="30" height="6.66" fill="#FFFFFF" />
      <rect y="13.33" width="30" height="6.67" fill="#138808" />
      <circle cx="15" cy="10" r="2.6" fill="none" stroke="#000080" strokeWidth="0.4" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 15 * Math.PI) / 180;
        return (
          <line
            key={i}
            x1={15 + 2.6 * Math.cos(a)}
            y1={10 + 2.6 * Math.sin(a)}
            x2={15 - 2.6 * Math.cos(a)}
            y2={10 - 2.6 * Math.sin(a)}
            stroke="#000080"
            strokeWidth="0.2"
          />
        );
      })}
    </>
  ),
  PA: () => (
    <>
      <rect width="30" height="20" fill="#FFFFFF" />
      <rect x="15" width="15" height="10" fill="#D21034" />
      <rect y="10" width="15" height="10" fill="#005293" />
      <polygon points={estrella(7.5, 5.2, 3)} fill="#005293" />
      <polygon points={estrella(22.5, 15.2, 3)} fill="#D21034" />
    </>
  ),
  GT: () => (
    <>
      <rect width="10" height="20" fill="#4997D0" />
      <rect x="10" width="10" height="20" fill="#FFFFFF" />
      <rect x="20" width="10" height="20" fill="#4997D0" />
      <circle cx="15" cy="10" r="2.8" fill="none" stroke="#5E8B3A" strokeWidth="0.9" />
      <circle cx="15" cy="10" r="0.9" fill="#E8C547" />
    </>
  ),
};

/** Si la app sabe dibujar la bandera de ese pais (emoji o codigo). */
export function banderaConocida(valor: string): boolean {
  const codigo = codigoDePais(valor);
  return codigo !== null && codigo in BANDERAS;
}

interface BanderaProps {
  /** El emoji de la bandera o el codigo ISO del pais ("CR"). */
  pais: string;
  /** Nombre accesible. Sin el la bandera es decoracion: el nombre del pais o del idioma ya esta al lado. */
  titulo?: string;
  className?: string;
}

export const Bandera: React.FC<BanderaProps> = ({ pais, titulo, className = '' }) => {
  const codigo = codigoDePais(pais);
  // Lo que no es una bandera (🏦, 🟠...) se escribe tal cual.
  if (codigo === null) return <span className={className}>{pais}</span>;

  const dibujo = BANDERAS[codigo];
  const accesible = titulo ? { role: 'img' as const, 'aria-label': titulo } : { 'aria-hidden': true as const };
  return (
    <svg
      data-pais={codigo}
      viewBox="0 0 30 20"
      width="1.5em"
      height="1em"
      className={`inline-block shrink-0 rounded-[3px] ring-1 ring-black/10 align-[-0.125em] ${className}`.trim()}
      {...accesible}
    >
      {dibujo ? dibujo() : <rect width="30" height="20" fill="#CBD5E1" />}
    </svg>
  );
};
