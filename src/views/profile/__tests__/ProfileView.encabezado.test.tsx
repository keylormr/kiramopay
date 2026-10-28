import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { Transaction } from '@/types';
import type { SummaryGroup, TransactionSummary, TransactionSummaryParams } from '@/api/repositories/transaction.repository';
import type { ApiResponse } from '@/api/types';
import { ProfileView } from '../ProfileView';

// El encabezado del Perfil contradecia a Inicio y a Analisis:
// - "Balance total" sumaba en dolares con otro formato y contaba una tasa
//   faltante como 1 (colones como dolares).
// - "Este mes: 21 gastos" contaba TODOS los debitos cargados, sin filtro de
//   fecha, mientras Inicio y Analisis decian que no habia gasto en el mes.
// - El telefono salia crudo ("+50688880001") y SINPE lo muestra "+506 8888-0001".

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

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => ({
    kyc: { getStatus: vi.fn().mockResolvedValue({ success: false }), verifyIdentity: vi.fn() },
    loyalty: { getReferralSummary: vi.fn().mockResolvedValue({ success: false }) },
    mfa: { totpStatus: vi.fn().mockResolvedValue({ success: false }) },
    transactions: { getSummary: api.getSummary },
  }),
}));

const appState = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
  transactions: [] as Transaction[],
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: appState.accounts,
      baseCurrency: 'CRC',
      user: { id: 'u1', firstName: 'Ana', lastName: 'Mora', kycLevel: 0, email: 'a@b.co', phone: '+50688880001' },
      settings: { biometricEnabled: false, notifications: true, language: 'es' },
      transactions: appState.transactions,
      theme: 'light',
    },
    dispatch: vi.fn(),
  }),
}));

// 13 de septiembre de 2026, mediodia en Costa Rica.
const AHORA = new Date('2026-09-13T18:00:00Z');
const MES = { from: '2026-09-01', to: '2026-10-01' };
const MES_ANTERIOR = { from: '2026-08-01', to: '2026-08-14' };

function gasto(date: string, colones: number): SummaryGroup {
  return { date, ccy: 'CRC', category: 'transfers', direction: 'out', count: 1, amountMinor: Math.round(colones * 100) };
}

function resumen(rango: { from: string; to: string }, groups: SummaryGroup[]): ApiResponse<TransactionSummary> {
  return { success: true, data: { from: rango.from, to: rango.to, groups, top: [], firstDate: '2025-01-10' } };
}

function servidor(actual: ApiResponse<TransactionSummary>) {
  api.getSummary.mockImplementation(async (p) => (p.from === MES.from ? actual : resumen(MES_ANTERIOR, [])));
}

function debito(id: string, monto: number, iso: string): Transaction {
  return {
    id,
    title: `Movimiento ${id}`,
    type: 'debit',
    amount: -monto,
    ccy: 'CRC',
    date: iso.slice(0, 10),
    dateISO: iso,
    status: 'completed',
    category: 'transfers',
    kind: 'sinpe_send',
  };
}

const colones = (balance: number, rateToUsd?: number) => ({
  ccy: 'CRC', symbol: '₡', balance, type: 'fiat', rateToUsd,
});
const dolares = (balance: number) => ({ ccy: 'USD', symbol: '$', balance, type: 'fiat', rateToUsd: 1 });

const pintar = () =>
  render(
    <LanguageProvider>
      <ProfileView />
    </LanguageProvider>,
  );

// Cada estadistica del encabezado: el contenedor del rotulo.
const estadistica = (rotulo: string) => within(screen.getByText(rotulo).parentElement as HTMLElement);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  appState.accounts = [colones(500_000, 0.002), dolares(445)];
  appState.transactions = [];
  api.getSummary.mockReset();
  servidor(resumen(MES, []));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ProfileView encabezado: balance total', () => {
  it('muestra el mismo total que Inicio: todas las cuentas en la moneda base', () => {
    pintar();

    expect(estadistica('Balance Total').getByText('₡722,500.00')).toBeInTheDocument();
    // Ya no es el total en dolares con otro formato.
    expect(estadistica('Balance Total').queryByText(/~\$/)).not.toBeInTheDocument();
  });

  it('una cuenta con saldo y sin tasa no se cuenta 1 a 1: muestra el guion', () => {
    appState.accounts = [colones(500_000, undefined), dolares(445)];
    pintar();

    const total = estadistica('Balance Total');
    expect(total.getByText('—')).toBeInTheDocument();
    expect(total.queryByText(/500,000|445|~\$/)).not.toBeInTheDocument();
  });
});

