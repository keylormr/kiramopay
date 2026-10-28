import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

// Los colones de la pantalla de cripto salian de multiplicar por una tasa de
// respaldo (515) cuando el servidor no daba ninguna: un total y un "≈" en colones
// con una tasa que nadie confirmo. Sin tipo de cambio la pantalla sigue dando
// todo en dolares, que es lo que el servidor si cotiza, y dice que los colones no
// estan disponibles. Lo mismo la venta: el servidor liquida con su propia tasa,
// pero quien vende en colones tiene que ver cuanto recibe antes de confirmar.
const mocks = vi.hoisted(() => ({
  api: {
    crypto: {
      buy: vi.fn(),
      sell: vi.fn(),
      convert: vi.fn(),
      stake: vi.fn(),
      getPriceAlerts: vi.fn().mockResolvedValue({ success: true, data: [] }),
    },
  },
  dispatch: vi.fn(),
  activos: [] as Array<Record<string, unknown>>,
  tasa: { valor: null as number | null },
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
  getUsdToCrcRate: vi.fn(async () => mocks.tasa.valor),
  getCachedUsdToCrcRate: () => mocks.tasa.valor,
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
  Object.values(mocks.api.crypto).forEach((f) => f.mockClear());
  mocks.dispatch.mockReset();
  mocks.tasa.valor = null;
  mocks.activos = [activo('BTC', 'Bitcoin', 0.5, 40000)];
});

describe('CryptoView sin tipo de cambio del dolar', () => {
  it('el total sigue en dolares y los colones no se inventan', async () => {
    montar();

    // El valor en dolares no depende del tipo de cambio.
    expect(await screen.findByText('$20,000.00')).toBeInTheDocument();
    expect(screen.getByText('Equivalente en colones no disponible')).toBeInTheDocument();
    // Ninguna cifra en colones en toda la pantalla: ni el total (antes ₡10,300,000
    // con 515), ni el "≈" de cada fila.
    expect(document.body.textContent).not.toContain('₡');
  });

  it('con tipo de cambio muestra los colones como siempre', async () => {
    mocks.tasa.valor = 510;
    montar();

    // 20.000 dolares a 510.
    expect(await screen.findByText('₡10,200,000')).toBeInTheDocument();
    expect(screen.queryByText('Equivalente en colones no disponible')).not.toBeInTheDocument();
  });

  it('vender en colones queda cerrado y dice por que; en dolares se puede', async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getAllByRole('button', { name: /Vender/ })[0]);
    const hoja = within(await screen.findByRole('dialog'));
    await user.type(hoja.getByPlaceholderText('0.00'), '0.1');

    // No hay "≈ ₡..." con una tasa inventada.
    expect(hoja.queryByText(/₡/)).not.toBeInTheDocument();
    expect(hoja.getByText(/No tenemos el tipo de cambio del dólar ahora/)).toBeInTheDocument();
    const enColones = hoja.getByRole('button', { name: /Vender y recibir CRC/ });
    expect(enColones).toBeDisabled();

    await user.click(hoja.getByRole('button', { name: 'USD' }));
    expect(hoja.getByRole('button', { name: /Vender y recibir USD/ })).toBeEnabled();
    expect(hoja.queryByText(/No tenemos el tipo de cambio del dólar ahora/)).not.toBeInTheDocument();
    expect(mocks.api.crypto.sell).not.toHaveBeenCalled();
  });
});
