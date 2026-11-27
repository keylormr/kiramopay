import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { TransactionsView } from '../TransactionsView';
import type { Transaction } from '@/types';

// Tocar "SINPE recibido" abre ese movimiento (el aviso trae su id). Si el
// movimiento no aparece en lo que hay ni en la primera pagina del servidor,
// queda la lista: es la actividad, el destino general del aviso.

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

function tx(id: string, titulo: string): Transaction {
  return {
    id,
    title: titulo,
    type: 'credit',
    amount: 100,
    ccy: 'CRC',
    date: '27/11/2026',
    dateISO: '2026-11-27T14:05:00.000Z',
    status: 'completed',
    category: 'Transfer',
    kind: 'sinpe_receive',
  };
}

function pintar(pedido: { id: string; vez: number } | null, atendido = vi.fn()) {
  render(
    <LanguageProvider>
      <TransactionsView onClose={vi.fn()} movimientoPedido={pedido} onMovimientoAtendido={atendido} />
    </LanguageProvider>,
  );
  return atendido;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  appState.transactions = [];
  mockApi.transactions.listTransactions.mockReset();
});

describe('TransactionsView: el movimiento de un aviso tocado', () => {
  it('abre el detalle del movimiento que esta en la primera pagina del servidor', async () => {
    mockApi.transactions.listTransactions.mockResolvedValue({
      success: true,
      data: { transactions: [tx('otro', 'Pago a Ana'), tx('tx-42', 'Diego Mora')], total: 2 },
    });

    const atendido = pintar({ id: 'tx-42', vez: 1 });

    const hoja = await screen.findByRole('dialog', { name: 'Detalles de transacción' });
    expect(hoja).toHaveTextContent('Diego Mora');
    await waitFor(() => expect(atendido).toHaveBeenCalledTimes(1));
  });

  it('lo abre de inmediato si este dispositivo ya lo tiene', async () => {
    appState.transactions = [tx('tx-7', 'Laura Vargas')];
    mockApi.transactions.listTransactions.mockReturnValue(new Promise(() => {}));

    const atendido = pintar({ id: 'tx-7', vez: 1 });

    const hoja = await screen.findByRole('dialog', { name: 'Detalles de transacción' });
    expect(hoja).toHaveTextContent('Laura Vargas');
    await waitFor(() => expect(atendido).toHaveBeenCalledTimes(1));
  });

  it('si no esta, queda la lista y el pedido se suelta', async () => {
    mockApi.transactions.listTransactions.mockResolvedValue({
      success: true,
      data: { transactions: [tx('otro', 'Pago a Ana')], total: 1 },
    });

    const atendido = pintar({ id: 'tx-que-no-esta', vez: 1 });

    expect(await screen.findByText('Pago a Ana')).toBeInTheDocument();
    await waitFor(() => expect(atendido).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Detalles de transacción' })).not.toBeInTheDocument();
  });

  it('sin pedido (abierta desde Inicio) no abre ningun detalle', async () => {
    mockApi.transactions.listTransactions.mockResolvedValue({
      success: true,
      data: { transactions: [tx('tx-42', 'Diego Mora')], total: 1 },
    });

    const atendido = pintar(null);

    expect(await screen.findByText('Diego Mora')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Detalles de transacción' })).not.toBeInTheDocument();
    expect(atendido).not.toHaveBeenCalled();
  });
});
