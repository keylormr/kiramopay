import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

// Hallazgos de la QA del 13-09 sobre la pantalla de cripto: el retiro de
// staking que fallaba siempre, la fila de compra con signo y monto falsos, los
// precios sin colones, USDT y USDC ofrecidas en staking, y los textos en ingles
// del servidor. El estado varia por caso, asi que vive en `mocks`.
const mocks = vi.hoisted(() => ({
  api: {
    crypto: {
      buy: vi.fn(),
      sell: vi.fn(),
      convert: vi.fn(),
      stake: vi.fn(),
      unstake: vi.fn(),
      claimYield: vi.fn(),
    },
  },
  dispatch: vi.fn(),
  activos: [] as Array<Record<string, unknown>>,
  movimientos: [] as Array<Record<string, unknown>>,
  posiciones: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/services/cryptoPrices', () => ({
  cryptoPriceService: {
    getPrices: vi.fn().mockResolvedValue([]),
    getAllPriceHistories: vi.fn().mockResolvedValue({}),
  },
  SIMBOLOS_SIN_FEED: ['USDT', 'USDC'],
}));

vi.mock('@/hooks/useCryptoPricesWs', () => ({
  useCryptoPricesWs: () => ({ prices: {}, lastUpdate: null, connected: false }),
}));

vi.mock('@/services/fxRate', () => ({
  getUsdToCrcRate: vi.fn().mockResolvedValue(510),
  getCachedUsdToCrcRate: () => 510,
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      crypto: {
        assets: mocks.activos,
        transactions: mocks.movimientos,
        stakingPositions: mocks.posiciones,
        priceAlerts: [],
        favoriteAssets: [],
      },
    },
    dispatch: mocks.dispatch,
  }),
}));

const activo = (symbol: string, name: string, balance: number, currentPrice: number) => ({
  id: symbol.toLowerCase(),
  symbol,
  name,
  balance,
  currentPrice,
  avgBuyPrice: currentPrice,
  priceChange24h: 1.5,
  icon: symbol[0],
  color: '#123456',
  priceHistory: [],
});

function montar() {
  return render(
    <LanguageProvider>
      <CryptoView />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mocks.api.crypto).forEach((f) => f.mockReset());
  mocks.dispatch.mockReset();
  mocks.activos = [
    activo('BTC', 'Bitcoin', 0.5, 40000),
    activo('ETH', 'Ethereum', 2, 2500),
    activo('SOL', 'Solana', 0, 150),
  ];
  mocks.movimientos = [];
  mocks.posiciones = [];
});

