import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';
import es from '@/i18n/languages/es';

// La billetera propia: la pestana solo aparece cuando el servidor la ofrece, y
// en la web (sin almacen seguro) explica que vive en la app.
const mocks = vi.hoisted(() => ({
  api: { crypto: { getAvailability: vi.fn() } },
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
      user: { id: 'u-1', username: 'keilor' },
      accounts: [{ ccy: 'CRC', balance: 1_000_000, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      crypto: { assets: [], transactions: [], stakingPositions: [], priceAlerts: [], favoriteAssets: [] },
    },
    dispatch: mocks.dispatch,
  }),
}));

// Montar la vista completa tarda mas de un segundo cuando corren todas las pruebas.
const ESPERA = { timeout: 8000 };

const montar = () => render(<LanguageProvider><CryptoView /></LanguageProvider>);
const respuesta = (selfCustodyActive: boolean) => ({ success: true, data: { purchasesActive: true, selfCustodyActive } });

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  mocks.api.crypto.getAvailability.mockReset();
});

describe('la pestana de la billetera propia', () => {
  it('no aparece si el servidor no la ofrece', async () => {
    mocks.api.crypto.getAvailability.mockResolvedValue(respuesta(false));
    montar();
    await screen.findByRole('button', { name: es.crypto_my_portfolio }, ESPERA);
    await waitFor(() => expect(mocks.api.crypto.getAvailability).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: es.bp_tab })).toBeNull();
  });

  it('no aparece si no se pudo preguntar', async () => {
    mocks.api.crypto.getAvailability.mockRejectedValue(new Error('sin red'));
    montar();
    await screen.findByRole('button', { name: es.crypto_my_portfolio }, ESPERA);
    await waitFor(() => expect(mocks.api.crypto.getAvailability).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: es.bp_tab })).toBeNull();
  });

  it('aparece cuando el servidor la ofrece y en la web dice que vive en la app', async () => {
    mocks.api.crypto.getAvailability.mockResolvedValue(respuesta(true));
    montar();
    await userEvent.click(await screen.findByRole('button', { name: es.bp_tab }, ESPERA));
    expect(await screen.findByText(es.bp_web_titulo, undefined, ESPERA)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: es.bp_crear })).toBeNull();
  });
});
