import React from 'react';
import { CORREO_SOPORTE, ENLACE_SOPORTE } from '@/utils/soporte';

interface TextoConCorreoProps {
  /** Una frase de los idiomas que puede llevar el correo de soporte dentro. */
  texto: string;
  className?: string;
}

/**
 * Pinta una frase y vuelve enlace `mailto:` la direccion de soporte que lleve
 * dentro ("Escribe a soporte@kiramopay.com."): quien la lee la toca en vez de
 * copiarla. El resto de la frase queda intacto; el enlace hereda el color del
 * texto que lo rodea (un aviso rojo, un fondo oscuro) y se distingue por el
 * subrayado. Va dentro de un <span>, asi funciona tambien dentro de un
 * contenedor flex sin partir la frase en columnas.
 */
export const TextoConCorreo: React.FC<TextoConCorreoProps> = ({ texto, className }) => {
  const partes = texto.split(CORREO_SOPORTE);
  return (
    <span className={className}>
      {partes.map((parte, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <a
              href={ENLACE_SOPORTE}
              className="font-semibold underline underline-offset-2 rounded-sm uv-focus-ring"
            >
              {CORREO_SOPORTE}
            </a>
          )}
          {parte}
        </React.Fragment>
      ))}
    </span>
  );
};