describe('n=43 — el retiro de staking usa el id del servidor', () => {
  it('la posicion que se guarda es la que devolvio el servidor, con su id', async () => {
    const posicion = {
      id: '099fdd8d-c6df-4ba7-98a2-d60c60149523', asset: 'ETH', amount: 0.1, apy: 4.5,
      startDate: '2026-09-13T15:00:00Z', earned: 0, locked: false,
    };
    mocks.api.crypto.stake.mockResolvedValue({ success: true, data: posicion });
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole('button', { name: /Ethereum/ }));
    await user.click(await screen.findByRole('button', { name: /Hacer Staking/ }));
    const hoja = within(await screen.findByRole('dialog', { name: /Staking ETH/ }));
    await user.type(hoja.getByPlaceholderText('0.00'), '0.1');
    await user.click(hoja.getByRole('button', { name: 'Comenzar Staking' }));

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'STAKE_CRYPTO', payload: posicion }),
    );
    // La tasa del cliente no viaja: la pone el servidor.
    expect(mocks.api.crypto.stake).toHaveBeenCalledWith({
      asset: 'ETH', amount: 0.1, locked: false, idempotencyKey: expect.stringMatching(/^crypto:stake:/),
    });
  });

  it('un retiro sobre una posicion que ya no existe se explica en espanol', async () => {
    mocks.posiciones = [{
      id: 'stake-1789326379706', asset: 'ETH', amount: 0.0001, apy: 4.5, startDate: 'Ahora', earned: 0, locked: false,
    }];
    mocks.api.crypto.unstake.mockResolvedValue({
      success: false,
      error: { code: 'STAKING_POSITION_NOT_FOUND', message: 'staking position not found' },
    });
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole('button', { name: 'Staking' }));
    await user.click(await screen.findByRole('button', { name: 'Retirar' }));

    expect(await screen.findByText('Esa posición ya no está activa. Actualizamos tu lista.')).toBeInTheDocument();
    expect(screen.queryByText(/staking position not found/)).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

// Convertir y apartar no mandaban llave: el reintento tras un corte de red
// convertia o apartaba otra vez aunque la primera ya se hubiera hecho. Y
// despues de un exito la llave tiene que cambiar: si no, la siguiente
// operacion igual —hecha a proposito— el servidor la tomaria por un reintento
// y no haria nada.
describe('convertir y apartar van con la llave del intento', () => {
  async function abrirConversion(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Convertir/ }));
    return within(await screen.findByRole('dialog'));
  }

  async function abrirStaking(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Ethereum/ }));
    await user.click(await screen.findByRole('button', { name: /Hacer Staking/ }));
    return within(await screen.findByRole('dialog', { name: /Staking ETH/ }));
  }

  it('el reintento de la misma conversion reusa la llave; la siguiente conversion es otra', async () => {
    mocks.api.crypto.convert
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } })
      .mockResolvedValue({ success: true, data: {} });
    const user = userEvent.setup();
    montar();

    let hoja = await abrirConversion(user);
    await user.type(hoja.getByPlaceholderText('0.00'), '0.1');
    await user.click(hoja.getByRole('button', { name: 'Convertir' }));
    await screen.findByText(/No pudimos conectar con KiramoPay/);
    await user.click(hoja.getByRole('button', { name: 'Convertir' }));
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'CONVERT_CRYPTO' })),
    );
    // La hoja se desmonta 300 ms despues de cerrarse, y mientras tanto su boton
    // Convertir tambien esta en pantalla.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    hoja = await abrirConversion(user);
    await user.type(hoja.getByPlaceholderText('0.00'), '0.1');
    await user.click(hoja.getByRole('button', { name: 'Convertir' }));
    await waitFor(() => expect(mocks.api.crypto.convert).toHaveBeenCalledTimes(3));

    const [a, b, c] = mocks.api.crypto.convert.mock.calls.map(([req]) => req.idempotencyKey as string);
    expect(a).toMatch(/^crypto:convert:/);
    // Mismo intento tras el corte de red: misma llave, no convierte dos veces.
    expect(b).toBe(a);
    // La misma conversion despues de un exito es otra conversion.
    expect(c).not.toBe(a);
  });

  it('el reintento del mismo apartado reusa la llave; el siguiente apartado es otro', async () => {
    const posicion = {
      id: '5a7e0c4e-0000-4000-8000-000000000002', asset: 'ETH', amount: 0.1, apy: 4.5,
      startDate: '2026-09-22T15:00:00Z', earned: 0, locked: false,
    };
    mocks.api.crypto.stake
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } })
      .mockResolvedValue({ success: true, data: posicion });
    const user = userEvent.setup();
    montar();

    let hoja = await abrirStaking(user);
    await user.type(hoja.getByPlaceholderText('0.00'), '0.1');
    await user.click(hoja.getByRole('button', { name: 'Comenzar Staking' }));
    await screen.findByText(/No pudimos conectar con KiramoPay/);
    await user.click(hoja.getByRole('button', { name: 'Comenzar Staking' }));
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'STAKE_CRYPTO', payload: posicion }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    hoja = await abrirStaking(user);
    await user.type(hoja.getByPlaceholderText('0.00'), '0.1');
    await user.click(hoja.getByRole('button', { name: 'Comenzar Staking' }));
    await waitFor(() => expect(mocks.api.crypto.stake).toHaveBeenCalledTimes(3));

    const [a, b, c] = mocks.api.crypto.stake.mock.calls.map(([req]) => req.idempotencyKey as string);
    expect(a).toMatch(/^crypto:stake:/);
    // Mismo intento tras el corte de red: misma llave, no aparta dos veces.
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });
});

