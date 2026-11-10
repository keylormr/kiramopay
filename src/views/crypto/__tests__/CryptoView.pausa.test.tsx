import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';
import { mensajeDeErrorCripto } from '../erroresCripto';
import es from '@/i18n/languages/es';

// La pausa de produccion: lo que abre una posicion no se ofrece, lo que deja
// salir de ella sigue, y si la pantalla no logra preguntar decide el servidor.
const mocks = vi.hoisted(() => ({
  api: { crypto: { getAvailability: vi.fn(), buy: vi.fn(), sell: vi.fn(), convert: vi.fn(), stake: vi.fn() } },
  dispatch: vi.fn(),
  activos: [] as Array<Record<string, unknown>>,
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
        transactions: [],
        stakingPositions: mocks.posiciones,
        priceAlerts: [],
        favoriteAssets: [],
      },
    },
    dispatch: mocks.dispatch,
  }),
}));

const eth = (balance: number) => ({
  id: 'eth', symbol: 'ETH', name: 'Ethereum', balance, currentPrice: 2000, avgBuyPrice: 2000,
  priceChange24h: 1.5, icon: 'E', color: '#123456', priceHistory: [],
});

// Montar la vista completa tarda mas de un segundo cuando corren todas las pruebas.
const ESPERA = { timeout: 8000 };

const montar = () => render(<LanguageProvider><CryptoView /></LanguageProvider>);
const respuesta = (purchasesActive: boolean) => ({ success: true, data: { purchasesActive } });
const boton = (nombre: string) => screen.queryByRole('button', { name: nombre });

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  mocks.activos.length = 0;
  mocks.posiciones.length = 0;
  mocks.activos.push(eth(1));
  mocks.api.crypto.getAvailability.mockReset();
});

describe('la pausa de compras', () => {
  it('en pausa avisa, y deja vender pero no comprar ni convertir', async () => {
    mocks.api.crypto.getAvailability.mockResolvedValue(respuesta(false));
    montar();

    await screen.findByText(es.crypto_pausa_titulo, {}, ESPERA);
    expect(screen.getByText(es.crypto_pausa_cuerpo)).toBeInTheDocument();
    expect(boton(es.buy)).toBeNull();
    expect(boton(es.convert)).toBeNull();
    expect(boton(es.sell)).not.toBeNull();
  });

  it('en pausa y sin nada que vender no ofrece ninguna operacion', async () => {
    mocks.activos.length = 0;
    mocks.activos.push(eth(0));
    mocks.api.crypto.getAvailability.mockResolvedValue(respuesta(false));
    montar();

    await screen.findByText(es.crypto_pausa_titulo, {}, ESPERA);
    expect(boton(es.sell)).toBeNull();
    expect(boton(es.buy_crypto)).toBeNull();
  });

  it('en pausa el detalle no ofrece comprar ni hacer staking', async () => {
    mocks.api.crypto.getAvailability.mockResolvedValue(respuesta(false));
    montar();
    await screen.findByText(es.crypto_pausa_titulo, {}, ESPERA);

    await userEvent.click(screen.getByText('Ethereum'));

    const hoja = await screen.findByRole('dialog', {}, ESPERA);
    expect(within(hoja).getByRole('button', { name: es.sell })).toBeInTheDocument();
    expect(within(hoja).queryByRole('button', { name: es.buy })).toBeNull();
    expect(within(hoja).queryByRole('button', { name: es.crypto_do_staking })).toBeNull();
  });

  it('en pausa la pestana de staking no invita a empezar', async () => {
    mocks.api.crypto.getAvailability.mockResolvedValue(respuesta(false));
    montar();
    await screen.findByText(es.crypto_pausa_titulo, {}, ESPERA);

    await userEvent.click(screen.getByRole('button', { name: es.staking }));

    expect(screen.getByText(es.crypto_staking_vacio)).toBeInTheDocument();
    expect(boton(es.start_staking)).toBeNull();
  });

  it('abierta ofrece todo y no avisa nada', async () => {
    mocks.api.crypto.getAvailability.mockResolvedValue(respuesta(true));
    montar();

    await waitFor(() => expect(boton(es.buy)).not.toBeNull(), ESPERA);
    expect(boton(es.convert)).not.toBeNull();
    expect(screen.queryByText(es.crypto_pausa_titulo)).toBeNull();
  });

  it('si no logra preguntar, ofrece y deja que decida el servidor', async () => {
    mocks.api.crypto.getAvailability.mockRejectedValue(new Error('sin red'));
    montar();

    await waitFor(() => expect(boton(es.buy)).not.toBeNull(), ESPERA);
    expect(screen.queryByText(es.crypto_pausa_titulo)).toBeNull();
  });

  it('el staking ya no promete rendimiento', () => {
    expect(es.crypto_staking_sin_rendimiento).not.toMatch(/próximamente/i);
    expect(es.crypto_staking_no_yield).not.toMatch(/aún/i);
    expect(es.help_staking_body).not.toMatch(/todavía|porcentaje/i);
  });

  it('el rechazo del servidor se explica con el mismo texto del aviso', () => {
    const t = (clave: string) => (es as unknown as Record<string, string>)[clave];
    expect(mensajeDeErrorCripto({ code: 'CRYPTO_PAUSED' }, t)).toBe(es.crypto_pausa_cuerpo);
  });
});
