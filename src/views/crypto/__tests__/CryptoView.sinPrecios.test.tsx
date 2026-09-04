import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

// La pantalla mostraba el punto verde de "precios al dia" y un total de $0.00
// aunque el backend no devolviera un solo precio: degrada a una cache vacia y
// responde 200 igual. Tener saldo y ningun precio no es una cartera que vale
// cero, es una cartera que no se puede valorar. Estas pruebas fijan las dos
// mitades: se avisa, y no se inventa un numero.
//
// Archivo aparte del CryptoView.test.tsx principal porque necesita variar el
// estado y la respuesta de precios entre casos, y aquel los tiene fijos.
const mocks = vi.hoisted(() => ({
  getPrices: vi.fn(),
  precioBTC: 0,
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ crypto: { convert: vi.fn(), stake: vi.fn(), unstake: vi.fn(), claimYield: vi.fn() } }),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/services/cryptoPrices', () => ({
  cryptoPriceService: {
    getPrices: mocks.getPrices,
    getAllPriceHistories: vi.fn().mockResolvedValue({}),
  },
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
        assets: [
          {
            symbol: 'BTC',
            name: 'Bitcoin',
            balance: 0.5,
            currentPrice: mocks.precioBTC,
            change24h: 0,
            icon: 'B',
            color: '#123456',
            priceHistory: [],
          },
        ],
        transactions: [],
        stakingPositions: [],
        priceAlerts: [],
        favoriteAssets: [],
      },
    },
    dispatch: vi.fn(),
  }),
}));

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
  mocks.getPrices.mockReset();
  mocks.precioBTC = 0;
});

describe('CryptoView — sin precios lo dice, no inventa un total', () => {
  it('avisa cuando el backend no devuelve ningun precio', async () => {
    mocks.getPrices.mockResolvedValue([]);
    montar();

    expect(await screen.findByText('No se pudieron actualizar los precios')).toBeInTheDocument();
    expect(
      screen.getByText('Los valores pueden estar desactualizados. Se vuelve a intentar solo.'),
    ).toBeInTheDocument();
  });

  it('muestra un guion en vez de un total falso cuando hay saldo y ningun precio', async () => {
    mocks.getPrices.mockResolvedValue([]);
    montar();

    await screen.findByText('No se pudieron actualizar los precios');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('—');
    // El total falso que se estaba mostrando antes del arreglo, en el
    // encabezado y en la fila del activo.
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('no inventa una perdida en la insignia de ganancia', async () => {
    mocks.getPrices.mockResolvedValue([]);
    montar();

    await screen.findByText('No se pudieron actualizar los precios');
    // Con precio 0 la ganancia se calculaba contra el precio de compra y salia
    // una perdida enorme que nadie tuvo. Nada de porcentajes ni de montos.
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/-\$/)).not.toBeInTheDocument();
  });

  it('tambien avisa si la consulta de precios falla', async () => {
    mocks.getPrices.mockRejectedValue(new Error('sin red'));
    montar();

    expect(await screen.findByText('No se pudieron actualizar los precios')).toBeInTheDocument();
  });

  it('no avisa ni oculta el total cuando los precios llegan', async () => {
    mocks.precioBTC = 40000;
    mocks.getPrices.mockResolvedValue([
      { symbol: 'BTC', price: 40000, change24h: 1, volume24h: 0, marketCap: 0 },
    ]);
    montar();

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('—');
    });
    expect(screen.queryByText('No se pudieron actualizar los precios')).not.toBeInTheDocument();
  });
});