describe('n=44 — la fila de una compra dice lo que entro y lo que salio', () => {
  it('una compra de US$1 de ETH se lee +ETH y -$1.00', () => {
    mocks.movimientos = [{
      id: 'c757e864', type: 'buy', fromAsset: 'USD', fromAmount: 1, toAsset: 'ETH',
      toAmount: 0.0003984508231994, price: 2509.72, priceCurrency: 'USD', fee: 0,
      date: '2026-09-13T15:00:00Z', status: 'completed',
    }];
    montar();

    expect(screen.getByText('+0.000398 ETH')).toBeInTheDocument();
    expect(screen.getByText('-$1.00')).toBeInTheDocument();
    // Lo que se veia antes: el dolar como ganancia y el precio del ETH como monto.
    expect(screen.queryByText('+1 USD')).not.toBeInTheDocument();
    expect(screen.queryByText('$2,509.72')).not.toBeInTheDocument();
  });

  it('una venta a colones se lee -BTC y +colones, y el detalle no inventa comision', async () => {
    mocks.movimientos = [{
      id: 'v1', type: 'sell', fromAsset: 'BTC', fromAmount: 0.001, toAsset: 'CRC', toAmount: 20400,
      price: 20400000, priceCurrency: 'CRC', fee: 0, date: '2026-09-13T15:00:00Z', status: 'completed',
    }];
    const user = userEvent.setup();
    montar();

    expect(screen.getByText('-0.001 BTC')).toBeInTheDocument();
    expect(screen.getByText('+₡20,400.00')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Venta BTC/ }));
    const hoja = within(await screen.findByRole('dialog'));
    expect(hoja.getByText('Entregaste')).toBeInTheDocument();
    expect(hoja.getByText('₡20,400.00')).toBeInTheDocument();
    // El precio va en la moneda en que se anoto, no como si fueran dolares.
    expect(hoja.getByText('₡20,400,000.00')).toBeInTheDocument();
    expect(hoja.getByText('₡0.00')).toBeInTheDocument();
    expect(hoja.getByText(/Completado/)).toBeInTheDocument();
  });
});

describe('n=48 — el precio de cada cripto tambien en colones', () => {
  it('el mercado muestra el equivalente en colones de una unidad', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('button', { name: 'Mercado' }));
    // 40.000 dolares a 510 colones.
    expect(await screen.findByText(/≈ ₡20,400,000/)).toBeInTheDocument();
  });

  it('el detalle del activo tambien', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('button', { name: /Bitcoin/ }));
    const hoja = within(await screen.findByRole('dialog'));
    expect(hoja.getByText('≈ ₡20,400,000')).toBeInTheDocument();
  });
});

