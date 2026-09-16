import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

const mocks = vi.hoisted(() => ({
  api: {
    crypto: {
      convert: vi.fn(),
      stake: vi.fn(),
      unstake: vi.fn(),
      claimYield: vi.fn(),
      getPriceAlerts: vi.fn(),
      addPriceAlert: vi.fn(),
      removePriceAlert: vi.fn(),
    },
  },
  dispatch: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

// Sin red en las pruebas: los precios y el tipo de cambio son fijos. La vista
// lee SIMBOLOS_SIN_FEED al cargarse -para saber que simbolos no dependen del
// feed-, asi que el doble tiene que exportarlo o el modulo ni se evalua.
vi.mock('@/services/cryptoPrices', () => ({
  cryptoPriceService: {
    getPrices: vi.fn().mockResolvedValue([]),
    getAllPriceHistories: vi.fn().mockResolvedValue({}),
  },
  SIMBOLOS_SIN_FEED: ['USDT', 'USDC'],
}));
vi.mock('@/services/fxRate', () => ({
  getUsdToCrcRate: vi.fn().mockResolvedValue(510),
  getCachedUsdToCrcRate: () => 510,
}));

const asset = (symbol: string, balance: number, currentPrice: number) => ({
  symbol,
  name: symbol,
  balance,
  currentPrice,
  change24h: 0,
  // La pestana Mercado los lee: sin ellos no se puede ni abrir.
  priceChange24h: 0,
  avgBuyPrice: currentPrice,
  icon: symbol[0],
  color: '#123456',
  priceHistory: [],
});

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      crypto: {
        assets: [asset('BTC', 0.5, 40000), asset('ETH', 2, 2000)],
        transactions: [],
        stakingPositions: [
          {
            id: 'pos-1',
            asset: 'ETH',
            amount: 1,
            apy: 4,
            earned: 0.02,
            startDate: '01/01/2026',
            locked: false,
          },
        ],
        priceAlerts: [],
        favoriteAssets: [],
      },
    },
    dispatch: mocks.dispatch,
  }),
}));

// La vista copia al estado la lista de alertas que leyo del servidor
// (SET_PRICE_ALERTS). Eso no es una operacion: las pruebas que afirman que un
// rechazo no toca el estado miran todo lo demas.
function operacionesDespachadas() {
  return mocks.dispatch.mock.calls.filter(([accion]) => accion?.type !== 'SET_PRICE_ALERTS');
}

function setup() {
  return render(
    <LanguageProvider>
      <CryptoView />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.api.crypto.convert.mockReset();
  mocks.api.crypto.stake.mockReset();
  mocks.api.crypto.unstake.mockReset();
  mocks.api.crypto.claimYield.mockReset();
  mocks.api.crypto.getPriceAlerts.mockReset();
  mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: true, data: [] });
  mocks.dispatch.mockReset();
});

// Las alertas de precio existian en el servidor y en el estado, pero ninguna
// pantalla permitia usarlas (hallazgo QA n=47).
describe('CryptoView — alertas de precio', () => {
  const alerta = (id: string, status: 'active' | 'triggered') => ({
    id,
    asset: 'BTC',
    targetPrice: 50000,
    condition: 'above' as const,
    active: status === 'active',
    status,
  });

  it('Mercado ofrece las alertas con el conteo de activas que dio el servidor', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({
      success: true,
      data: [alerta('a', 'active'), alerta('b', 'active'), alerta('c', 'triggered')],
    });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Mercado' }));
    const boton = await screen.findByRole('button', { name: 'Alertas de precio, activas: 2' });
    expect(within(boton).getByText('2')).toBeInTheDocument();

    await user.click(boton);
    const hoja = within(await screen.findByRole('dialog'));
    expect(hoja.getByRole('heading', { name: 'Alertas de precio' })).toBeInTheDocument();
    // Abrir la hoja vuelve a leer: el servidor pudo cumplir alguna mientras tanto.
    await waitFor(() => expect(mocks.api.crypto.getPriceAlerts).toHaveBeenCalledTimes(2));
  });

  it('sin una lectura buena no inventa un conteo', async () => {
    mocks.api.crypto.getPriceAlerts.mockResolvedValue({ success: false, error: { code: 'FETCH_FAILED', message: 'x' } });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Mercado' }));
    const boton = await screen.findByRole('button', { name: 'Alertas de precio' });
    expect(within(boton).queryByText(/\d/)).not.toBeInTheDocument();
  });

  it('el detalle de un activo abre la alerta nueva con ese activo', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: /ETH.*2 ETH/ }));
    await user.click(await screen.findByRole('button', { name: 'Crear alerta de precio' }));
    // La hoja del detalle tarda en irse (su animacion de salida): se busca la
    // nueva por su titulo.
    const titulo = await screen.findByRole('heading', { name: 'Nueva alerta' });
    const hoja = within(titulo.closest('[role="dialog"]') as HTMLElement);
    expect(hoja.getByLabelText('Activo')).toHaveValue('ETH');
  });
});

