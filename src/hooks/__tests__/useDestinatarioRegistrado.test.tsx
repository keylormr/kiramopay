import { renderHook, waitFor } from '@testing-library/react';
import { useDestinatarioRegistrado } from '../useDestinatarioRegistrado';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  sinSinpe: false,
}));

vi.mock('@/api', () => ({
  getApiLayer: () => (mocks.sinSinpe ? {} : { sinpe: { lookupRecipient: mocks.lookup } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sinSinpe = false;
});

describe('useDestinatarioRegistrado', () => {
  it('sin telefono no pregunta nada', () => {
    const { result } = renderHook(() => useDestinatarioRegistrado(null));

    expect(result.current).toEqual({ fase: 'no_aplica' });
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('con un telefono consulta y pasa de consultando a registrado con el nombre', async () => {
    mocks.lookup.mockResolvedValue({ success: true, data: { registered: true, displayName: 'Keilor M. R.' } });

    const { result } = renderHook(() => useDestinatarioRegistrado('8888-0000'));

    // Derivado: en el primer pintado ya dice que consulta (sin un cuadro "listo" falso).
    expect(result.current).toEqual({ fase: 'consultando' });
    await waitFor(() => expect(result.current).toEqual({ fase: 'registrado', nombre: 'Keilor M. R.' }));
    expect(mocks.lookup).toHaveBeenCalledWith('8888-0000');
  });

  it('un numero sin cuenta', async () => {
    mocks.lookup.mockResolvedValue({ success: true, data: { registered: false } });

    const { result } = renderHook(() => useDestinatarioRegistrado('88880000'));

    await waitFor(() => expect(result.current).toEqual({ fase: 'sin_cuenta' }));
  });

  it('una cuenta registrada sin nombre se trata como que no se pudo verificar', async () => {
    mocks.lookup.mockResolvedValue({ success: true, data: { registered: true } });

    const { result } = renderHook(() => useDestinatarioRegistrado('88880000'));

    await waitFor(() => expect(result.current).toEqual({ fase: 'no_se_pudo' }));
  });

  it('un rechazo o una excepcion NO dicen que el numero no tenga cuenta', async () => {
    mocks.lookup.mockResolvedValueOnce({ success: false, error: { code: 'RATE_LIMITED', message: 'x' } });
    const a = renderHook(() => useDestinatarioRegistrado('88880000'));
    await waitFor(() => expect(a.result.current).toEqual({ fase: 'no_se_pudo' }));

    mocks.lookup.mockRejectedValueOnce(new Error('sin red'));
    const b = renderHook(() => useDestinatarioRegistrado('88880001'));
    await waitFor(() => expect(b.result.current).toEqual({ fase: 'no_se_pudo' }));
  });

  it('sin la capa de SINPE no se afirma nada', async () => {
    mocks.sinSinpe = true;

    const { result } = renderHook(() => useDestinatarioRegistrado('88880000'));

    await waitFor(() => expect(result.current).toEqual({ fase: 'no_se_pudo' }));
  });

  it('al cambiar de telefono vuelve a consultar y la respuesta tardia del anterior no lo pisa', async () => {
    let soltarPrimera: (v: unknown) => void = () => {};
    mocks.lookup
      .mockImplementationOnce(() => new Promise((r) => { soltarPrimera = r; }))
      .mockResolvedValueOnce({ success: true, data: { registered: true, displayName: 'Otra P.' } });

    const { result, rerender } = renderHook(({ tel }) => useDestinatarioRegistrado(tel), { initialProps: { tel: '88880000' } });
    rerender({ tel: '88880001' });
    await waitFor(() => expect(result.current).toEqual({ fase: 'registrado', nombre: 'Otra P.' }));

    soltarPrimera({ success: true, data: { registered: true, displayName: 'Keilor M. R.' } });
    await Promise.resolve();
    await Promise.resolve();

    expect(result.current).toEqual({ fase: 'registrado', nombre: 'Otra P.' });
  });

  it('el mismo telefono no se consulta dos veces aunque la vista se vuelva a pintar', async () => {
    mocks.lookup.mockResolvedValue({ success: true, data: { registered: true, displayName: 'Keilor M. R.' } });

    const { result, rerender } = renderHook(({ tel }) => useDestinatarioRegistrado(tel), { initialProps: { tel: '88880000' } });
    await waitFor(() => expect(result.current.fase).toBe('registrado'));
    rerender({ tel: '88880000' });
    rerender({ tel: '88880000' });

    expect(mocks.lookup).toHaveBeenCalledTimes(1);
  });
});