describe('n=46 — USDT y USDC fuera del staking', () => {
  it('una estable con saldo no ofrece staking; SOL con saldo si', async () => {
    mocks.activos = [
      activo('USDT', 'Tether', 500, 1),
      activo('SOL', 'Solana', 3, 150),
    ];
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole('button', { name: /Tether/ }));
    let hoja = within(await screen.findByRole('dialog'));
    expect(hoja.queryByRole('button', { name: /Hacer Staking/ })).not.toBeInTheDocument();
    await user.click(hoja.getByRole('button', { name: /cerrar|close/i }));

    await user.click(screen.getByRole('button', { name: /Solana/ }));
    hoja = within(await screen.findByRole('dialog', { name: 'Solana' }));
    expect(hoja.getByRole('button', { name: /Hacer Staking/ })).toBeInTheDocument();
  });

  it('sin activos del programa, el boton de empezar no se puede usar y se dice cuales son', async () => {
    mocks.activos = [activo('BTC', 'Bitcoin', 0.5, 40000), activo('ETH', 'Ethereum', 0, 2500), activo('SOL', 'Solana', 0, 150)];
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('button', { name: 'Staking' }));

    expect(screen.getByRole('button', { name: 'Comenzar Staking' })).toBeDisabled();
    expect(screen.getByText('Puedes hacer staking con Ethereum (ETH) y Solana (SOL).')).toBeInTheDocument();
  });

  it('una posicion no anuncia una tasa que no se paga', async () => {
    mocks.posiciones = [{
      id: 'p1', asset: 'ETH', amount: 1, apy: 4.5, startDate: '2026-09-13T15:00:00Z', earned: 0, locked: false,
    }];
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('button', { name: 'Staking' }));

    expect(await screen.findByText('Sin rendimiento aún')).toBeInTheDocument();
    expect(screen.queryByText(/APY/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026-09-13T15/)).not.toBeInTheDocument();
  });
});

describe('un activo que llega sin precio lo toma del ultimo sondeo', () => {
  // El USDT que vuelve al saldo al retirar una posicion vieja aparece despues
  // del sondeo de precios; sin esto la cartera decia "no disponible" cinco
  // minutos.
  it('despacha el precio que el sondeo ya trajo', async () => {
    const { cryptoPriceService } = await import('@/services/cryptoPrices');
    vi.mocked(cryptoPriceService.getPrices).mockResolvedValueOnce([
      { symbol: 'USDT', price: 1, change24h: 0, marketCap: 0, volume24h: 0, high24h: 1, low24h: 1, lastUpdated: '', priceHistory: [] },
    ]);
    mocks.activos = [activo('BTC', 'Bitcoin', 0.5, 40000), activo('USDT', 'Tether', 25, 0)];
    montar();

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'UPDATE_CRYPTO_PRICES',
        payload: [{ symbol: 'USDT', price: 1, change24h: 0, priceHistory: [] }],
      }),
    );
  });
});