// Convertir, hacer staking, retirarlo y reclamar rendimiento actualizaban el
// estado local y llamaban al servidor con .catch(() => {}): un rechazo se
// tragaba y la pantalla mostraba una operacion que nunca ocurrio. Es el mismo
// defecto que ya se habia corregido en compra y venta.
describe('CryptoView — el servidor decide antes que la pantalla', () => {
  async function abrirConvertir(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Convertir/ }));
    return within(await screen.findByRole('dialog'));
  }

  it('no registra la conversión si el servidor la rechaza', async () => {
    mocks.api.crypto.convert.mockResolvedValue({
      success: false,
      error: { code: 'INSUFFICIENT_FUNDS', message: 'Saldo insuficiente' },
    });
    const user = userEvent.setup();
    setup();

    const d = await abrirConvertir(user);
    await user.type(d.getByPlaceholderText('0.00'), '0.1');
    await user.click(d.getByRole('button', { name: 'Convertir' }));

    expect(await screen.findByText('Saldo insuficiente')).toBeInTheDocument();
    expect(operacionesDespachadas()).toEqual([]);
  });

  // Esta prueba tambien cubre el destino por defecto: la hoja reusaba el estado
  // de la venta, que arranca en 'CRC', y ningun activo del selector coincidia.
  // El <select> mostraba la primera opcion pero el estado seguia en 'CRC', asi
  // que convertir sin tocar el selector no hacia absolutamente nada.
  it('registra la conversión cuando el servidor la acepta', async () => {
    mocks.api.crypto.convert.mockResolvedValue({ success: true, data: {} });
    const user = userEvent.setup();
    setup();

    const d = await abrirConvertir(user);
    await user.type(d.getByPlaceholderText('0.00'), '0.1');
    await user.click(d.getByRole('button', { name: 'Convertir' }));

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CONVERT_CRYPTO' }),
      ),
    );
  });

  it('no retira el staking si el servidor lo rechaza', async () => {
    mocks.api.crypto.unstake.mockResolvedValue({
      success: false,
      error: { code: 'UNSTAKE_FAILED', message: 'No se pudo retirar' },
    });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Staking' }));
    await user.click(await screen.findByRole('button', { name: 'Retirar' }));

    expect(await screen.findByText('No se pudo retirar')).toBeInTheDocument();
    expect(operacionesDespachadas()).toEqual([]);
  });

  it('retira el staking cuando el servidor acepta', async () => {
    mocks.api.crypto.unstake.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Staking' }));
    await user.click(await screen.findByRole('button', { name: 'Retirar' }));

    await waitFor(() =>
      expect(mocks.dispatch).toHaveBeenCalledWith({
        type: 'UNSTAKE_CRYPTO',
        payload: { positionId: 'pos-1' },
      }),
    );
  });

  // El adaptador HTTP devolvia exito con amount 0 y un comentario que decia que
  // el backend acreditaba solo. No existe ese endpoint: la pantalla sumaba una
  // ganancia que ningun servidor respalda.
  it('avisa que el rendimiento no se acredita en vez de sumarlo', async () => {
    mocks.api.crypto.claimYield.mockResolvedValue({
      success: false,
      error: { code: 'CLAIM_NOT_AVAILABLE', message: 'Staking yield is not credited yet' },
    });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('button', { name: 'Staking' }));
    await user.click(await screen.findByRole('button', { name: 'Reclamar' }));

    expect(await screen.findByText(/todavía no se acredita/)).toBeInTheDocument();
    // Y no puede filtrarse el texto crudo del adaptador.
    expect(screen.queryByText(/is not credited yet/)).not.toBeInTheDocument();
    expect(operacionesDespachadas()).toEqual([]);
  });
});
