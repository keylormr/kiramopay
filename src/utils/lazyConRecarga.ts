import React from 'react';

// Marca de "ya recargué una vez" para no entrar en bucle si la recarga
// tampoco encuentra el chunk (p. ej. sin red).
const CLAVE_RECARGA = 'kiramopay-recarga-por-chunk';

function leerMarca(): boolean {
  try {
    return sessionStorage.getItem(CLAVE_RECARGA) === '1';
  } catch {
    return false;
  }
}

function escribirMarca(valor: boolean): void {
  try {
    if (valor) sessionStorage.setItem(CLAVE_RECARGA, '1');
    else sessionStorage.removeItem(CLAVE_RECARGA);
  } catch {
    // sin sessionStorage no hay guardia: preferible no recargar en bucle,
    // asi que el catch de abajo relanza el error a la ErrorBoundary.
  }
}

/**
 * React.lazy que sobrevive a los deploys.
 *
 * Cada deploy de Vercel cambia los hashes de los chunks y borra los viejos;
 * una sesion abierta que navega a una vista perezosa pide un archivo que ya
 * no existe y el import dinamico revienta ("Failed to fetch dynamically
 * imported module"). La recarga trae el index.html nuevo con los chunks
 * vigentes, asi que ese fallo se resuelve recargando UNA vez. Si tras la
 * recarga sigue fallando (sin red, por ejemplo), el error sube a la
 * ErrorBoundary como siempre.
 */
// La firma calca la de React.lazy, incluido su `any`: con `unknown` los
// componentes con props dejan de tipar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyConRecarga<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(() =>
    factory().then(
      (modulo) => {
        // Un import que funciona rearma la guardia para el proximo deploy.
        escribirMarca(false);
        return modulo;
      },
      (error: unknown) => {
        if (leerMarca()) {
          throw error;
        }
        escribirMarca(true);
        window.location.reload();
        // La recarga esta en curso: dejar el Suspense mostrando el skeleton
        // en vez de parpadear la pantalla de error.
        return new Promise<{ default: T }>(() => {});
      }
    )
  );
}