describe('un activo sin costo conocido no se cuenta como ganancia', () => {
  // Lo que vuelve de una posicion de staking sin fila previa llega con costo
  // cero: su fila decia "+Infinity%" y el total lo sumaba entero como ganancia.
  it('ni la fila ni el total inventan una ganancia', async () => {
    mocks.activos = [
      { ...activo('BTC', 'Bitcoin', 1, 110), avgBuyPrice: 100 },
      { ...activo('USDT', 'Tether', 25, 1), avgBuyPrice: 0 },
    ];
    const user = userEvent.setup();
    montar();

    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
    // Solo el BTC: 10 dolares sobre un costo de 100.
    expect(screen.getByText('+$10.00 (10.00%)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Tether/ }));
    const hoja = within(await screen.findByRole('dialog'));
    expect(hoja.getByText('Precio Promedio: —')).toBeInTheDocument();
    expect(hoja.getByText('Ganancia / Pérdida').nextElementSibling).toHaveTextContent('—');
  });
});

describe('errores de compra y venta: siempre traducidos, nunca el texto del servidor', () => {
  async function comprar(user: ReturnType<typeof userEvent.setup>, monto = '10') {
    const hoja = within(await screen.findByRole('dialog'));
    const campo = hoja.getByPlaceholderText('0.00');
    await user.clear(campo);
    await user.type(campo, monto);
    await user.click(hoja.getByRole('button', { name: 'Comprar BTC' }));
    return hoja;
  }

  it.each([
    ['CRYPTO_INVALID_AMOUNT', 'invalid amount: from_amount is less than one centimo', 'Ese monto no se puede operar: es demasiado pequeño o tiene demasiados decimales.'],
    ['INSUFFICIENT_BALANCE', 'insufficient balance', 'No tienes saldo suficiente en tu cuenta para esta compra.'],
    ['PRICE_MOVED', 'el precio cambio desde que se mostro: en pantalla 1.00 USD, ahora 2.00 USD', 'El precio cambió mientras confirmabas. Revisa el nuevo precio e intenta de nuevo.'],
    // El 5xx: el cliente ya cambio el texto, pero la pantalla decide por el codigo.
    ['BUY_FAILED', 'internal server error', 'No pudimos completar la operación. Intenta de nuevo en un momento.'],
  ])('%s', async (code, crudo, esperado) => {
    mocks.api.crypto.buy.mockResolvedValue({ success: false, error: { code, message: crudo } });
    const user = userEvent.setup();
    montar();
    await user.click(screen.getAllByRole('button', { name: /Comprar/ })[0]);
    await comprar(user);

    expect(await screen.findByText(esperado)).toBeInTheDocument();
    expect(screen.queryByText(crudo)).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('el reintento de la misma compra reusa la llave; una llave ya usada la renueva', async () => {
    mocks.api.crypto.buy
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } })
      .mockResolvedValueOnce({ success: false, error: { code: 'LLAVE_REUTILIZADA', message: 'idempotency key reused for a different movement' } })
      .mockResolvedValueOnce({ success: true, data: {} });
    const user = userEvent.setup();
    montar();
    await user.click(screen.getAllByRole('button', { name: /Comprar/ })[0]);

    await comprar(user);
    await screen.findByText(/No pudimos conectar con KiramoPay/);
    await comprar(user);
    expect(await screen.findByText(/el precio cambió desde entonces/)).toBeInTheDocument();
    await comprar(user);
    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'BUY_CRYPTO' })));

    const llaves = mocks.api.crypto.buy.mock.calls.map(([req]) => req.idempotencyKey as string);
    expect(llaves[0]).toMatch(/^crypto:buy:/);
    // Mismo intento tras el corte de red: misma llave, no cobra dos veces.
    expect(llaves[1]).toBe(llaves[0]);
    // Tras LLAVE_REUTILIZADA es otra operacion.
    expect(llaves[2]).not.toBe(llaves[1]);
  });

  it('otro monto es otra operacion y otra llave', async () => {
    mocks.api.crypto.buy.mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } });
    const user = userEvent.setup();
    montar();
    await user.click(screen.getAllByRole('button', { name: /Comprar/ })[0]);

    await comprar(user, '10');
    await screen.findByText(/No pudimos conectar/);
    await comprar(user, '20');
    await waitFor(() => expect(mocks.api.crypto.buy).toHaveBeenCalledTimes(2));
    const [a, b] = mocks.api.crypto.buy.mock.calls.map(([req]) => req.idempotencyKey);
    expect(a).not.toBe(b);
  });

  it('vender sin saldo suficiente del activo se explica en espanol', async () => {
    mocks.api.crypto.sell.mockResolvedValue({
      success: false, error: { code: 'CRYPTO_INSUFFICIENT_BALANCE', message: 'insufficient asset balance' },
    });
    const user = userEvent.setup();
    montar();
    await user.click(screen.getAllByRole('button', { name: /Vender/ })[0]);
    const hoja = within(await screen.findByRole('dialog'));
    await user.type(hoja.getByPlaceholderText('0.00'), '0.1');
    // Con colones marcado, el estimado va en colones: 0,1 x 40.000 x 510.
    expect(hoja.getByText(/≈ ₡2,040,000/)).toBeInTheDocument();
    await user.click(hoja.getByRole('button', { name: /Vender y recibir CRC/ }));

    expect(await screen.findByText('No tienes suficiente de esta cripto para esa operación.')).toBeInTheDocument();
    expect(mocks.api.crypto.sell.mock.calls[0][0].idempotencyKey).toMatch(/^crypto:sell:/);
  });
});
