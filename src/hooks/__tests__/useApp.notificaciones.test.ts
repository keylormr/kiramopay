import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// Borrar una notificacion la sacaba de la lista sin esperar al servidor y se
// tragaba cualquier rechazo: si el servidor no la ocultaba, la pantalla seguia
// sin mostrarla hasta la siguiente carga, cuando volvia sin explicacion. Ahora
// hace lo mismo que marcar como leida: si el servidor no la oculta, se vuelve a
// pedir la lista y la notificacion vuelve en el acto.

const { api, refrescar } = vi.hoisted(() => ({
  api: { notifications: { delete: vi.fn() } },
  refrescar: vi.fn(),
}));

vi.mock('@/api', () => ({ getApiLayer: () => api }));
vi.mock('@/services/dataSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/dataSync')>()),
  refreshNotifications: refrescar,
}));

let urlOriginal: string | undefined;

// useApp decide al importarse si hay servidor (VITE_API_URL): se importa de
// nuevo con la variable puesta.
async function useAppConServidor() {
  vi.resetModules();
  import.meta.env.VITE_API_URL = 'http://localhost:8080';
  const { useApp } = await import('../useApp');
  const { useNotificationStore } = await import('@/stores/notification.store');
  useNotificationStore.setState({
    notifications: [
      { id: 'n1', title: 'Pago recibido', message: 'Te pagaron', date: 'Ahora', read: false, type: 'transaction' },
    ],
  });
  return { useApp, useNotificationStore };
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
  it('si el servidor la rechaza, se vuelve a pedir la lista', async () => {
    api.notifications.delete.mockResolvedValue({ success: false, error: { code: 'DELETE_FAILED', message: 'x' } });
    const { useApp, useNotificationStore } = await useAppConServidor();
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'DELETE_NOTIFICATION', payload: 'n1' }));

    expect(useNotificationStore.getState().notifications).toHaveLength(0);
    await waitFor(() => expect(refrescar).toHaveBeenCalled());
  });

  it('si no hay red, tambien se vuelve a pedir la lista', async () => {
    api.notifications.delete.mockRejectedValue(new Error('sin red'));
    const { useApp } = await useAppConServidor();
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'DELETE_NOTIFICATION', payload: 'n1' }));

    await waitFor(() => expect(refrescar).toHaveBeenCalled());
  });

  it('si el servidor la oculta, no hace falta pedir la lista', async () => {
    api.notifications.delete.mockResolvedValue({ success: true, data: undefined });
    const { useApp } = await useAppConServidor();
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'DELETE_NOTIFICATION', payload: 'n1' }));

    await waitFor(() => expect(api.notifications.delete).toHaveBeenCalledWith('n1'));
    await Promise.resolve();
    expect(refrescar).not.toHaveBeenCalled();
  });
});
