import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import es from '@/i18n/languages/es';
import { HomeView } from '../HomeView';
import type { Transaction } from '@/types';
import type { SummaryGroup, TransactionSummary, TransactionSummaryParams } from '@/api/repositories/transaction.repository';
import type { ApiResponse } from '@/api/types';

// jsdom no trae ResizeObserver y el grafico del gasto del mes lo usa para
// medirse; sin esto la tarjeta ni siquiera monta.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

const api = vi.hoisted(() => ({
  getSummary: vi.fn<(p: TransactionSummaryParams) => Promise<ApiResponse<TransactionSummary>>>(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ transactions: { getSummary: api.getSummary } }),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <svg data-testid="qr-code" />,
}));

// El Inicio refresca la lista cuando llega un aviso y encadena .catch: el doble
// tiene que devolver una promesa, como el real.
vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn().mockResolvedValue(undefined),
  refreshTransactions: vi.fn().mockResolvedValue(undefined),
}));

const appState = vi.hoisted(() => ({
  transactions: [] as Transaction[],
  baseCurrency: 'CRC',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      transactions: appState.transactions,
      baseCurrency: appState.baseCurrency,
      accounts: [
        { ccy: 'CRC', balance: 500000, symbol: '₡', flag: '🇨🇷', iban: '', name: 'Colones', type: 'fiat' },
        { ccy: 'USD', balance: 100, symbol: '$', flag: '🇺🇸', iban: '', name: 'Dolares', type: 'fiat', rateToUsd: 1 },
      ],
    },
    dispatch: vi.fn(),
  }),
}));

// 13 de septiembre de 2026, mediodia en Costa Rica.
const AHORA = new Date('2026-09-13T18:00:00Z');
const MES = { from: '2026-09-01', to: '2026-10-01' };
// Los mismos trece dias de agosto.
const MES_ANTERIOR = { from: '2026-08-01', to: '2026-08-14' };

function gasto(date: string, colones: number, ccy = 'CRC', category = 'transfers'): SummaryGroup {
  return { date, ccy, category, direction: 'out', count: 1, amountMinor: Math.round(colones * 100) };
}

function resumen(rango: { from: string; to: string }, groups: SummaryGroup[], firstDate = '2025-01-10'): ApiResponse<TransactionSummary> {
  return { success: true, data: { from: rango.from, to: rango.to, groups, top: [], firstDate } };
}

function servidor(actual: ApiResponse<TransactionSummary>, anterior: ApiResponse<TransactionSummary> = resumen(MES_ANTERIOR, [])) {
  api.getSummary.mockImplementation(async (p) => (p.from === MES.from ? actual : anterior));
}

function tx(id: string, amount: number, iso: string, extra: Partial<Transaction> = {}): Transaction {
  return {
    id,
    title: `Movimiento ${id}`,
    type: amount > 0 ? 'credit' : 'debit',
    amount,
    ccy: 'CRC',
    date: iso.slice(0, 10),
    dateISO: iso,
    status: 'completed',
    category: 'transfers',
    kind: 'sinpe_send',
    ...extra,
  };
}

function setup() {
  return render(
    <LanguageProvider>
      <HomeView />
    </LanguageProvider>,
  );
}

