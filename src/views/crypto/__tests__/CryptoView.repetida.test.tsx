import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

// La respuesta repetida. Tras un corte de red la pantalla reintenta con la
// misma llave y, si el primer intento ya se habia hecho, el servidor devuelve
// aquel con la marca de repeticion. La pantalla no la distinguia: anotaba la
// operacion otra vez —la fila doble y el saldo contado dos veces hasta la
// siguiente carga— y a quien repetia a proposito una operacion identica le
// decia "listo" por una que el servidor no hizo. Ahora no anota nada, pide lo
// que hay en el servidor, dice que ya estaba hecha y suelta la llave: la
// siguiente es una operacion nueva.
const mocks = vi.hoisted(() => ({
  api: {
    crypto: {
      buy: vi.fn(),
      sell: vi.fn(),
      convert: vi.fn(),
      stake: vi.fn(),
    },
  },
  dispatch: vi.fn(),
  refrescarCripto: vi.fn(),
  refrescarCuentas: vi.fn(),
  activos: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/services/dataSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/dataSync')>()),
  refreshCrypto: mocks.refrescarCripto,
  refreshAccounts: mocks.refrescarCuentas,
}));

vi.mock('@/services/cryptoPrices', () => ({
  cryptoPriceService: {
    getPrices: vi.fn().mockResolvedValue([]),
    getAllPriceHistories: vi.fn().mockResolvedValue({}),
  },
  SIMBOLOS_SIN_FEED: ['USDT', 'USDC'],
}));

// El desafio de MFA se reduce a su resultado, como en la prueba del envio.
vi.mock('@/components/MfaChallengeSheet', () => ({
  MfaChallengeSheet: ({ isOpen, onVerified }: { isOpen: boolean; onVerified: () => void }) =>
    isOpen ? <button onClick={onVerified}>verificar-mfa</button> : null,
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
        transactions: [],
        stakingPositions: [],
        priceAlerts: [],
        favoriteAssets: [],
      },
    },
    dispatch: mocks.dispatch,
  }),
}));

const YA_HECHA = 'Esa operación ya se había hecho';
// Lo que el aviso dice de los saldos depende de si se pudieron traer: no anota
// nada, asi que lo que se ve es lo que llego del servidor, o lo de antes.
const ACTUALIZANDO = 'No se repitió. Estamos trayendo tus saldos al día.';
const AL_DIA = 'No se repitió: tus saldos y movimientos ya muestran lo que quedó registrado.';
const SIN_ACTUALIZAR = 'No se repitió, pero no pudimos actualizar tus saldos: puede que todavía veas los de antes.';

function diferido<T>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

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

const venta = {
  id: '6f1c2a90-0000-4000-8000-000000000012', type: 'sell', fromAsset: 'BTC', fromAmount: 0.1,
  toAsset: 'CRC', toAmount: 2_040_000, price: 20_400_000, priceCurrency: 'CRC', fee: 0,
  date: '2026-10-01T13:00:00Z', status: 'completed',
};

function montar() {
  return render(
    <LanguageProvider>
      <CryptoView />
    </LanguageProvider>,
  );
}

type Usuario = ReturnType<typeof userEvent.setup>;

async function comprar(user: Usuario) {
  await user.click(screen.getAllByRole('button', { name: /Comprar/ })[0]);
  const hoja = within(await screen.findByRole('dialog'));
  await user.type(hoja.getByPlaceholderText('0.00'), '10');
  await user.click(hoja.getByRole('button', { name: 'Comprar BTC' }));
}

async function vender(user: Usuario) {
  await user.click(screen.getAllByRole('button', { name: /Vender/ })[0]);
  const hoja = within(await screen.findByRole('dialog'));
  await user.type(hoja.getByPlaceholderText('0.00'), '0.1');
  await user.click(hoja.getByRole('button', { name: /Vender y recibir CRC/ }));
  return hoja;
}

async function convertir(user: Usuario) {
  await user.click(screen.getByRole('button', { name: /Convertir/ }));
  const hoja = within(await screen.findByRole('dialog'));
  await user.type(hoja.getByPlaceholderText('0.00'), '0.1');
  await user.click(hoja.getByRole('button', { name: 'Convertir' }));
}

async function apartar(user: Usuario) {
  await user.click(screen.getByRole('button', { name: /Ethereum/ }));
  await user.click(await screen.findByRole('button', { name: /Hacer Staking/ }));
  const hoja = within(await screen.findByRole('dialog', { name: /Staking ETH/ }));
  await user.type(hoja.getByPlaceholderText('0.00'), '0.1');
  await user.click(hoja.getByRole('button', { name: 'Comenzar Staking' }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mocks.api.crypto).forEach((f) => f.mockReset());
  mocks.dispatch.mockReset();
  mocks.refrescarCripto.mockReset().mockResolvedValue(true);
  mocks.refrescarCuentas.mockReset().mockResolvedValue(true);
  mocks.activos = [
    activo('BTC', 'Bitcoin', 0.5, 40000),
    activo('ETH', 'Ethereum', 2, 2500),
  ];
});

