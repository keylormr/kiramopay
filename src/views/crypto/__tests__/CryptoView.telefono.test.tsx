import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

// La pestana de cripto a 390 px (recorrido contra el servidor real):
// - el total "$5,925.00" (169 px) no cabia en la mitad de la tarjeta que le
//   dejaba la pastilla de ganancia, y pisaba el borde;
// - "PORTFOLIO TOTAL" se partia en dos lineas encima del punto de estado;
// - "Convertir" tocaba el borde de su boton;
// - en la fila de Ethereum, el nombre y el precio quedaban pegados.
// jsdom no mide, asi que se fijan las clases que lo resuelven.
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

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      crypto: {
        assets: [{
          id: 'eth', symbol: 'ETH', name: 'Ethereum', balance: 1.5, currentPrice: 2565, avgBuyPrice: 2500,
          priceChange24h: 1.5, icon: 'E', color: '#627eea', priceHistory: [],
        }],
        transactions: [],
        stakingPositions: [],
        priceAlerts: [],
        favoriteAssets: [],
      },
    },
    dispatch: mocks.dispatch,
  }),
}));

const tiene = (el: HTMLElement, clase: string) =>
  el.className.split(/\s+/).includes(clase);

function montar() {
  localStorage.setItem('kiramopay_language', 'es');
  return render(
    <LanguageProvider>
      <CryptoView />
    </LanguageProvider>,
  );
}

describe('CryptoView a 390 px — el encabezado del portafolio', () => {
  it('la etiqueta del total no se parte en dos lineas', async () => {
    montar();

    const etiqueta = await screen.findByText(/^(Portafolio total|Portfolio Total)$/i);
    expect(tiene(etiqueta, 'whitespace-nowrap')).toBe(true);
  });

  it('el total y la pastilla de ganancia se apilan en pantalla angosta', async () => {
    montar();

    const total = await screen.findByRole('heading', { level: 1 });
    // columna del total -> fila del encabezado
    const fila = total.parentElement!.parentElement as HTMLElement;
    expect(tiene(fila, 'flex-col')).toBe(true);
    expect(fila.className).toMatch(/min-\[\d+px\]:flex-row|sm:flex-row/);
  });

  it('los botones de accion pueden encogerse sin pisar su texto', async () => {
    montar();

    const convertir = await screen.findByRole('button', { name: /Convertir/ });
    expect(tiene(convertir, 'min-w-0')).toBe(true);
    // Icono sobre el texto en pantalla angosta: el texto ya no compite con el
    // icono por los ~100 px del boton.
    expect(tiene(convertir, 'flex-col')).toBe(true);
  });
});

describe('CryptoView a 390 px — las filas de activos', () => {
  it('el nombre se trunca antes de pegarse al precio', async () => {
    montar();

    const nombre = await screen.findByText('Ethereum');
    expect(tiene(nombre, 'truncate')).toBe(true);
    const fila = nombre.parentElement as HTMLElement;
    expect(tiene(fila, 'gap-2')).toBe(true);
  });

  it('el precio no se encoge ni se parte', async () => {
    montar();

    const nombre = await screen.findByText('Ethereum');
    const precio = nombre.nextElementSibling as HTMLElement;
    expect(tiene(precio, 'shrink-0')).toBe(true);
    expect(tiene(precio, 'whitespace-nowrap')).toBe(true);
  });
});
