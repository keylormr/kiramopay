import { render, screen, waitFor, within } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { TransactionsView } from '../TransactionsView';
import type { Transaction } from '@/types';

// La lista conocia dos estados: lo que no estaba completado era "Pendiente".
// Y las tarjetas de arriba sumaban todas las filas, asi que un SINPE que fallo
// contaba como gasto hecho. Lo que no movio dinero (fallido) o se deshizo
// (revertido) va tachado y no entra en los totales; lo pendiente si, como
// hasta ahora, porque todavia puede salir.

const mockApi = vi.hoisted(() => ({
  transactions: { listTransactions: vi.fn() },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const appState = vi.hoisted(() => ({ transactions: [] as Transaction[] }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { transactions: appState.transactions, baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

function tx(id: string, amount: number, status: string): Transaction {
  return {
    id,
    title: `Movimiento ${id}`,
    type: amount > 0 ? 'credit' : 'debit',
    amount,
    ccy: 'CRC',
    date: '01/09/2026',
    dateISO: '2026-09-01T12:00:00.000Z',
    status: status as Transaction['status'],
    category: 'Transfer',
    kind: 'sinpe_send',
  };
}

async function setup() {
  const view = render(
    <LanguageProvider>
      <TransactionsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
  await waitFor(() => expect(mockApi.transactions.listTransactions).toHaveBeenCalled());
  const tarjetas = view.container.querySelector('.grid-cols-3');
  if (!tarjetas) throw new Error('no se encontraron las tarjetas de resumen');
  return { ...view, resumen: within(tarjetas as HTMLElement) };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mockApi.transactions.listTransactions.mockReset();
  mockApi.transactions.listTransactions.mockImplementation(async () => ({
    success: true,
    data: { transactions: appState.transactions, total: appState.transactions.length },
  }));
});

describe('TransactionsView — el estado de cada movimiento', () => {
  it('cada fila dice su estado: un fallido no es "Pendiente"', async () => {
    appState.transactions = [
      tx('c1', 5000, 'completed'),
      tx('f1', -1000, 'failed'),
      tx('r1', -700, 'reversed'),
      tx('p1', -300, 'pending'),
      tx('e1', -200, 'processing'),
    ];

    await setup();

    const fila = (id: string) => screen.getByText(`Movimiento ${id}`).closest('button') as HTMLElement;
    expect(within(fila('c1')).getByText('Completado')).toBeInTheDocument();
    expect(within(fila('f1')).getByText('Fallido')).toBeInTheDocument();
    expect(within(fila('r1')).getByText('Revertido')).toBeInTheDocument();
    expect(within(fila('p1')).getByText('Pendiente')).toBeInTheDocument();
    expect(within(fila('e1')).getByText('En proceso')).toBeInTheDocument();
    expect(screen.getAllByText('Pendiente')).toHaveLength(1);

    // Lo que no movio dinero va tachado; lo que todavia puede salir, no.
    expect(within(fila('f1')).getByText('-₡1,000.00')).toHaveClass('line-through');
    expect(within(fila('r1')).getByText('-₡700.00')).toHaveClass('line-through');
    expect(within(fila('p1')).getByText('-₡300.00')).not.toHaveClass('line-through');
  });

  it('las tarjetas de resumen no cuentan lo fallido ni lo revertido', async () => {
    appState.transactions = [
      tx('c1', 5000, 'completed'),
      tx('c2', -1000, 'completed'),
      tx('f1', -2500, 'failed'),
      tx('r1', 800, 'reversed'),
      tx('p1', -300, 'pending'),
    ];

    const { resumen } = await setup();

    expect(resumen.getByText('+₡5,000.00')).toBeInTheDocument();
    expect(resumen.getByText('-₡1,300.00')).toBeInTheDocument();
    expect(resumen.getByText('+₡3,700.00')).toBeInTheDocument();
    // Sumando todo: ingresos 5800, gastos 3800 y neto 2000.
    expect(resumen.queryByText('+₡5,800.00')).toBeNull();
    expect(resumen.queryByText('-₡3,800.00')).toBeNull();
    expect(resumen.queryByText('+₡2,000.00')).toBeNull();
  });
});
