import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { TransactionsView } from '../TransactionsView';
import type { Transaction } from '@/types';

// Cuando la lista no se puede traer del servidor, la pantalla se cae a lo que
// hay guardado en el dispositivo y lo dice. El aviso decia SIEMPRE "Sin
// conexion con el servidor", tambien cuando el servidor habia respondido 429:
// hay demasiado trafico y lo que hay que hacer es esperar un momento, no
// revisar la conexion, que esta perfecta.

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

function tx(id: string, amount: number, titulo: string): Transaction {
  return {
    id,
    title: titulo,
    type: amount > 0 ? 'credit' : 'debit',
    amount,
    ccy: 'CRC',
    description: titulo,
    date: '01/09/2026',
    dateISO: '2026-09-01T12:00:00.000Z',
    status: 'completed',
    category: 'Transfer',
    kind: 'sinpe_send',
  };
}

function abrir() {
  return render(
    <LanguageProvider>
      <TransactionsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  appState.transactions = [tx('local-1', -1000, 'Supermercado')];
  appState.baseCurrency = 'CRC';
  mockApi.transactions.listTransactions.mockReset();
});

describe('TransactionsView — el aviso del respaldo local dice QUE paso', () => {
  it('con 429 avisa que hay demasiado trafico, no que no hay red', async () => {
    mockApi.transactions.listTransactions.mockResolvedValue({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes.' },
    });

    abrir();

    expect(await screen.findByText(/demasiado tráfico/i)).toBeInTheDocument();
    expect(screen.queryByText(/sin conexión con el servidor/i)).not.toBeInTheDocument();
  });

  it('sin red sigue diciendo que no hay conexion', async () => {
    mockApi.transactions.listTransactions.mockResolvedValue({
      success: false,
      error: { code: 'NETWORK_ERROR', message: 'sin red' },
    });

    abrir();

    expect(await screen.findByText(/sin conexión con el servidor/i)).toBeInTheDocument();
    expect(screen.queryByText(/demasiado tráfico/i)).not.toBeInTheDocument();
  });

  it('con 429 la busqueda local sigue siendo el respaldo', async () => {
    appState.transactions = [tx('local-1', -1000, 'Supermercado'), tx('local-2', -2500, 'Panaderia La Espiga')];
    mockApi.transactions.listTransactions.mockResolvedValue({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Demasiadas solicitudes.' },
    });

    abrir();
    await screen.findByText(/demasiado tráfico/i);
    expect(screen.getByText('Supermercado')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: 'panaderia' } });

    await waitFor(() => expect(screen.queryByText('Supermercado')).not.toBeInTheDocument());
    expect(screen.getByText('Panaderia La Espiga')).toBeInTheDocument();
  });
});
