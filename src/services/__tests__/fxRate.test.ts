// El tipo de cambio dolar-colon sale del servidor (BCCR) y de ningun otro lado.
// Cuando el servidor no lo da, la app decia 515: la constante de la semilla de la
// migracion 043, que nadie confirmo y que llevaba meses lejos del oficial. Ese
// 515 pintaba el total de Inicio, el de Perfil y los colones de cripto con una
// tasa que nadie dio. Sin tasa del servidor tiene que decir "no hay tasa".

const mocks = vi.hoisted(() => ({ getExchangeRates: vi.fn() }));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ country: { getExchangeRates: mocks.getExchangeRates } }),
}));

// El modulo guarda la tasa en memoria: cada caso arranca con un modulo nuevo.
async function cargar() {
  vi.resetModules();
  return import('../fxRate');
}

const fila = (fromCurrency: string, toCurrency: string, rate: number) => ({
  id: `${fromCurrency}-${toCurrency}`,
  fromCurrency,
  toCurrency,
  rate,
  source: 'bccr',
  updatedAt: '2026-10-28T12:00:00Z',
});

beforeEach(() => {
  mocks.getExchangeRates.mockReset();
});

describe('fxRate: sin tasa del servidor no hay tasa', () => {
  it('antes de la primera consulta no hay nada que decir', async () => {
    const fx = await cargar();
    expect(fx.getCachedUsdToCrcRate()).toBeNull();
  });

  it('el servidor no trae el par USD/CRC: no hay tasa, no 515', async () => {
    mocks.getExchangeRates.mockResolvedValue({ success: true, data: [fila('USD', 'GTQ', 7.75)] });
    const fx = await cargar();

    expect(await fx.getUsdToCrcRate()).toBeNull();
    expect(fx.getCachedUsdToCrcRate()).toBeNull();
    expect(fx.usdToCrc(10)).toBeNull();
    expect(fx.crcToUsd(5000)).toBeNull();
  });

  it('el servidor responde una tabla vacia', async () => {
    mocks.getExchangeRates.mockResolvedValue({ success: true, data: [] });
    const fx = await cargar();

    expect(await fx.getUsdToCrcRate()).toBeNull();
  });

  it('la consulta falla', async () => {
    mocks.getExchangeRates.mockRejectedValue(new Error('sin red'));
    const fx = await cargar();

    expect(await fx.getUsdToCrcRate()).toBeNull();
    expect(fx.usdToCrc(10)).toBeNull();
  });

  it('el servidor responde un error', async () => {
    mocks.getExchangeRates.mockResolvedValue({ success: false, error: { code: 'HTTP_503', message: 'x' } });
    const fx = await cargar();

    expect(await fx.getUsdToCrcRate()).toBeNull();
  });

  it('una tasa en cero o negativa no es una tasa', async () => {
    mocks.getExchangeRates.mockResolvedValue({
      success: true,
      data: [fila('USD', 'CRC', 0), fila('CRC', 'USD', -0.002)],
    });
    const fx = await cargar();

    expect(await fx.getUsdToCrcRate()).toBeNull();
  });

  it('ya no exporta ningun respaldo numerico', async () => {
    const fx = await cargar();
    expect('DEFAULT_USD_TO_CRC' in fx).toBe(false);
  });

  it('lo que no se pudo traer se vuelve a pedir en la siguiente llamada, no se queda 10 minutos', async () => {
    mocks.getExchangeRates.mockResolvedValueOnce({ success: true, data: [] });
    mocks.getExchangeRates.mockResolvedValueOnce({ success: true, data: [fila('USD', 'CRC', 449.5)] });
    const fx = await cargar();

    expect(await fx.getUsdToCrcRate()).toBeNull();
    expect(await fx.getUsdToCrcRate()).toBe(449.5);
    expect(mocks.getExchangeRates).toHaveBeenCalledTimes(2);
  });
});

describe('fxRate: con tasa del servidor', () => {
  it('usa la fila USD/CRC', async () => {
    mocks.getExchangeRates.mockResolvedValue({ success: true, data: [fila('USD', 'CRC', 449.5)] });
    const fx = await cargar();

    expect(await fx.getUsdToCrcRate()).toBe(449.5);
    expect(fx.getCachedUsdToCrcRate()).toBe(449.5);
    expect(fx.usdToCrc(2)).toBe(899);
    expect(fx.crcToUsd(899)).toBeCloseTo(2, 10);
  });

  it('si solo viene la inversa CRC/USD, la invierte', async () => {
    mocks.getExchangeRates.mockResolvedValue({ success: true, data: [fila('CRC', 'USD', 0.0025)] });
    const fx = await cargar();

    expect(await fx.getUsdToCrcRate()).toBeCloseTo(400, 6);
  });

  it('una tasa que el servidor dio se conserva si la siguiente consulta falla', async () => {
    mocks.getExchangeRates.mockResolvedValueOnce({ success: true, data: [fila('USD', 'CRC', 449.5)] });
    mocks.getExchangeRates.mockRejectedValueOnce(new Error('sin red'));
    const fx = await cargar();

    expect(await fx.getUsdToCrcRate()).toBe(449.5);
    expect(await fx.getUsdToCrcRate(true)).toBe(449.5);
  });
});
