import { render, screen, waitFor, within } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { TransactionsView } from '../TransactionsView';
import type { Transaction } from '@/types';

const mockApi = vi.hoisted(() => ({
  transactions: { listTransactions: vi.fn() },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const appState = vi.hoisted(() => ({
  transactions: [] as Transaction[],
  baseCurrency: 'CRC',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { transactions: appState.transactions, baseCurrency: appState.baseCurrency },
    dispatch: vi.fn(),
  }),
}));

function tx(id: string, amount: number, ccy: string): Transaction {
  return {
    id,
    title: `Movimiento ${id}`,
    type: amount > 0 ? 'credit' : 'debit',
    amount,
    ccy,
    date: '01/09/2026',
    dateISO: '2026-09-01T12:00:00.000Z',
    status: 'completed',
    category: 'Transfer',
    kind: 'sinpe_send',
  };
}

// Las tarjetas de resumen, separadas de las filas: ambas imprimen montos y hay
// que poder afirmar sobre las de arriba sin que las filas las tapen.
async function setup() {
  const view = render(
    <LanguageProvider>
      <TransactionsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
  // La pantalla le pregunta al servidor al abrirse; se espera esa respuesta
  // antes de afirmar sobre los totales.
  await waitFor(() => expect(mockApi.transactions.listTransactions).toHaveBeenCalled());
  const tarjetas = view.container.querySelector('.grid-cols-3');
  if (!tarjetas) throw new Error('no se encontraron las tarjetas de resumen');
  return { ...view, resumen: within(tarjetas as HTMLElement) };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  appState.transactions = [];
  appState.baseCurrency = 'CRC';
  mockApi.transactions.listTransactions.mockReset();
  // Por omision el servidor devuelve lo mismo que tiene el estado, que es el
  // caso normal: la pantalla se llena con lo que dice el servidor.
  mockApi.transactions.listTransactions.mockImplementation(async () => ({
    success: true,
    data: { transactions: appState.transactions, total: appState.transactions.length },
  }));
});

describe('TransactionsView — tarjetas de resumen', () => {
  // Cada FILA ya se formatea con su propia tx.ccy; las tarjetas de arriba
  // sumaban todo y lo rotulaban con la moneda base.
  it('suma solo la moneda que rotula y deja los dolares fuera', async () => {
    appState.transactions = [
      tx('c1', 5000, 'CRC'),
      tx('c2', -1000, 'CRC'),
      tx('u1', -20, 'USD'),
    ];

    const { resumen } = await setup();

    expect(resumen.getByText('+₡5,000.00')).toBeInTheDocument();
    expect(resumen.getByText('-₡1,000.00')).toBeInTheDocument();
    expect(resumen.getByText('+₡4,000.00')).toBeInTheDocument();
    // Con el codigo anterior: gasto 1000 + 20 = "-₡1,020.00" y neto "+₡3,980.00".
    expect(resumen.queryByText('-₡1,020.00')).not.toBeInTheDocument();
    expect(resumen.queryByText('+₡3,980.00')).not.toBeInTheDocument();
    // La fila del movimiento en dolares sigue ahi, con su propia moneda.
    expect(screen.getByText('-$20.00')).toBeInTheDocument();
    // Y la pantalla dice lo que quedo fuera del resumen.
    expect(screen.getByText(/otras monedas: 1/i)).toBeInTheDocument();
  });

  it('no muestra el aviso cuando todo esta en la misma moneda', async () => {
    appState.transactions = [tx('c1', 5000, 'CRC'), tx('c2', -1000, 'CRC')];

    await setup();

    expect(screen.queryByText(/otras monedas/i)).not.toBeInTheDocument();
  });
});
