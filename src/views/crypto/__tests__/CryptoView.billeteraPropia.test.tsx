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
    // Apagada es una respuesta del servidor: no se confunde con un fallo.
    expect(screen.queryByText(es.bp_disponibilidad_error)).toBeNull();
  });

  it('si no se pudo preguntar, no es una billetera apagada: avisa y deja reintentar', async () => {
    mocks.api.crypto.getAvailability.mockRejectedValue(new Error('sin red'));
    montar();
    expect(await screen.findByText(es.bp_disponibilidad_error, undefined, ESPERA)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: es.error_retry })).toBeEnabled();
    expect(screen.queryByRole('button', { name: es.bp_tab })).toBeNull();
  });

  it('un 500 del servidor tampoco se toma por apagada', async () => {
    mocks.api.crypto.getAvailability.mockResolvedValue({ success: false, error: { code: 'FETCH_FAILED', message: 'HTTP 500' } });
    montar();
    expect(await screen.findByText(es.bp_disponibilidad_error, undefined, ESPERA)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: es.bp_tab })).toBeNull();
  });

  it('si el reintento vuelve a fallar, el aviso sigue y se puede reintentar otra vez', async () => {
    mocks.api.crypto.getAvailability
      .mockRejectedValueOnce(new Error('sin red'))
      .mockResolvedValueOnce({ success: false, error: { code: 'FETCH_FAILED', message: 'HTTP 500' } })
      .mockResolvedValue(respuesta(true));
    montar();
    await userEvent.click(await screen.findByRole('button', { name: es.error_retry }, ESPERA));
    await waitFor(() => expect(mocks.api.crypto.getAvailability).toHaveBeenCalledTimes(2));
    // Sigue el aviso y el boton vuelve a estar disponible (no se queda trabado).
    expect(screen.getByText(es.bp_disponibilidad_error)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: es.error_retry })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: es.error_retry }));
    expect(await screen.findByRole('button', { name: es.bp_tab }, ESPERA)).toBeInTheDocument();
    expect(screen.queryByText(es.bp_disponibilidad_error)).toBeNull();
  });

  it('al reintentar y contestar el servidor, se va el aviso y aparece la pestana', async () => {
    mocks.api.crypto.getAvailability
      .mockResolvedValueOnce({ success: false, error: { code: 'FETCH_FAILED', message: 'HTTP 500' } })
      .mockResolvedValue(respuesta(true));
    montar();
    await userEvent.click(await screen.findByRole('button', { name: es.error_retry }, ESPERA));
    expect(await screen.findByRole('button', { name: es.bp_tab }, ESPERA)).toBeInTheDocument();
    expect(screen.queryByText(es.bp_disponibilidad_error)).toBeNull();
    expect(mocks.api.crypto.getAvailability).toHaveBeenCalledTimes(2);
  });

  it('al reintentar y contestar que esta apagada, el aviso se va y la pestana no aparece', async () => {
    mocks.api.crypto.getAvailability
      .mockRejectedValueOnce(new Error('sin red'))
      .mockResolvedValue(respuesta(false));
    montar();
    await userEvent.click(await screen.findByRole('button', { name: es.error_retry }, ESPERA));
    await waitFor(() => expect(screen.queryByText(es.bp_disponibilidad_error)).toBeNull());
    expect(screen.queryByRole('button', { name: es.bp_tab })).toBeNull();
  });

  it('aparece cuando el servidor la ofrece y en la web dice que vive en la app', async () => {
    mocks.api.crypto.getAvailability.mockResolvedValue(respuesta(true));
    montar();
    await userEvent.click(await screen.findByRole('button', { name: es.bp_tab }, ESPERA));
    expect(await screen.findByText(es.bp_web_titulo, undefined, ESPERA)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: es.bp_crear })).toBeNull();
  // Abrir la pestana baja el bloque de la billetera (viem y las llaves): en frio tarda mas que el limite de 5 s.
  }, 20_000);
});
