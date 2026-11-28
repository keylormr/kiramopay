import { act, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

// Tocar "Alerta de precio: BTC" lleva a Cripto en esa moneda: se abre su
// detalle. Una moneda que la lista no tiene deja Cripto como esta.
const mocks = vi.hoisted(() => ({
  api: { crypto: { buy: vi.fn(), sell: vi.fn(), convert: vi.fn(), stake: vi.fn() } },
  dispatch: vi.fn(),
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

const activo = (id: string, symbol: string, name: string, balance: number) => ({
  id, symbol, name, balance, currentPrice: 40000, avgBuyPrice: 40000,
  priceChange24h: 1.5, icon: symbol[0], color: '#123456', priceHistory: [],
});

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      crypto: {
        assets: [activo('btc', 'BTC', 'Bitcoin', 0.5), activo('eth', 'ETH', 'Ethereum', 0)],
        transactions: [],
        stakingPositions: [],
        priceAlerts: [],
        favoriteAssets: [],
      },
    },
    dispatch: mocks.dispatch,
  }),
}));

function montar(monedaPedida: { simbolo: string; vez: number } | null, atendida = vi.fn()) {
  render(
    <LanguageProvider>
      <CryptoView monedaPedida={monedaPedida} onMonedaAtendida={atendida} />
    </LanguageProvider>,
  );
  return atendida;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('CryptoView: la moneda de una alerta tocada', () => {
  it('abre el detalle de esa moneda, aunque no se tenga saldo en ella, y suelta el pedido', async () => {
    const atendida = montar({ simbolo: 'ETH', vez: 1 });

    expect(await screen.findByRole('dialog', { name: 'Ethereum' })).toBeInTheDocument();
    await waitFor(() => expect(atendida).toHaveBeenCalledTimes(1));
  });

  it('una moneda que la lista no tiene deja Cripto como esta', async () => {
    const atendida = montar({ simbolo: 'DOGE', vez: 1 });

    await waitFor(() => expect(atendida).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sin pedido (abierta desde la barra) no abre ningun detalle', async () => {
    const atendida = montar(null);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByRole('dialog', { name: 'Bitcoin' })).not.toBeInTheDocument();
    expect(atendida).not.toHaveBeenCalled();
  });
});
