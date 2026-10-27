import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

// Dos cifras distintas se leian como una sola en la cartera de cripto:
// - El porcentaje de la fila y el del encabezado son la ganancia o perdida
//   desde la compra, pero no lo decia nada.
// - La curva dibuja siete dias de precios y se pintaba segun el cambio de 24
//   horas: Bitcoin "+3,33%" en verde junto a una linea roja que caia, y
//   Ethereum "-7,22%" en rojo junto a una verde que tambien caia.
// Ahora la curva se pinta segun la tendencia de lo que dibuja y los porcentajes
// dicen a que periodo o base se refieren.
const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  activos: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    crypto: {
      convert: vi.fn(),
      stake: vi.fn(),
      unstake: vi.fn(),
      claimYield: vi.fn(),
      getPriceAlerts: vi.fn().mockResolvedValue({ success: true, data: [] }),
    },
  }),
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
        transactions: [],
        stakingPositions: [],
        priceAlerts: [],
        favoriteAssets: [],
      },
    },
    dispatch: mocks.dispatch,
  }),
}));

const VERDE = '#10B981';
const ROJO = '#EF4444';

const activo = (symbol: string, name: string, extra: Record<string, unknown>) => ({
  id: symbol.toLowerCase(),
  symbol,
  name,
  balance: 1,
  currentPrice: 100,
  avgBuyPrice: 100,
  priceChange24h: 0,
  icon: symbol[0],
  color: '#123456',
  priceHistory: [],
  ...extra,
});

// Bitcoin: gana desde la compra y sube en 24 h, pero la curva de la semana cae.
// Ethereum: pierde desde la compra y baja en 24 h, pero la curva de la semana sube.
const bitcoin = () =>
  activo('BTC', 'Bitcoin', {
    currentPrice: 110,
    avgBuyPrice: 100,
    priceChange24h: 2,
    priceHistory: [130, 124, 118, 114, 110],
  });
const ethereum = () =>
  activo('ETH', 'Ethereum', {
    currentPrice: 90,
    avgBuyPrice: 100,
    priceChange24h: -1.5,
    priceHistory: [80, 83, 86, 88, 90],
  });

function montar() {
  return render(
    <LanguageProvider>
      <CryptoView />
    </LanguageProvider>,
  );
}

// El color del trazo de la curva dentro de una fila.
const trazoDe = (fila: HTMLElement) => fila.querySelector('svg path[fill="none"]')?.getAttribute('stroke');

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.dispatch.mockReset();
  mocks.activos = [bitcoin(), ethereum()];
});

describe('cartera: la curva se pinta segun lo que dibuja', () => {
  it('la curva que cae es roja y la que sube es verde, diga lo que diga el cambio de 24 h', () => {
    montar();

    // Bitcoin sube en 24 h (+2) pero la semana que dibuja cae: roja.
    expect(trazoDe(screen.getByRole('button', { name: /Bitcoin/ }))).toBe(ROJO);
    // Ethereum baja en 24 h (-1,5) pero la semana que dibuja sube: verde.
    expect(trazoDe(screen.getByRole('button', { name: /Ethereum/ }))).toBe(VERDE);
  });

  it('en el mercado la curva sigue el mismo criterio', async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole('button', { name: 'Mercado' }));

    expect(trazoDe(screen.getByRole('button', { name: /Bitcoin/ }))).toBe(ROJO);
    expect(trazoDe(screen.getByRole('button', { name: /Ethereum/ }))).toBe(VERDE);
  });
});

describe('cartera: los porcentajes dicen de que son', () => {
  it('cada fila rotula su ganancia o perdida como desde la compra', () => {
    montar();

    const filaBtc = within(screen.getByRole('button', { name: /Bitcoin/ }));
    expect(filaBtc.getByText('+10.00%')).toBeInTheDocument();
    expect(filaBtc.getByText('desde la compra')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: /Ethereum/ })).getByText('desde la compra')).toBeInTheDocument();
  });

  it('el encabezado rotula su ganancia o perdida como desde la compra', () => {
    montar();

    const encabezado = screen.getByRole('heading', { level: 1 }).closest('.uv-gradient-brand') as HTMLElement;
    expect(within(encabezado).getByText('desde la compra')).toBeInTheDocument();
  });

  it('en el mercado el porcentaje dice que es el cambio de 24 h', async () => {
    const user = userEvent.setup();
    montar();

    await user.click(screen.getByRole('button', { name: 'Mercado' }));

    const filaBtc = within(screen.getByRole('button', { name: /Bitcoin/ }));
    expect(filaBtc.getByText('+2.00%')).toBeInTheDocument();
    expect(filaBtc.getByText('24 h')).toBeInTheDocument();
    // En el mercado no hay compra de por medio.
    expect(filaBtc.queryByText('desde la compra')).not.toBeInTheDocument();
  });
});
