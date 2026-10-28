import { renderHook, waitFor, act } from '@testing-library/react';
import { useBusinessData } from '../useBusinessData';

// El hook se tragaba entero el fallo de la lista de cobros: dejaba la lista
// vacia, no marcaba nada y la pantalla de negocio pintaba "vendido hoy 0"
// como si fuera un hecho. A un comercio eso le dice que no vendio nada.
const mocks = vi.hoisted(() => ({
  getMerchants: vi.fn(),
  getMerchantPayments: vi.fn(),
  // El negocio activo del almacen: mutable, porque crear un negocio lo cambia
  // en medio de la vida del hook.
  activo: 'm1' as string | null,
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
    sel({ activeMerchantId: mocks.activo }),
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
    mocks.activo = 'm1';
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

// Al terminar "Crear negocio", App fija el negocio nuevo como activo y pide
// recargar la lista, que todavia no lo trae. Con `loading` en falso, el efecto
// de autocuracion de App leia "ese negocio ya no existe" y devolvia a la
// persona al perfil personal, aunque el negocio SI quedo creado.
describe('useBusinessData — el negocio recien creado', () => {
  beforeEach(() => {
    mocks.getMerchants.mockReset();
    mocks.getMerchantPayments.mockReset();
    mocks.activo = null;
  });

  it('mientras la lista nueva no llega sigue cargando, para que App no lo tome por inexistente', async () => {
    mocks.getMerchants.mockResolvedValueOnce({ success: true, data: [] });
    mocks.getMerchantPayments.mockResolvedValue({ success: true, data: [] });
    const { result } = renderHook(() => useBusinessData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // La lista nueva tarda: es la ventana en la que App decide.
    let entregar: (v: unknown) => void = () => {};
    mocks.getMerchants.mockReturnValueOnce(new Promise((r) => { entregar = r; }));
    mocks.activo = 'nuevo';
    act(() => result.current.reload());

    expect(result.current.active).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      entregar({ success: true, data: [{ ...COMERCIO, id: 'nuevo', verificationStatus: 'pending' }] });
    });
    await waitFor(() => expect(result.current.active?.id).toBe('nuevo'));
    expect(result.current.loading).toBe(false);
  });
});

// "No se pudieron cargar los cobros" en produccion duraba hasta que la persona
// tocaba Reintentar: la lista de comercios se reintentaba sola, la de cobros no.
describe('useBusinessData — reintento automatico de los cobros', () => {
  const COBRO = {
    id: 'p1', qrCodeId: 'q1', payerId: 'a', receiverId: 'b', merchantId: 'm1',
    amount: 1000, fee: 5, currency: 'CRC', status: 'completed', createdAt: '2026-10-28T10:00:00Z',
  };
  const fallo = { success: false, error: { code: 'FETCH_FAILED', message: 'boom' } };

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.getMerchants.mockReset();
    mocks.getMerchantPayments.mockReset();
    mocks.activo = 'm1';
    mocks.getMerchants.mockResolvedValue({ success: true, data: [COMERCIO] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const avanzar = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it('un fallo de la lista de cobros se reintenta solo y, si sale, apaga el aviso', async () => {
    mocks.getMerchantPayments
      .mockResolvedValueOnce(fallo)
      .mockResolvedValue({ success: true, data: [COBRO] });
    const { result } = renderHook(() => useBusinessData());

    await avanzar(10);
    expect(result.current.paymentsFailed).toBe(true);
    expect(mocks.getMerchantPayments).toHaveBeenCalledTimes(1);

    await avanzar(3100);

    expect(mocks.getMerchantPayments).toHaveBeenCalledTimes(2);
    expect(result.current.paymentsFailed).toBe(false);
    expect(result.current.payments).toHaveLength(1);
  });

  it('la espera crece y el reintento tiene tope: pasado el ultimo queda el boton', async () => {
    mocks.getMerchantPayments.mockResolvedValue(fallo);
    const { result } = renderHook(() => useBusinessData());

    await avanzar(10);
    // 3 s, 6 s, 12 s y 24 s: cuatro reintentos despues del primer intento.
    await avanzar(3100);
    expect(mocks.getMerchantPayments).toHaveBeenCalledTimes(2);
    await avanzar(6100);
    expect(mocks.getMerchantPayments).toHaveBeenCalledTimes(3);
    await avanzar(12100);
    await avanzar(24100);
    expect(mocks.getMerchantPayments).toHaveBeenCalledTimes(5);

    // Sin tope, un servidor que responde 429 se vería insistido para siempre.
    await avanzar(120_000);
    expect(mocks.getMerchantPayments).toHaveBeenCalledTimes(5);
    expect(result.current.paymentsFailed).toBe(true);
  });

  it('el reintento que la persona pide vuelve a habilitar los automaticos', async () => {
    mocks.getMerchantPayments.mockResolvedValue(fallo);
    const { result } = renderHook(() => useBusinessData());
    await avanzar(10);
    // Un paso por espera: el siguiente temporizador nace al pintar el anterior.
    for (const espera of [3100, 6100, 12_100, 24_100]) await avanzar(espera);
    expect(mocks.getMerchantPayments).toHaveBeenCalledTimes(5);

    act(() => result.current.reload());
    await avanzar(10);
    expect(mocks.getMerchantPayments).toHaveBeenCalledTimes(6);
    await avanzar(3100);
    expect(mocks.getMerchantPayments).toHaveBeenCalledTimes(7);
  });
});
