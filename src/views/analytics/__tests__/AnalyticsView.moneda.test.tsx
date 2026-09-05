import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AnalyticsView } from '../AnalyticsView';
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
  const dateISO = new Date().toISOString();
  return {
    id,
    title: `Movimiento ${id}`,
    type: amount > 0 ? 'credit' : 'debit',
    amount,
    ccy,
    description: '',
    date: new Date(dateISO).toLocaleDateString('es-CR'),
    dateISO,
    status: 'completed',
    category: 'transfers',
    kind: 'sinpe_send',
  };
}

function setup() {
  return render(
    <LanguageProvider>
      <AnalyticsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

// Cada monto que el usuario realmente ve: los nodos hoja con simbolo de moneda.
function montosVisibles(): string[] {
  return Array.from(document.querySelectorAll('*'))
    .filter((el) => el.children.length === 0)
    .map((el) => el.textContent ?? '')
    .filter((s) => s.includes('₡') || s.includes('$'));
}

const contiene = (fragmento: string) => montosVisibles().some((s) => s.includes(fragmento));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  appState.transactions = [];
  appState.baseCurrency = 'CRC';
});

describe('AnalyticsView — una sola moneda por total', () => {
  // El defecto: se sumaba tx.amount en crudo y se rotulaba con la moneda base,
  // asi que un gasto en dolares entraba 1:1 en un total de colones.
  it('no mete los dolares en el total rotulado en colones', async () => {
    mockApi.transactions.listTransactions.mockResolvedValue({
      success: true,
      data: {
        transactions: [tx('c1', -1196850, 'CRC'), tx('u1', -100, 'USD')],
        total: 2,
      },
    });

    setup();

    await waitFor(() => {
      expect(contiene('₡1,196,850.00')).toBe(true);
    });
    // Con el codigo anterior el gasto era 1196950: colones + dolares sumados.
    expect(contiene('₡1,196,950.00')).toBe(false);
    // Y ningun monto en dolares se cuela en una pantalla rotulada en colones.
    expect(contiene('$')).toBe(false);
  });

  // El mismo movimiento visto al reves: la moneda base se cambia con un toque
  // en el home, y con ella la etiqueta de TODOS los totales.
  it('con moneda base en dolares suma solo los dolares', async () => {
    appState.baseCurrency = 'USD';
    mockApi.transactions.listTransactions.mockResolvedValue({
      success: true,
      data: {
        transactions: [tx('c1', -1000, 'CRC'), tx('u1', -25, 'USD')],
        total: 2,
      },
    });

    setup();

    await waitFor(() => {
      expect(contiene('$25.00')).toBe(true);
    });
    // Con el codigo anterior: 1000 colones + 25 dolares = "$1,025.00".
    expect(contiene('$1,025.00')).toBe(false);
    expect(contiene('₡')).toBe(false);
  });

  // Lo que queda fuera se dice, no se esconde.
  it('avisa cuantos movimientos quedaron fuera por estar en otra moneda', async () => {
    mockApi.transactions.listTransactions.mockResolvedValue({
      success: true,
      data: {
        transactions: [tx('c1', -1000, 'CRC'), tx('u1', -25, 'USD'), tx('u2', -30, 'USD')],
        total: 3,
      },
    });

    setup();

    await waitFor(() => {
      expect(screen.getByText(/otras monedas: 2/i)).toBeInTheDocument();
    });
  });

  // Sin ningun movimiento en la moneda base, mostrar ceros seria mentir por
  // omision: se rotula la moneda que si tiene datos.
  it('si la ventana no tiene nada en la moneda base rotula la moneda con datos', async () => {
    appState.baseCurrency = 'USD';
    mockApi.transactions.listTransactions.mockResolvedValue({
      success: true,
      data: { transactions: [tx('c1', -1000, 'CRC'), tx('c2', -2000, 'CRC')], total: 2 },
    });

    setup();

    await waitFor(() => {
      expect(contiene('₡3,000.00')).toBe(true);
    });
    expect(contiene('$')).toBe(false);
  });
});
