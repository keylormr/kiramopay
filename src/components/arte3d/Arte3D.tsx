import React from 'react';
import {
  ICONOS_3D,
  ILUSTRACIONES_3D,
  type Fuentes,
  type NombreIcono3D,
  type NombreIlustracion3D,
} from './catalogo';

/**
 * `srcset` con descriptores de ancho: el navegador elige el archivo justo para
 * el tamano en pantalla y la densidad (40 px en densidad 3 = 120 -> la de 128).
 */
function srcSetDe(fuentes: Fuentes): { src: string; srcSet: string } {
  const anchos = Object.keys(fuentes).map(Number).sort((a, b) => a - b);
  return {
    // La mas chica de respaldo: un navegador sin srcset no baja la grande.
    src: fuentes[anchos[0]],
    srcSet: anchos.map((w) => `${fuentes[w]} ${w}w`).join(', '),
  };
}

interface Icono3DProps {
  nombre: NombreIcono3D;
  /** Lado en px CSS con el que se muestra. */
  tamano: number;
  /**
   * Texto alternativo. Por defecto vacio: casi siempre el icono acompana un
   * texto que ya dice lo mismo (la fila, el boton) y repetirlo solo suma ruido
   * al lector de pantalla.
   */
  alt?: string;
  className?: string;
}

export const Icono3D: React.FC<Icono3DProps> = ({ nombre, tamano, alt = '', className = '' }) => {
  const { src, srcSet } = srcSetDe(ICONOS_3D[nombre]);
  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={`${tamano}px`}
      width={tamano}
      height={tamano}
      alt={alt}
      aria-hidden={alt === '' ? true : undefined}
      loading="lazy"
      decoding="async"
      draggable={false}
      data-arte3d={nombre}
      className={`select-none ${className}`}
    />
  );
};

interface Ilustracion3DProps {
  nombre: NombreIlustracion3D;
  /** Lado en px CSS (las ilustraciones son cuadradas). */
  tamano: number;
  alt?: string;
  className?: string;
  /** La de un estado que aparece de golpe (enviado, pagado) no espera al scroll. */
  prioritaria?: boolean;
}

export const Ilustracion3D: React.FC<Ilustracion3DProps> = ({
  nombre,
  tamano,
  alt = '',
  className = '',
  prioritaria = false,
}) => {
  const { src, srcSet } = srcSetDe(ILUSTRACIONES_3D[nombre]);
  return (
    <img
      src={src}
      srcSet={srcSet}
      sizes={`${tamano}px`}
      width={tamano}
      height={tamano}
      alt={alt}
      aria-hidden={alt === '' ? true : undefined}
      loading={prioritaria ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      data-arte3d={nombre}
      className={`select-none ${className}`}
    />
  );
};