describe('una operacion que ya estaba hecha no se anota otra vez', () => {
  const casos = [
    {
      nombre: 'compra',
      api: () => mocks.api.crypto.buy,
      accion: 'BUY_CRYPTO',
      respuesta: { ...venta, type: 'buy', fromAsset: 'USD', fromAmount: 10, toAsset: 'BTC', toAmount: 0.00025 },
      operar: comprar,
    },
    { nombre: 'venta', api: () => mocks.api.crypto.sell, accion: 'SELL_CRYPTO', respuesta: venta, operar: vender },
    {
      nombre: 'conversion',
      api: () => mocks.api.crypto.convert,
      accion: 'CONVERT_CRYPTO',
      respuesta: { ...venta, type: 'convert', toAsset: 'ETH', toAmount: 1.6, priceCurrency: 'USD' },
      operar: convertir,
    },
    {
      nombre: 'staking',
      api: () => mocks.api.crypto.stake,
      accion: 'STAKE_CRYPTO',
      respuesta: {
        id: '5a7e0c4e-0000-4000-8000-000000000012', asset: 'ETH', amount: 0.1, apy: 4.5,
        startDate: '2026-10-01T13:00:00Z', earned: 0, locked: false,
      },
      operar: apartar,
    },
  ];

  it.each(casos)('$nombre: se avisa, se trae lo del servidor y la hoja se cierra', async (caso) => {
    caso.api().mockResolvedValue({ success: true, data: { ...caso.respuesta, repetida: true } });
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(mocks.refrescarCripto).toHaveBeenCalled());
    mocks.refrescarCripto.mockClear();
    mocks.refrescarCuentas.mockClear();

    await caso.operar(user);

    expect(await screen.findByText(YA_HECHA)).toBeInTheDocument();
    expect(await screen.findByText(AL_DIA)).toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: caso.accion }));
    expect(mocks.refrescarCripto).toHaveBeenCalled();
    expect(mocks.refrescarCuentas).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each(casos)('$nombre: sin la marca es una operacion nueva y no hay aviso', async (caso) => {
    caso.api().mockResolvedValue({ success: true, data: caso.respuesta });
    const user = userEvent.setup();
    montar();

    await caso.operar(user);

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({ type: caso.accion, payload: caso.respuesta }),
    );
    expect(screen.queryByText(YA_HECHA)).not.toBeInTheDocument();
  });
});

// El caso que encontro la revision: la venta llega al servidor pero la
// respuesta se pierde, y la persona repite la MISMA venta a proposito. La
// pantalla conservaba la llave, el servidor devolvia la venta vieja y la
// pantalla la daba por nueva. Ahora dice que ya estaba hecha y suelta la llave:
// si de verdad quiere otra, la siguiente va con llave nueva y es otra venta.
describe('la venta repetida tras un corte de red', () => {
  it('se avisa, y la siguiente venta igual va con otra llave', async () => {
    mocks.api.crypto.sell
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } })
      .mockResolvedValueOnce({ success: true, data: { ...venta, repetida: true } })
      .mockResolvedValue({ success: true, data: { ...venta, id: '6f1c2a90-0000-4000-8000-000000000013' } });
    const user = userEvent.setup();
    montar();

    const hoja = await vender(user);
    await screen.findByText(/No pudimos conectar con KiramoPay/);
    await user.click(hoja.getByRole('button', { name: /Vender y recibir CRC/ }));
    expect(await screen.findByText(YA_HECHA)).toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SELL_CRYPTO' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await vender(user);
    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'SELL_CRYPTO' })),
    );
    // La venta nueva se lleva el aviso de la anterior.
    expect(screen.queryByText(YA_HECHA)).not.toBeInTheDocument();

    const [a, b, c] = mocks.api.crypto.sell.mock.calls.map(([req]) => req.idempotencyKey as string);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
  });

  it('el aviso se puede cerrar', async () => {
    mocks.api.crypto.sell.mockResolvedValue({ success: true, data: { ...venta, repetida: true } });
    const user = userEvent.setup();
    montar();

    await vender(user);
    const aviso = (await screen.findByText(YA_HECHA)).closest('[role="status"]') as HTMLElement;
    await user.click(within(aviso).getByRole('button', { name: 'Cerrar' }));

    expect(screen.queryByText(YA_HECHA)).not.toBeInTheDocument();
  });
});

