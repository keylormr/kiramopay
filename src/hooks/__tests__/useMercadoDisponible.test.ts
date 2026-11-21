import { renderHook, waitFor } from '@testing-library/react';
import { olvidarMercado, useMercadoDisponible } from '../useMercadoDisponible';

const api = vi.hoisted(() => ({
  marketplace: undefined as undefined | { getAvailability: () => Promise<unknown> },
}));
vi.mock('@/api', () => ({
  getApiLayer: () => api,
}));

describe('useMercadoDisponible', () => {
  beforeEach(() => {
    olvidarMercado();
    api.marketplace = undefined;
  });

  it('ofrece el modulo cuando el servidor dice que hay socio', async () => {
    api.marketplace = { getAvailability: () => Promise.resolve({ success: true, data: { active: true } }) };
    const { result } = renderHook(() => useMercadoDisponible());
    // Mientras no se sabe, no se ofrece.
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('no lo ofrece cuando el servidor dice que no hay socio', async () => {
    const consulta = vi.fn(() => Promise.resolve({ success: true, data: { active: false } }));
    api.marketplace = { getAvailability: consulta };
    const { result } = renderHook(() => useMercadoDisponible());
    await waitFor(() => expect(consulta).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it('una consulta fallida no ofrece el modulo y no se guarda', async () => {
    const consulta = vi
      .fn()
      .mockResolvedValueOnce({ success: false, error: { code: 'FETCH_FAILED', message: 'x' } })
      .mockResolvedValueOnce({ success: true, data: { active: true } });
    api.marketplace = { getAvailability: consulta };
    const primera = renderHook(() => useMercadoDisponible());
    await waitFor(() => expect(consulta).toHaveBeenCalledTimes(1));
    expect(primera.result.current).toBe(false);

    // La siguiente pantalla vuelve a preguntar.
    const segunda = renderHook(() => useMercadoDisponible());
    await waitFor(() => expect(segunda.result.current).toBe(true));
    expect(consulta).toHaveBeenCalledTimes(2);
  });

  it('pregunta una sola vez y la respuesta la comparten todas las pantallas', async () => {
    const consulta = vi.fn(() => Promise.resolve({ success: true, data: { active: true } }));
    api.marketplace = { getAvailability: consulta };
    const a = renderHook(() => useMercadoDisponible());
    await waitFor(() => expect(a.result.current).toBe(true));
    const b = renderHook(() => useMercadoDisponible());
    // Ya se sabe: arranca ofrecido, sin parpadeo.
    expect(b.result.current).toBe(true);
    expect(consulta).toHaveBeenCalledTimes(1);
  });

  it('sin repositorio de mercado no se ofrece', async () => {
    const { result } = renderHook(() => useMercadoDisponible());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBe(false);
  });
});
