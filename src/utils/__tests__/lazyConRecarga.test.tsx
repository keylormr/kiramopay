import React, { Suspense } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lazyConRecarga } from '../lazyConRecarga';

const CLAVE = 'kiramopay-recarga-por-chunk';

// jsdom no permite espiar location.reload directamente; se reemplaza el
// objeto entero por uno equivalente con el reload espiado.
function espiarReload() {
  const reload = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload },
    writable: true,
  });
  return reload;
}

class Contenedor extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? <div>fallo definitivo</div> : this.props.children;
  }
}

describe('lazyConRecarga', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('recarga la pagina una vez cuando el chunk no llega', async () => {
    const reload = espiarReload();
    const Vista = lazyConRecarga(() =>
      Promise.reject(new Error('Failed to fetch dynamically imported module'))
    );

    render(
      <Suspense fallback={<div>cargando</div>}>
        <Vista />
      </Suspense>
    );

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(CLAVE)).toBe('1');
    // Mientras la recarga corre, el usuario sigue viendo el fallback, no un error.
    expect(screen.getByText('cargando')).toBeTruthy();
  });

  it('si ya recargo una vez, deja subir el error en vez de entrar en bucle', async () => {
    const reload = espiarReload();
    sessionStorage.setItem(CLAVE, '1');
    const Vista = lazyConRecarga(() => Promise.reject(new Error('sigue sin llegar')));

    // El error boundary de la app es quien lo muestra; aca uno minimo.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <Contenedor>
        <Suspense fallback={<div>cargando</div>}>
          <Vista />
        </Suspense>
      </Contenedor>
    );

    await waitFor(() => expect(screen.getByText('fallo definitivo')).toBeTruthy());
    expect(reload).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('un import que funciona rearma la guardia para el proximo deploy', async () => {
    espiarReload();
    sessionStorage.setItem(CLAVE, '1');
    const Vista = lazyConRecarga(() =>
      Promise.resolve({ default: () => <div>vista lista</div> })
    );

    render(
      <Suspense fallback={<div>cargando</div>}>
        <Vista />
      </Suspense>
    );

    await waitFor(() => expect(screen.getByText('vista lista')).toBeTruthy());
    expect(sessionStorage.getItem(CLAVE)).toBeNull();
  });
});