// Lo que se ve tras la repeticion sale del servidor, porque la pantalla no
// anota nada. Si esa lectura no llega —la misma red inestable que provoco el
// reintento—, el aviso no puede decir que los saldos estan al dia: la persona
// veria la cifra de antes, leeria que todo esta al dia y podria repetir la
// operacion a mano.
describe('lo que el aviso dice de los saldos', () => {
  it('mientras se traen no afirma nada, y cuando llegan lo dice', async () => {
    mocks.api.crypto.sell.mockResolvedValue({ success: true, data: { ...venta, repetida: true } });
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(mocks.refrescarCripto).toHaveBeenCalled());
    const cripto = diferido<boolean>();
    const cuentas = diferido<boolean>();
    mocks.refrescarCripto.mockReturnValue(cripto.promesa);
    mocks.refrescarCuentas.mockReturnValue(cuentas.promesa);

    await vender(user);

    expect(await screen.findByText(ACTUALIZANDO)).toBeInTheDocument();
    expect(screen.queryByText(AL_DIA)).not.toBeInTheDocument();
    cripto.resolver(true);
    cuentas.resolver(true);
    expect(await screen.findByText(AL_DIA)).toBeInTheDocument();
    expect(screen.queryByText(ACTUALIZANDO)).not.toBeInTheDocument();
  });

  it('si una de las dos lecturas no llega, no promete saldos al dia', async () => {
    mocks.api.crypto.sell.mockResolvedValue({ success: true, data: { ...venta, repetida: true } });
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(mocks.refrescarCripto).toHaveBeenCalled());
    mocks.refrescarCuentas.mockResolvedValue(false);

    await vender(user);

    expect(await screen.findByText(SIN_ACTUALIZAR)).toBeInTheDocument();
    expect(screen.getByText(YA_HECHA)).toBeInTheDocument();
    expect(screen.queryByText(AL_DIA)).not.toBeInTheDocument();
  });

  it('si la lectura lanza, tampoco', async () => {
    mocks.api.crypto.sell.mockResolvedValue({ success: true, data: { ...venta, repetida: true } });
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(mocks.refrescarCripto).toHaveBeenCalled());
    mocks.refrescarCripto.mockRejectedValue(new Error('sin red'));

    await vender(user);

    expect(await screen.findByText(SIN_ACTUALIZAR)).toBeInTheDocument();
    expect(screen.queryByText(AL_DIA)).not.toBeInTheDocument();
  });

  it('una lectura que llega tarde no vuelve a abrir el aviso cerrado', async () => {
    mocks.api.crypto.sell.mockResolvedValue({ success: true, data: { ...venta, repetida: true } });
    const user = userEvent.setup();
    montar();
    await waitFor(() => expect(mocks.refrescarCripto).toHaveBeenCalled());
    const cripto = diferido<boolean>();
    mocks.refrescarCripto.mockReturnValue(cripto.promesa);

    await vender(user);
    const aviso = (await screen.findByText(YA_HECHA)).closest('[role="status"]') as HTMLElement;
    await user.click(within(aviso).getByRole('button', { name: 'Cerrar' }));
    cripto.resolver(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(YA_HECHA)).not.toBeInTheDocument();
    expect(screen.queryByText(AL_DIA)).not.toBeInTheDocument();
  });
});

describe('el aviso en la pagina', () => {
  // Un lector de pantalla solo anuncia los cambios de una region que ya estaba
  // en el documento: insertada junto con su texto, muchos no dicen nada.
  it('la region que lo anuncia ya estaba en la pagina', async () => {
    mocks.api.crypto.sell.mockResolvedValue({ success: true, data: { ...venta, repetida: true } });
    const user = userEvent.setup();
    montar();
    const regionesAntes = screen.getAllByRole('status');

    await vender(user);

    const region = (await screen.findByText(YA_HECHA)).closest('[role="status"]');
    expect(regionesAntes).toContain(region);
  });

  // La hoja lo taparia igual, y al cerrarla ya no hablaria de lo ultimo que
  // se hizo.
  it('abrir otra hoja se lo lleva', async () => {
    mocks.api.crypto.sell.mockResolvedValue({ success: true, data: { ...venta, repetida: true } });
    const user = userEvent.setup();
    montar();

    await vender(user);
    await screen.findByText(YA_HECHA);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: /Comprar/ })[0]);
    await screen.findByRole('dialog');

    expect(screen.queryByText(YA_HECHA)).not.toBeInTheDocument();
  });

  it('tras el segundo factor, la repetida tampoco se anota', async () => {
    mocks.api.crypto.sell
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa' } })
      .mockResolvedValue({ success: true, data: { ...venta, repetida: true } });
    const user = userEvent.setup();
    montar();

    await vender(user);
    await user.click(await screen.findByRole('button', { name: 'verificar-mfa' }));

    expect(await screen.findByText(YA_HECHA)).toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SELL_CRYPTO' }));
    const [a, b] = mocks.api.crypto.sell.mock.calls.map(([req]) => req.idempotencyKey as string);
    expect(b).toBe(a);
  });
});