describe('ProfileView encabezado: gastado este mes', () => {
  // Antes: 21 debitos cargados = "21 gastos", aunque el mes no tuviera ninguno.
  it('no cuenta los debitos cargados: muestra el gasto del mes que dice el servidor', async () => {
    appState.transactions = Array.from({ length: 21 }, (_, i) => debito(`d${i}`, 1000, '2026-07-05T15:00:00Z'));
    servidor(resumen(MES, []));
    pintar();

    // El conteo de debitos de cualquier fecha ya no se presenta como gasto del mes.
    expect(screen.queryByText('21 gastos')).not.toBeInTheDocument();
    // Un mes sin gastos confirmado por el servidor si es un cero.
    expect(await estadistica('Gastado este mes').findByText('₡0.00')).toBeInTheDocument();
    expect(screen.queryByText('21 gastos')).not.toBeInTheDocument();
  });

  it('muestra la misma cifra que la tarjeta de Inicio', async () => {
    servidor(resumen(MES, [gasto('2026-09-02', 25_000), gasto('2026-09-10', 5_000)]));
    pintar();

    expect(await estadistica('Gastado este mes').findByText('₡30,000.00')).toBeInTheDocument();
    expect(api.getSummary).toHaveBeenCalledWith(MES);
  });

  it('mientras llega el resumen no pinta un cero', () => {
    api.getSummary.mockReturnValue(new Promise(() => {}));
    pintar();

    const rotulo = screen.getByText('Gastado este mes');
    expect(rotulo.parentElement).toHaveAttribute('aria-busy', 'true');
    expect(estadistica('Gastado este mes').queryByText('₡0.00')).not.toBeInTheDocument();
  });

  it('sin servidor y sin nada guardado dice que no hay dato, no un cero', async () => {
    api.getSummary.mockRejectedValue(new Error('caido'));
    pintar();

    expect(await estadistica('Gastado este mes').findByText('—')).toBeInTheDocument();
    expect(estadistica('Gastado este mes').queryByText('₡0.00')).not.toBeInTheDocument();
  });

  it('sin servidor resume lo guardado del mes y lo avisa', async () => {
    appState.transactions = [
      debito('c1', 25_000, '2026-09-05T15:00:00Z'),
      // De julio: no cuenta para el mes en curso.
      debito('jul', 9_000, '2026-07-05T15:00:00Z'),
    ];
    api.getSummary.mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } });
    pintar();

    const gastado = estadistica('Gastado este mes');
    expect(await gastado.findByText('₡25,000.00')).toBeInTheDocument();
    expect(gastado.getByText(/No se pudo cargar el periodo completo/)).toBeInTheDocument();
  });
});

describe('ProfileView encabezado: telefono', () => {
  it('lo muestra con el mismo formato que SINPE', async () => {
    pintar();

    expect(screen.getByText('+506 8888-0001')).toBeInTheDocument();
    expect(screen.queryByText('+50688880001')).not.toBeInTheDocument();
    await waitFor(() => expect(api.getSummary).toHaveBeenCalled());
  });

  it('la hoja de datos personales tambien', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByText('Datos personales'));
    const hoja = within(await screen.findByRole('dialog'));

    expect(hoja.getByText('+506 8888-0001')).toBeInTheDocument();
    expect(hoja.queryByText('+50688880001')).not.toBeInTheDocument();
  });
});

// A 390 px cada estadistica del encabezado mide ~123 px: "₡1,437,677.00" (146 px)
// se salia de su caja y pisaba al cuadro vecino. Las dos cajas se apilan hasta
// que haya ancho para ponerlas lado a lado.
describe('ProfileView encabezado: las estadisticas a 390 px', () => {
  it('se apilan en una columna y pasan a dos solo con ancho de sobra', () => {
    pintar();

    const caja = screen.getByText(/^(Balance|Saldo) total$/i).parentElement as HTMLElement;
    const grilla = caja.parentElement as HTMLElement;
    expect(grilla.className).toMatch(/(^|\s)grid-cols-1(\s|$)/);
    expect(grilla.className).not.toMatch(/(^|\s)grid-cols-2(\s|$)/);
    expect(grilla.className).toMatch(/min-\[\d+px\]:grid-cols-2|sm:grid-cols-2/);
  });
});
