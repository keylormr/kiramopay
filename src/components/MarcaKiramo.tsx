import React from 'react';

// Marca de KiramoPay: la K como cinta doblada con el remate naranja, la misma
// geometria del icono de launcher (icon.svg) para que la app y el telefono
// muestren un solo simbolo. Solo la capa del frente: el fondo lo pone el
// contenedor (uv-gradient-brand). Colores planos a proposito: a 24-40 px los
// degradados del icono no aportan y el trazo se ve mas nitido.
// El viewBox recorta la caja util de la marca (x 150-372, y 112-400 en el
// lienzo de 512) con un margen parejo, asi el simbolo llena el contenedor.
interface MarcaKiramoProps {
  /** Tamano del contenedor en px; la marca ocupa ~62% (como en el icono). */
  size?: number;
  className?: string;
}

export const MarcaKiramo: React.FC<MarcaKiramoProps> = ({ size = 28, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="136 98 250 316"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <polygon points="178.5,256 322.3,112.3 371.7,161.7 277.5,256 371.7,350.3 322.3,399.7" fill="#FFFFFF" />
    <polygon points="261.4,173.1 322.3,112.3 371.7,161.7 310.9,222.6" fill="#FF8A2B" />
    <polygon points="220,214.5 236,198.5 236,313.5 220,297.5" fill="#DCE6F5" />
    <rect x="150" y="137" width="70" height="238" fill="#FFFFFF" />
  </svg>
);
