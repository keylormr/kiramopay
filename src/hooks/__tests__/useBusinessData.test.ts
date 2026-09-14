import { renderHook, waitFor, act } from '@testing-library/react';
import { useBusinessData } from '../useBusinessData';

// El hook se tragaba entero el fallo de la lista de cobros: dejaba la lista
// vacia, no marcaba nada y la pantalla de negocio pintaba "vendido hoy 0"
// como si fuera un hecho. A un comercio eso le dice que no vendio nada.
const mocks = vi.hoisted(() => ({
  getMerchants: vi.fn(),
  getMerchantPayments: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    qrPayments: {
      getMerchants: mocks.getMerchants,
      getMerchantPayments: mocks.getMerchantPayments,
    },
  }),
}));

vi.mock('@/stores/business.store', () => ({
  useBusinessStore: (sel: (s: { activeMerchantId: string | null }) => unknown) =>
    sel({ activeMerchantId: 'm1' }),
}));

const COMERCIO = {
  id: 'm1', name: 'Soda', description: '', category: 'food', qrCode: 'MRC-1',
  active: true, cedula: '3101', cedulaType: 'juridica', legalName: 'Soda SA',
  verificationStatus: 'verified', commissionBps: 50, role: 'owner',
};

describe('useBusinessData', () => {
  beforeEach(() => {
    mocks.getMerchants.mockReset();
    mocks.getMerchantPayments.mockReset();
  });

  it('avisa cuando la lista de cobros no se pudo traer', async () => {
    mocks.getMerchants.mockResolvedValue({ success: true, data: [COMERCIO] });
    mocks.getMerchantPayments.mockResolvedValue({ success: false, error: { code: 'FETCH_FAILED', message: 'boom' } });

    const { result } = renderHook(() => useBusinessData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.paymentsFailed).toBe(true);
    expect(result.current.payments).toEqual([]);
  });

  it('un fallo de red no se confunde con un comercio sin ventas', async () => {
    mocks.getMerchants.mockResolvedValue({ success: true, data: [COMERCIO] });
    mocks.getMerchantPayments.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() => useBusinessData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Misma lista vacia, significado opuesto.
    expect(result.current.payments).toEqual([]);
    expect(result.current.paymentsFailed).toBe(false);
  });

  it('un reintento que sale bien borra el aviso anterior', async () => {
    mocks.getMerchants
      .mockResolvedValueOnce({ success: false, error: { code: 'X', message: 'sin red' } })
      .mockResolvedValue({ success: true, data: [COMERCIO] });
    mocks.getMerchantPayments.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() => useBusinessData());
    await waitFor(() => expect(result.current.error).not.toBe(''));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.merchants).toHaveLength(1));
    expect(result.current.error).toBe('');
  });

  it('un fallo sin mensaje sigue contando como fallo', async () => {
    mocks.getMerchants.mockResolvedValue({ success: false, error: { code: 'X' } });
    mocks.getMerchantPayments.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() => useBusinessData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    // Antes: `mRes.error?.message || ''` dejaba la cadena vacia, que la
    // pantalla lee como "no hubo error".
    expect(result.current.error).not.toBe('');
  });

  // Un solo fallo de GET /qr/merchants al recargar o al cambiar de perfil
  // vaciaba la lista; App leia "ese comercio ya no es tuyo" y sacaba al cajero
  // del modo negocio sin decir nada.
  it('un fallo de la lista de comercios conserva la lista anterior y lo marca', async () => {
    mocks.getMerchants
      .mockResolvedValueOnce({ success: true, data: [COMERCIO] })
      .mockResolvedValue({ success: false, error: { code: 'RATE_LIMITED', message: 'espera' } });
    mocks.getMerchantPayments.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() => useBusinessData());
    await waitFor(() => expect(result.current.active?.id).toBe('m1'));
    expect(result.current.merchantsFailed).toBe(false);

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.merchantsFailed).toBe(true));
    expect(result.current.merchants).toHaveLength(1);
    expect(result.current.active?.id).toBe('m1');
    expect(result.current.retrying).toBe(true);
  });

  it('la lista traida con exito reemplaza a la anterior y apaga el fallo', async () => {
    mocks.getMerchants
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'sin red' } })
      .mockResolvedValue({ success: true, data: [] });
    mocks.getMerchantPayments.mockResolvedValue({ success: true, data: [] });

    const { result } = renderHook(() => useBusinessData());
    await waitFor(() => expect(result.current.merchantsFailed).toBe(true));

    act(() => result.current.reload());
    await waitFor(() => expect(result.current.merchantsFailed).toBe(false));
    // Ahora si es un hecho: el comercio no esta en la lista.
    expect(result.current.active).toBeNull();
    expect(result.current.retrying).toBe(false);
  });
});
