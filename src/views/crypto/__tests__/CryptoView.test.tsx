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
  mocks.dispatch.mockReset();
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
    expect(mocks.dispatch).not.toHaveBeenCalled();
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
    expect(mocks.dispatch).not.toHaveBeenCalled();
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
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});
