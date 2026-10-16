import { useEffect, useRef } from 'react';

interface ErrorALaVistaProps {
  mensaje: string;
  className?: string;
}

/**
 * El error de una hoja: se anuncia (role="alert") y, cada vez que aparece o
 * cambia, se lleva a la vista. En un telefono chico el error de una hoja larga
 * quedaba al fondo, fuera de la pantalla, y la persona tocaba el boton sin
 * enterarse de que habia pasado algo.
 */
export function ErrorALaVista({ mensaje, className }: ErrorALaVistaProps) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // 'nearest' desplaza lo minimo, y solo si hace falta.
    if (mensaje) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [mensaje]);

  if (!mensaje) return null;
  return (
    <p ref={ref} role="alert" className={className}>
      {mensaje}
    </p>
  );
}
