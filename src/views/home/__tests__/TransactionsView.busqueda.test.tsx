import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { TransactionsView } from '../TransactionsView';
import type { Transaction } from '@/types';

// El buscador filtraba `state.transactions`, que son las ultimas 50 filas que
// sincronizo la aplicacion: un movimiento del mes pasado no aparecia por mas
// que se escribiera su nombre exacto. Y las tarjetas de arriba sumaban esas
// mismas 50 filas presentando el resultado como el total del periodo.

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

const buscador = () => screen.getByPlaceholderText(/buscar/i);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  appState.transactions = [];
  appState.baseCurrency = 'CRC';
  mockApi.transactions.listTransactions.mockReset();
});

describe('TransactionsView — la busqueda la hace el servidor', () => {
  it('manda el texto al servidor y muestra lo que el servidor encontro', async () => {
    // El movimiento viejo NO esta en el estado local: es exactamente el caso
    // que antes no se podia encontrar.
    appState.transactions = [tx('reciente', -1000, 'Supermercado')];
    mockApi.transactions.listTransactions.mockImplementation(async (params: { search?: string }) => {
      if (params.search === 'panaderia') {
        return { success: true, data: { transactions: [tx('viejo', -2500, 'Panaderia La Espiga')], total: 1 } };
      }
      return { success: true, data: { transactions: appState.transactions, total: 1 } };
    });

    abrir();
    await waitFor(() => expect(screen.getByText('Supermercado')).toBeInTheDocument());

    fireEvent.change(buscador(), { target: { value: 'panaderia' } });

    await waitFor(() =>
      expect(mockApi.transactions.listTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'panaderia', offset: 0 }),
      ),
    );
    expect(await screen.findByText('Panaderia La Espiga')).toBeInTheDocument();
    expect(screen.queryByText('Supermercado')).not.toBeInTheDocument();
  });

  it('sin texto no manda filtro de busqueda', async () => {
    mockApi.transactions.listTransactions.mockResolvedValue({
      success: true,
      data: { transactions: [], total: 0 },
    });

    abrir();

    await waitFor(() =>
      expect(mockApi.transactions.listTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ search: undefined }),
      ),
    );
  });

  it('no encontrar nada es una respuesta: no cae al respaldo local', async () => {
    appState.transactions = [tx('reciente', -1000, 'Supermercado')];
    mockApi.transactions.listTransactions.mockImplementation(async (params: { search?: string }) => {
      if (params.search) return { success: true, data: { transactions: [], total: 0 } };
      return { success: true, data: { transactions: appState.transactions, total: 1 } };
    });

    abrir();
    await waitFor(() => expect(screen.getByText('Supermercado')).toBeInTheDocument());

    fireEvent.change(buscador(), { target: { value: 'bicicleta' } });

    // Con el codigo anterior la fila local sobrevivia a cualquier busqueda que
    // no la excluyera; aca el servidor dijo "nada" y eso es lo que se muestra.
    await waitFor(() => expect(screen.queryByText('Supermercado')).not.toBeInTheDocument());
  });
});

describe('TransactionsView — los totales dicen que cubren', () => {
  it('avisa cuando los totales cubren solo parte del historial y deja traer mas', async () => {
    mockApi.transactions.listTransactions.mockImplementation(async (params: { offset?: number }) => {
      if ((params.offset ?? 0) === 0) {
        return { success: true, data: { transactions: [tx('a', 5000, 'Sueldo')], total: 2 } };
      }
      return { success: true, data: { transactions: [tx('b', -1500, 'Recibo')], total: 2 } };
    });

    abrir();

    // 1 de 2: el subtotal NO se presenta como el total.
    expect(await screen.findByText(/cubren 1 de tus 2 movimientos/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /cargar más/i }));

    await waitFor(() => expect(screen.getByText('Recibo')).toBeInTheDocument());
    // Ya se trajo todo: el aviso desaparece y el boton tambien.
    expect(screen.queryByText(/cubren 1 de tus 2 movimientos/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cargar más/i })).not.toBeInTheDocument();
  });

  it('sin servidor lo dice en vez de pasar lo local por completo', async () => {
    appState.transactions = [tx('local', -1000, 'Supermercado')];
    mockApi.transactions.listTransactions.mockRejectedValue(new Error('offline'));

    abrir();

    expect(await screen.findByText(/sin conexión con el servidor/i)).toBeInTheDocument();
    // Y lo guardado en el dispositivo sigue a la vista.
    expect(screen.getByText('Supermercado')).toBeInTheDocument();
  });
});
