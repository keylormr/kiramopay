import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// El plugin de la pantalla segura, simulado con el mismo truco del almacen: el
// Proxy que devuelve registerPlugin de Capacitor responde a CUALQUIER propiedad,
// "then" incluida, y esa llamada nunca resuelve. Si pantalla.ts devolviera el
// plugin desde una funcion async o le hiciera await, todas estas pruebas se
// colgarian.
const nativo = vi.hoisted(() => {
  const metodos = { activar: vi.fn(), desactivar: vi.fn() };
  const proxy = new Proxy({}, {
    get: (_blanco, propiedad) => (
      propiedad === 'then'
        ? (_resolver: unknown, _rechazar: unknown) => undefined
        : metodos[propiedad as keyof typeof metodos]
    ),
  });
  return { metodos, proxy, esNativa: true };
});
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => nativo.esNativa },
  registerPlugin: () => nativo.proxy,
}));

import { protegerPantalla, usePantallaSegura } from '../pantalla';

/** Una llamada colgada no lanza nada: sin este limite la prueba esperaria hasta el tiempo maximo. */
function conLimite<T>(operacion: Promise<T>): Promise<T> {
  return Promise.race([
    operacion,
    new Promise<never>((_resolver, rechazar) => setTimeout(() => rechazar(new Error('se colgo esperando al plugin')), 400)),
  ]);
}

beforeEach(() => {
  nativo.esNativa = true;
  nativo.metodos.activar.mockReset().mockResolvedValue(undefined);
  nativo.metodos.desactivar.mockReset().mockResolvedValue(undefined);
});

describe('proteger la pantalla del telefono', () => {
  it('prende al pedirla y apaga al soltarla, sin colgarse con el Proxy de Capacitor', async () => {
    const soltar = await conLimite(protegerPantalla());
    expect(nativo.metodos.activar).toHaveBeenCalledTimes(1);
    expect(nativo.metodos.desactivar).not.toHaveBeenCalled();

    soltar();
    await waitFor(() => expect(nativo.metodos.desactivar).toHaveBeenCalledTimes(1));
  });

  it('varias pantallas la comparten: se apaga cuando se suelta la ultima', async () => {
    const primera = await conLimite(protegerPantalla());
    const segunda = await conLimite(protegerPantalla());
    expect(nativo.metodos.activar).toHaveBeenCalledTimes(1);

    primera();
    primera(); // soltar dos veces la misma no cuenta dos veces
    await new Promise(r => setTimeout(r, 20));
    expect(nativo.metodos.desactivar).not.toHaveBeenCalled();

    segunda();
    await waitFor(() => expect(nativo.metodos.desactivar).toHaveBeenCalledTimes(1));
  });

  it('si el telefono no puede protegerla, falla y no deja nada prendido', async () => {
    nativo.metodos.activar.mockRejectedValue(new Error('"PantallaSegura" plugin is not implemented on android'));
    await expect(conLimite(protegerPantalla())).rejects.toThrow('not implemented');
    await new Promise(r => setTimeout(r, 20));
    expect(nativo.metodos.desactivar).not.toHaveBeenCalled();

    // Despues de un fallo se puede volver a intentar.
    nativo.metodos.activar.mockResolvedValue(undefined);
    const soltar = await conLimite(protegerPantalla());
    expect(nativo.metodos.activar).toHaveBeenCalledTimes(2);
    soltar();
    await waitFor(() => expect(nativo.metodos.desactivar).toHaveBeenCalledTimes(1));
  });

  it('en la web no hace nada', async () => {
    nativo.esNativa = false;
    const soltar = await conLimite(protegerPantalla());
    soltar();
    expect(nativo.metodos.activar).not.toHaveBeenCalled();
    expect(nativo.metodos.desactivar).not.toHaveBeenCalled();
  });
});

