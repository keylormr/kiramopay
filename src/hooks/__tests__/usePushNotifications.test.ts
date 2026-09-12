import { renderHook, act, waitFor } from '@testing-library/react';
import { useAuthStore } from '@/stores/auth.store';
import type { User } from '@/types';

// El gancho viejo no lo usaba nadie, y su prueba afirmaba cosas del entorno de
// pruebas en lugar del gancho. Este es el estado del interruptor de Perfil: la
// logica de la suscripcion se prueba en utils/__tests__/avisosPush.test.ts.

const avisos = vi.hoisted(() => ({
  soportado: true,
  leerEstadoAvisos: vi.fn(),
  activarAvisos: vi.fn(),
  desactivarAvisos: vi.fn(),
}));

vi.mock('@/utils/avisosPush', () => ({
  avisosSoportados: () => avisos.soportado,
  leerEstadoAvisos: avisos.leerEstadoAvisos,
  activarAvisos: avisos.activarAvisos,
  desactivarAvisos: avisos.desactivarAvisos,
}));

const { usePushNotifications } = await import('../usePushNotifications');

describe('usePushNotifications', () => {
  beforeEach(() => {
    avisos.soportado = true;
    vi.clearAllMocks();
    avisos.leerEstadoAvisos.mockResolvedValue({ estado: 'inactivo', clave: 'CLAVE' });
    useAuthStore.setState({ user: { id: 'u1' } as User });
  });

  afterEach(() => {
    useAuthStore.setState({ user: null });
  });

  it('sin Push API no consulta nada y queda en no_soportado', () => {
    avisos.soportado = false;
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.estado).toBe('no_soportado');
    expect(avisos.leerEstadoAvisos).not.toHaveBeenCalled();
  });

  it('lee el estado de la cuenta en sesion', async () => {
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.estado).toBe('cargando');
    await waitFor(() => expect(result.current.estado).toBe('inactivo'));
    expect(avisos.leerEstadoAvisos).toHaveBeenCalledWith('u1');
  });

  it('activa con la clave ya leida, sin volver a esperar al servidor', async () => {
    avisos.activarAvisos.mockResolvedValue('activo');
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.estado).toBe('inactivo'));

    await act(async () => {
      await result.current.alternar();
    });
    expect(avisos.activarAvisos).toHaveBeenCalledWith('CLAVE', 'u1');
    expect(result.current.estado).toBe('activo');
    expect(result.current.fallo).toBe(false);
  });

  it('desactiva cuando esta activo', async () => {
    avisos.leerEstadoAvisos.mockResolvedValue({ estado: 'activo', clave: 'CLAVE' });
    avisos.desactivarAvisos.mockResolvedValue('inactivo');
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.estado).toBe('activo'));

    await act(async () => {
      await result.current.alternar();
    });
    expect(avisos.desactivarAvisos).toHaveBeenCalledTimes(1);
    expect(result.current.estado).toBe('inactivo');
  });

  it('un fallo se muestra y no cambia el estado', async () => {
    avisos.activarAvisos.mockResolvedValue('fallo');
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.estado).toBe('inactivo'));

    await act(async () => {
      await result.current.alternar();
    });
    expect(result.current.fallo).toBe(true);
    expect(result.current.estado).toBe('inactivo');
  });

  it('con el permiso bloqueado el interruptor no hace nada', async () => {
    avisos.leerEstadoAvisos.mockResolvedValue({ estado: 'bloqueado', clave: 'CLAVE' });
    const { result } = renderHook(() => usePushNotifications());
    await waitFor(() => expect(result.current.estado).toBe('bloqueado'));

    await act(async () => {
      await result.current.alternar();
    });
    expect(avisos.activarAvisos).not.toHaveBeenCalled();
    expect(avisos.desactivarAvisos).not.toHaveBeenCalled();
  });
});
