import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Notification } from '@/types';

// Borrar una notificacion la sacaba de la lista sin esperar al servidor y se
// tragaba cualquier rechazo: si el servidor no la ocultaba, la pantalla seguia
// sin mostrarla hasta la siguiente carga, cuando volvia sin explicacion. Ahora,
// si el servidor no la oculta —la rechaza o no hay red—, vuelve a su lugar en
// el acto, sin depender de que la lista se pueda pedir otra vez. Y la que si se
// oculto no vuelve con una lista vieja que llegue despues.

const { api, refrescar } = vi.hoisted(() => ({
  api: { notifications: { delete: vi.fn() } },
  refrescar: vi.fn(),
}));

vi.mock('@/api', () => ({ getApiLayer: () => api }));
// Reimportar useApp volveria a registrar el plugin biometrico de Capacitor,
// que es global: aqui no se usa.
vi.mock('@/services/biometric', () => ({ biometricService: {} }));
vi.mock('@/services/dataSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/dataSync')>()),
  refreshNotifications: refrescar,
}));

const aviso = (id: string, title: string): Notification => ({
  id, title, message: 'x', date: 'Ahora', read: false, type: 'transaction',
});
const primera = aviso('n0', 'Pago recibido');
const segunda = aviso('n1', 'Recarga hecha');
const tercera = aviso('n2', 'Nuevo inicio de sesion');

let urlOriginal: string | undefined;

// useApp decide al importarse si hay servidor (VITE_API_URL): se importa de
// nuevo con la variable puesta.
async function useAppConServidor() {
  vi.resetModules();
  import.meta.env.VITE_API_URL = 'http://localhost:8080';
  const { useApp } = await import('../useApp');
  const { useNotificationStore } = await import('@/stores/notification.store');
  useNotificationStore.setState({ notifications: [primera, segunda, tercera] });
  const ids = () => useNotificationStore.getState().notifications.map((n) => n.id);
  return { useApp, useNotificationStore, ids };
}

beforeEach(() => {
  urlOriginal = import.meta.env.VITE_API_URL;
  api.notifications.delete.mockReset();
  refrescar.mockReset();
});

afterEach(() => {
  if (urlOriginal === undefined) {
    delete (import.meta.env as Record<string, string>).VITE_API_URL;
  } else {
    import.meta.env.VITE_API_URL = urlOriginal;
  }
});

describe('useApp — ocultar una notificacion', { timeout: 20_000 }, () => {
  it('si el servidor la rechaza, vuelve a su lugar y se pide la lista', async () => {
    api.notifications.delete.mockResolvedValue({ success: false, error: { code: 'DELETE_FAILED', message: 'x' } });
    const { useApp, ids } = await useAppConServidor();
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'DELETE_NOTIFICATION', payload: 'n1' }));

    expect(ids()).toEqual(['n0', 'n2']);
    await waitFor(() => expect(ids()).toEqual(['n0', 'n1', 'n2']));
    expect(refrescar).toHaveBeenCalled();
  });

  // Sin red el cliente HTTP no lanza: contesta NETWORK_ERROR. Y la lista
  // tampoco se puede pedir, asi que la notificacion tiene que volver sola.
  it('sin red tambien vuelve en el acto, aunque la lista no se pueda pedir', async () => {
    api.notifications.delete.mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } });
    const { useApp, ids } = await useAppConServidor();
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'DELETE_NOTIFICATION', payload: 'n1' }));

    await waitFor(() => expect(ids()).toEqual(['n0', 'n1', 'n2']));
  });

  it('si el adaptador lanza, tambien vuelve', async () => {
    api.notifications.delete.mockRejectedValue(new Error('inesperado'));
    const { useApp, ids } = await useAppConServidor();
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'DELETE_NOTIFICATION', payload: 'n1' }));

    await waitFor(() => expect(ids()).toEqual(['n0', 'n1', 'n2']));
    expect(refrescar).toHaveBeenCalled();
  });

  it('si el servidor la oculta, no hace falta pedir la lista', async () => {
    api.notifications.delete.mockResolvedValue({ success: true, data: undefined });
    const { useApp, ids } = await useAppConServidor();
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'DELETE_NOTIFICATION', payload: 'n1' }));

    await waitFor(() => expect(api.notifications.delete).toHaveBeenCalledWith('n1'));
    await Promise.resolve();
    expect(refrescar).not.toHaveBeenCalled();
    expect(ids()).toEqual(['n0', 'n2']);
  });

  // Una carga de la lista pedida ANTES de ocultar puede llegar DESPUES, con la
  // notificacion todavia adentro: no la tiene que traer de vuelta.
  it('una lista vieja que llega despues no trae de vuelta la que se oculto', async () => {
    api.notifications.delete.mockResolvedValue({ success: true, data: undefined });
    const { useApp, useNotificationStore, ids } = await useAppConServidor();
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'DELETE_NOTIFICATION', payload: 'n1' }));
    await waitFor(() => expect(api.notifications.delete).toHaveBeenCalled());
    act(() => useNotificationStore.getState().setNotifications([primera, segunda, tercera]));

    expect(ids()).toEqual(['n0', 'n2']);
  });

  it('la que no se pudo ocultar si vuelve con la lista siguiente', async () => {
    api.notifications.delete.mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } });
    const { useApp, useNotificationStore, ids } = await useAppConServidor();
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'DELETE_NOTIFICATION', payload: 'n1' }));
    await waitFor(() => expect(ids()).toEqual(['n0', 'n1', 'n2']));
    act(() => useNotificationStore.getState().setNotifications([segunda]));

    expect(ids()).toEqual(['n1']);
  });
});
