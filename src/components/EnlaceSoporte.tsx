import React from 'react';
import { Icons } from './Icons';
import { CORREO_SOPORTE, ENLACE_SOPORTE } from '@/utils/soporte';

interface EnlaceSoporteProps {
  /** Relleno de color: la accion principal de la pantalla. Sin esto, es un enlace de contorno. */
  destacado?: boolean;
  className?: string;
}

/**
 * El correo de soporte como un enlace grande y tocable: la unica forma de
 * escribirle a una persona del equipo. Abre el programa de correo de la
 * persona (`mailto:`). Se usa en la ayuda y en la hoja de soporte del Perfil.
 */
export const EnlaceSoporte: React.FC<EnlaceSoporteProps> = ({ destacado = false, className = '' }) => (
  <a
    href={ENLACE_SOPORTE}
    className={`flex min-w-0 items-center justify-center gap-2 rounded-xl px-4 py-3.5 font-bold active:scale-[0.98] transition-all uv-focus-ring ${
      destacado
        ? 'bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white uv-shadow-primary'
        : 'uv-surface-2 text-[var(--color-primary)]'
    } ${className}`}
  >
    <Icons.Mail size={18} className="shrink-0" aria-hidden="true" />
    <span className="min-w-0 break-all">{CORREO_SOPORTE}</span>
  </a>
);
