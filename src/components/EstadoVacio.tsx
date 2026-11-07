import React from 'react';
import { Icono3D, Ilustracion3D } from '@/components/arte3d/Arte3D';
import type { NombreIcono3D, NombreIlustracion3D } from '@/components/arte3d/catalogo';

// Estado vacio del rediseno: el arte 3D, un titulo corto y, si hace falta, una
// linea que dice que hacer y la accion para hacerlo. Es el mismo dibujo que ya
// usaban Movimientos y Tarjetas, en un solo lugar para que todas las pantallas
// vacias se vean igual.
//
// Lleva una ilustracion (las de "sin ..." del paquete) o, donde el paquete no
// trae ilustracion para ese tema, un icono 3D sobre una placa de vidrio.

type Arte =
  | { ilustracion: NombreIlustracion3D; icono?: never }
  | { icono: NombreIcono3D; ilustracion?: never };

type EstadoVacioProps = Arte & {
  titulo: string;
  descripcion?: string;
  /** Lado de la ilustracion en px (el icono va siempre a 56 px en su placa). */
  tamano?: number;
  /** Nivel del titulo: h2 en una pantalla, h3 dentro de una seccion, p en una hoja. */
  comoTitulo?: 'h2' | 'h3' | 'p';
  /** Botones o enlaces debajo del texto. */
  children?: React.ReactNode;
  className?: string;
};

export const EstadoVacio: React.FC<EstadoVacioProps> = ({
  ilustracion,
  icono,
  titulo,
  descripcion,
  tamano = 136,
  comoTitulo: Titulo = 'h3',
  children,
  className = '',
}) => (
  <div className={`flex flex-col items-center px-6 py-10 text-center ${className}`}>
    {ilustracion ? (
      <Ilustracion3D nombre={ilustracion} tamano={tamano} className="kp-aparece" />
    ) : (
      <div className="kp-aparece flex h-24 w-24 items-center justify-center rounded-[28px] bg-[var(--color-surface-2)] shadow-[inset_0_0_0_1px_var(--color-border-strong)] dark:bg-[var(--color-surface-2-dark)] dark:shadow-[inset_0_0_0_1px_var(--color-border-strong-dark)]">
        <Icono3D nombre={icono as NombreIcono3D} tamano={56} />
      </div>
    )}
    <Titulo className="mt-3 text-lg font-semibold uv-text-primary">{titulo}</Titulo>
    {descripcion && <p className="mt-1.5 max-w-[22rem] text-sm leading-relaxed uv-text-secondary">{descripcion}</p>}
    {children && <div className="mt-6 flex w-full max-w-[22rem] flex-col items-stretch gap-3">{children}</div>}
  </div>
);
