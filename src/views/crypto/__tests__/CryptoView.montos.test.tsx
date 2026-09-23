import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

// Dos defectos de las hojas de operar: lo que se anotaba despues de comprar,
// vender o convertir era el estimado de la pantalla y no lo que hizo el
// servidor, y cuatro campos de monto tenian una caja de ancho fijo que recortaba
// la cantidad a partir de unos pocos digitos.
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
  activos: [] as Array<Record<string, unknown>>,
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

// El tipo de cambio de la pantalla (510) no es el del servidor: por eso el
// estimado de una venta en colones y lo que se acredita no coinciden.
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
  ];
});

// El precio y las cantidades los pone el servidor, y el reintento con la misma
// llave devuelve la operacion de aquella vez, con el precio de entonces. Lo que
// se guarda tiene que ser eso, con su id, y no lo que la pantalla calculo con el
// precio que tenia a mano.
describe('lo que se anota es lo que hizo el servidor', () => {
  it('compra: la cantidad y el precio son los del servidor', async () => {
    // En pantalla, 10 USD a 40.000 son 0,00025 BTC; el servidor liquido a 40.100.
    const compra = {
      id: '6f1c2a90-0000-4000-8000-000000000001', type: 'buy', fromAsset: 'USD', fromAmount: 10,
      toAsset: 'BTC', toAmount: 0.00024938, price: 40100, priceCurrency: 'USD', fee: 0,
      date: '2026-09-23T13:00:00Z', status: 'completed',
    };
    mocks.api.crypto.buy.mockResolvedValue({ success: true, data: compra });
    const user = userEvent.setup();
    montar();

    await user.click(screen.getAllByRole('button', { name: /Comprar/ })[0]);
    const hoja = within(await screen.findByRole('dialog'));
    await user.type(hoja.getByPlaceholderText('0.00'), '10');
    await user.click(hoja.getByRole('button', { name: 'Comprar BTC' }));

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'BUY_CRYPTO', payload: compra }),
    );
  });

  it('venta en colones: lo acreditado es lo del servidor, no el estimado de la pantalla', async () => {
    // En pantalla, 0,1 BTC a 40.000 y 510 son 2.040.000 colones; el servidor
    // acredito 2.060.000 con su propio tipo de cambio.
    const venta = {
      id: '6f1c2a90-0000-4000-8000-000000000002', type: 'sell', fromAsset: 'BTC', fromAmount: 0.1,
      toAsset: 'CRC', toAmount: 2_060_000, price: 20_600_000, priceCurrency: 'CRC', fee: 0,
      date: '2026-09-23T13:00:00Z', status: 'completed',
    };
    mocks.api.crypto.sell.mockResolvedValue({ success: true, data: venta });
    const user = userEvent.setup();
    montar();

    await user.click(screen.getAllByRole('button', { name: /Vender/ })[0]);
    const hoja = within(await screen.findByRole('dialog'));
    await user.type(hoja.getByPlaceholderText('0.00'), '0.1');
    expect(hoja.getByText(/≈ ₡2,040,000/)).toBeInTheDocument();
    await user.click(hoja.getByRole('button', { name: /Vender y recibir CRC/ }));

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'SELL_CRYPTO', payload: venta }),
    );
  });

  it('conversion: lo recibido es lo que calculo el servidor', async () => {
    // En pantalla, 0,1 BTC a 40.000 son 1,6 ETH a 2.500; el servidor dio 1,58.
    const conversion = {
      id: '6f1c2a90-0000-4000-8000-000000000003', type: 'convert', fromAsset: 'BTC', fromAmount: 0.1,
      toAsset: 'ETH', toAmount: 1.58, price: 2531.65, priceCurrency: 'USD', fee: 0,
      date: '2026-09-23T13:00:00Z', status: 'completed',
    };
    mocks.api.crypto.convert.mockResolvedValue({ success: true, data: conversion });
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole('button', { name: /Convertir/ }));
    const hoja = within(await screen.findByRole('dialog'));
    await user.type(hoja.getByPlaceholderText('0.00'), '0.1');
    await user.click(hoja.getByRole('button', { name: 'Convertir' }));

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'CONVERT_CRYPTO', payload: conversion }),
    );
  });
});

// Con una caja de ancho fijo (w-48) y la letra grande de estas hojas, una
// cantidad de cripto con sus decimales no cabia y se veia cortada. La hoja de
// compra ya usaba el ancho que sigue al texto; vender, convertir y apartar no.
describe('el campo de monto crece con lo que se escribe', () => {
  const noRecortado = async (hoja: ReturnType<typeof within>, user: ReturnType<typeof userEvent.setup>) => {
    const campo = hoja.getByPlaceholderText('0.00') as HTMLInputElement;
    await user.type(campo, '0.123456');
    expect(campo).toHaveValue('0.123456');
    expect(campo.style.width).toMatch(/^\d+ch$/);
  };

  it('al vender', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getAllByRole('button', { name: /Vender/ })[0]);
    await noRecortado(within(await screen.findByRole('dialog')), user);
  });

  it('al convertir', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('button', { name: /Convertir/ }));
    await noRecortado(within(await screen.findByRole('dialog')), user);
  });

  it('al apartar para staking', async () => {
    const user = userEvent.setup();
    montar();
    await user.click(screen.getByRole('button', { name: /Ethereum/ }));
    await user.click(await screen.findByRole('button', { name: /Hacer Staking/ }));
    await noRecortado(within(await screen.findByRole('dialog', { name: /Staking ETH/ })), user);
  });
});