const tarjeta = () => screen.getByText(es.home_spent_month).closest('button')!;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  appState.transactions = [];
  appState.baseCurrency = 'CRC';
  api.getSummary.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('HomeView — gastado este mes', () => {
  it('pide el mes en curso y los mismos dias del mes anterior, en dias de Costa Rica', async () => {
    servidor(resumen(MES, [gasto('2026-09-02', 25000)]));

    setup();

    await screen.findByText('₡25,000.00');
    expect(api.getSummary).toHaveBeenCalledWith(MES);
    expect(api.getSummary).toHaveBeenCalledWith(MES_ANTERIOR);
  });

  // Antes sumaba los ultimos 50 movimientos del telefono: con un mes movido el
  // total se quedaba corto y contaba los pendientes.
  it('muestra el total del servidor, no el de los movimientos guardados', async () => {
    appState.transactions = [tx('local', -1000, '2026-09-05T15:00:00Z'), tx('pend', -9000, '2026-09-05T15:00:00Z', { status: 'pending' })];
    servidor(resumen(MES, [gasto('2026-09-02', 50000), gasto('2026-09-10', 30000, 'CRC', 'services')]));

    setup();

    expect(await screen.findByText('₡80,000.00')).toBeInTheDocument();
    expect(screen.queryByText('₡10,000.00')).not.toBeInTheDocument();
    expect(screen.queryByText(es.analytics_offline)).not.toBeInTheDocument();
  });

  // La tarjeta rotula una sola moneda: sumar dolares 1:1 los imprimia como si
  // fueran colones.
  it('suma solo la moneda base y avisa de las otras', async () => {
    servidor(resumen(MES, [gasto('2026-09-02', 25000), gasto('2026-09-03', 100, 'USD')]));

    setup();

    expect(await screen.findByText('₡25,000.00')).toBeInTheDocument();
    expect(screen.queryByText('₡25,100.00')).not.toBeInTheDocument();
    expect(screen.getByText(/otras monedas: 1/i)).toBeInTheDocument();
  });

  it('no avisa de otras monedas cuando todo el mes esta en colones', async () => {
    servidor(resumen(MES, [gasto('2026-09-02', 25000)]));

    setup();

    expect(await screen.findByText('₡25,000.00')).toBeInTheDocument();
    expect(screen.queryByText(/otras monedas/i)).not.toBeInTheDocument();
  });

  it('mientras llega el resumen no pinta un cero', () => {
    api.getSummary.mockReturnValue(new Promise(() => {}));

    setup();

    expect(tarjeta()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('₡0.00')).not.toBeInTheDocument();
  });

  it('compara contra los mismos dias del mes anterior', async () => {
    servidor(resumen(MES, [gasto('2026-09-02', 25000)]), resumen(MES_ANTERIOR, [gasto('2026-08-05', 20000)]));

    setup();

    await screen.findByText('₡25,000.00');
    expect(tarjeta()).toHaveTextContent(`25% ${es.home_vs_last_month}`);
    expect(tarjeta()).toHaveAttribute('aria-busy', 'false');
  });

  // Quien empezo a usar la app a mitad del mes pasado no tiene con que
  // comparar: el porcentaje saldria enorme y no significaria nada.
  it('no compara si el mes anterior empieza antes del primer movimiento', async () => {
    servidor(
      resumen(MES, [gasto('2026-09-02', 25000)], '2026-08-10'),
      resumen(MES_ANTERIOR, [gasto('2026-08-11', 5000)], '2026-08-10'),
    );

    setup();

    await screen.findByText('₡25,000.00');
    expect(tarjeta()).not.toHaveTextContent(es.home_vs_last_month);
  });

  it('sin respuesta del servidor resume lo guardado, sin pendientes, y lo dice', async () => {
    appState.transactions = [
      tx('c1', -25000, '2026-09-05T15:00:00Z'),
      tx('p1', -5000, '2026-09-06T15:00:00Z', { status: 'pending' }),
      // 11:30 p. m. del 31 de agosto en Costa Rica: es de agosto, aunque en
      // UTC ya sea septiembre.
      tx('ago', -7000, '2026-09-01T05:30:00Z'),
    ];
    api.getSummary.mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } });

    setup();

    expect(await screen.findByText('₡25,000.00')).toBeInTheDocument();
    expect(screen.getByText(es.analytics_offline)).toBeInTheDocument();
    // Sin servidor no hay comparacion: mezclaria dos fuentes.
    expect(tarjeta()).not.toHaveTextContent(es.home_vs_last_month);
  });

  it('sin servidor y sin nada guardado lo dice en vez de inventar un cero', async () => {
    api.getSummary.mockRejectedValue(new Error('caido'));

    setup();

    expect(await screen.findByText(es.home_spent_failed)).toBeInTheDocument();
    expect(screen.queryByText('₡0.00')).not.toBeInTheDocument();
  });

  it('un mes sin gastos si es un cero: el servidor lo confirmo', async () => {
    servidor(resumen(MES, []));

    setup();

    expect(await screen.findByText('₡0.00')).toBeInTheDocument();
    await waitFor(() => expect(tarjeta()).toHaveAttribute('aria-busy', 'false'));
  });
});