describe('usePantallaSegura', () => {
  it('no cuenta como protegida hasta que el plugin contesta', async () => {
    let contestar: () => void = () => undefined;
    nativo.metodos.activar.mockReturnValue(new Promise<void>(r => { contestar = r; }));
    const { result, unmount } = renderHook(() => usePantallaSegura(true));
    expect(result.current).toBe('comprobando');

    await act(async () => { contestar(); });
    await waitFor(() => expect(result.current).toBe('protegida'));

    unmount();
    await waitFor(() => expect(nativo.metodos.desactivar).toHaveBeenCalledTimes(1));
  });

  it('si se desmonta antes de que el plugin conteste, suelta la proteccion cuando contesta', async () => {
    let contestar: () => void = () => undefined;
    nativo.metodos.activar.mockReturnValue(new Promise<void>(r => { contestar = r; }));
    const { unmount } = renderHook(() => usePantallaSegura(true));
    unmount();
    expect(nativo.metodos.desactivar).not.toHaveBeenCalled();

    await act(async () => { contestar(); });
    // Sin esto la proteccion quedaria prendida para siempre (FLAG_SECURE de por vida).
    await waitFor(() => expect(nativo.metodos.desactivar).toHaveBeenCalledTimes(1));
  });

  it('si se vuelve a pedir mientras se apaga, no se apaga debajo de quien la pide', async () => {
    const primera = await conLimite(protegerPantalla());
    let apagado: () => void = () => undefined;
    nativo.metodos.desactivar.mockReturnValueOnce(new Promise<void>(r => { apagado = r; }));
    primera(); // empieza a apagarse y todavia no termina
    await waitFor(() => expect(nativo.metodos.desactivar).toHaveBeenCalledTimes(1));

    const segunda = protegerPantalla();
    apagado();
    const soltar = await conLimite(segunda);
    // Se apago y se volvio a prender, en ese orden: la ultima palabra es 'prendida'.
    expect(nativo.metodos.activar).toHaveBeenCalledTimes(2);
    expect(nativo.metodos.desactivar).toHaveBeenCalledTimes(1);

    soltar();
    await waitFor(() => expect(nativo.metodos.desactivar).toHaveBeenCalledTimes(2));
  });

  it('un telefono sin el plugin queda en sin-proteccion', async () => {
    nativo.metodos.activar.mockRejectedValue(new Error('not implemented'));
    const { result, unmount } = renderHook(() => usePantallaSegura(true));
    await waitFor(() => expect(result.current).toBe('sin-proteccion'));
    unmount();
    expect(nativo.metodos.desactivar).not.toHaveBeenCalled();
  });

  it('solo protege mientras esta activa, y al volver a activarla la pide de nuevo', async () => {
    const { result, rerender, unmount } = renderHook(({ activa }) => usePantallaSegura(activa), { initialProps: { activa: false } });
    expect(result.current).toBe('inactiva');
    expect(nativo.metodos.activar).not.toHaveBeenCalled();

    rerender({ activa: true });
    expect(result.current).toBe('comprobando');
    await waitFor(() => expect(result.current).toBe('protegida'));

    rerender({ activa: false });
    expect(result.current).toBe('inactiva');
    await waitFor(() => expect(nativo.metodos.desactivar).toHaveBeenCalledTimes(1));

    // La segunda vez no hereda el 'protegida' de la primera: vuelve a comprobar.
    rerender({ activa: true });
    expect(result.current).toBe('comprobando');
    await waitFor(() => expect(result.current).toBe('protegida'));
    expect(nativo.metodos.activar).toHaveBeenCalledTimes(2);

    unmount();
    await waitFor(() => expect(nativo.metodos.desactivar).toHaveBeenCalledTimes(2));
  });

  it('en la web se da por protegida sin tocar el plugin', () => {
    nativo.esNativa = false;
    const { result } = renderHook(() => usePantallaSegura(true));
    expect(result.current).toBe('protegida');
    expect(nativo.metodos.activar).not.toHaveBeenCalled();
  });
});
