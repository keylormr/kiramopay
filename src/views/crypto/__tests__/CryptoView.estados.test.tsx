import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { CryptoView } from '../CryptoView';

// El estado de un movimiento de cripto. El adaptador convertia lo que no
// conocia en 'completed', el detalle decia "Fallida" de todo lo que no era
// completado ni pendiente, y la fila no decia nada: una compra que fallo se veia
// igual que una hecha, con la cripto en verde como si hubiera entrado.
const mocks = vi.hoisted(() => ({
  api: { crypto: { buy: vi.fn(), sell: vi.fn(), convert: vi.fn(), stake: vi.fn() } },
  dispatch: vi.fn(),
  movimientos: [] as Array<Record<string, unknown>>,
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
          id: 'btc', symbol: 'BTC', name: 'Bitcoin', balance: 0.5, currentPrice: 40000, avgBuyPrice: 40000,
          priceChange24h: 1.5, icon: 'B', color: '#123456', priceHistory: [],
        }],
        transactions: mocks.movimientos,
        stakingPositions: [],
        priceAlerts: [],
        favoriteAssets: [],
      },
    },
    dispatch: mocks.dispatch,
  }),
}));

// Una compra de 0.01 BTC por US$400.
const compra = (status: string) => ({
  id: `c-${status}`, type: 'buy', fromAsset: 'USD', fromAmount: 400, toAsset: 'BTC', toAmount: 0.01,
  price: 40000, priceCurrency: 'USD', fee: 0, date: '2026-10-15T15:00:00Z', status,
});

function montar(idioma = 'es') {
  localStorage.setItem('kiramopay_language', idioma);
  return render(
    <LanguageProvider>
      <CryptoView />
    </LanguageProvider>,
  );
}

async function abrirDetalle(nombreFila: RegExp) {
  const user = userEvent.setup();
  // El ingles llega en su propio trozo: hasta entonces se ve en espanol.
  await user.click(await screen.findByRole('button', { name: nombreFila }));
  return within(await screen.findByRole('dialog'));
}

beforeEach(() => {
  localStorage.clear();
  mocks.dispatch.mockReset();
  mocks.movimientos = [];
});

describe('el detalle dice el estado con su nombre y su color', () => {
  it.each([
    ['completed', 'Completado', 'uv-chip-success'],
    ['pending', 'Pendiente', 'uv-chip-warning'],
    ['failed', 'Fallido', 'uv-chip-danger'],
  ])('%s se lee "%s"', async (status, texto, chip) => {
    mocks.movimientos = [compra(status)];
    montar();

    const hoja = await abrirDetalle(/^Compra USD → BTC/);
    expect(hoja.getByText(texto)).toHaveClass(chip);
  });

  it('un estado que la app no conoce se lee "Sin confirmar", nunca completado ni fallido', async () => {
    mocks.movimientos = [compra('unknown')];
    montar();

    const hoja = await abrirDetalle(/^Compra USD → BTC/);
    const rotulo = hoja.getByText('Sin confirmar');
    expect(rotulo).not.toHaveClass('uv-chip-success');
    expect(rotulo).not.toHaveClass('uv-chip-danger');
    expect(hoja.queryByText(/Completado/)).not.toBeInTheDocument();
    expect(hoja.queryByText(/Fallid/)).not.toBeInTheDocument();
  });

  it('en ingles tambien', async () => {
    mocks.movimientos = [compra('unknown')];
    montar('en');

    const hoja = await abrirDetalle(/^Buy USD → BTC/);
    expect(hoja.getByText('Unconfirmed')).toBeInTheDocument();
    expect(hoja.queryByText(/Completed/)).not.toBeInTheDocument();
  });

  it('en una compra fallida lo entregado y lo recibido van tachados: no se movio', async () => {
    mocks.movimientos = [compra('failed')];
    montar();

    const hoja = await abrirDetalle(/^Compra USD → BTC/);
    expect(hoja.getByText('$400.00')).toHaveClass('line-through');
    expect(hoja.getByText('0.01 BTC')).toHaveClass('line-through');
    expect(hoja.getByText('0.01 BTC')).not.toHaveClass('text-green-500');
  });

  it('en una completada no', async () => {
    mocks.movimientos = [compra('completed')];
    montar();

    const hoja = await abrirDetalle(/^Compra USD → BTC/);
    expect(hoja.getByText('0.01 BTC')).not.toHaveClass('line-through');
    expect(hoja.getByText('0.01 BTC')).toHaveClass('text-green-500');
  });
});

describe('la fila avisa lo que no esta completado', () => {
  it.each([
    ['pending', 'Pendiente', 'uv-chip-warning'],
    ['failed', 'Fallido', 'uv-chip-danger'],
    ['unknown', 'Sin confirmar', null],
  ])('%s lleva el rotulo "%s"', (status, texto, chip) => {
    mocks.movimientos = [compra(status)];
    montar();

    const rotulo = within(screen.getByRole('button', { name: /^Compra USD → BTC/ })).getByText(texto);
    if (chip) expect(rotulo).toHaveClass(chip);
    else expect(rotulo).not.toHaveClass('uv-chip-success');
  });

  it('una completada no lleva rotulo, como hasta ahora', () => {
    mocks.movimientos = [compra('completed')];
    montar();

    const fila = within(screen.getByRole('button', { name: /^Compra USD → BTC/ }));
    expect(fila.queryByText('Completado')).not.toBeInTheDocument();
    expect(fila.getByText('+0.01 BTC')).not.toHaveClass('line-through');
  });

  it('la cripto de una compra fallida va tachada y no en verde', () => {
    mocks.movimientos = [compra('failed')];
    montar();

    const fila = within(screen.getByRole('button', { name: /^Compra USD → BTC/ }));
    expect(fila.getByText('+0.01 BTC')).toHaveClass('line-through');
    expect(fila.getByText('+0.01 BTC')).not.toHaveClass('text-green-500');
    expect(fila.getByText('-$400.00')).toHaveClass('line-through');
  });
});
