import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AnalyticsView } from '../AnalyticsView';
import type { Transaction } from '@/types';

const mockApi = vi.hoisted(() => ({
  transactions: { listTransactions: vi.fn() },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

// The store fallback: dataSync only ever holds the last 50 movements, which is
// exactly what this view exists to stop relying on.
const storeTransactions = vi.hoisted(() => ({ value: [] as Transaction[] }));
vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { transactions: storeTransactions.value, baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

function tx(id: string, amount: number, dateISO: string): Transaction {
  return {
    id,
    title: `Movimiento ${id}`,
    type: amount > 0 ? 'credit' : 'debit',
    amount,
    ccy: 'CRC',
    description: '',
    date: new Date(dateISO).toLocaleDateString('es-CR'),
    dateISO,
    status: 'completed',
    category: 'transfers',
    kind: 'sinpe_send',
  } as Transaction;
}

function setup() {
  return render(
    <LanguageProvider>
      <AnalyticsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

// Recent enough to fall inside the default "month" window.
const now = new Date().toISOString();

// Los montos se comparan por sus dígitos: el separador de miles de es-CR es un
// espacio fino (U+202F), que hace frágil cualquier comparación textual.
const digits = (text: string) => text.replace(/\D/g, '');

// Dígitos de cada nodo hoja que contiene el símbolo de colón, es decir, cada
// monto que el usuario realmente ve.
function montosRenderizados(): string[] {
  return Array.from(document.querySelectorAll('*'))
    .filter((el) => el.children.length === 0 && (el.textContent ?? '').includes('₡'))
    .map((el) => digits(el.textContent ?? ''));
}

beforeEach(() => {
  vi.clearAllMocks();
  storeTransactions.value = [];
});

describe('AnalyticsView — cobertura de la ventana', () => {
  // OFFSET paging is not stable against concurrent writes: a transaction
  // landing between two page requests shifts every later offset by one, so a
  // row already collected comes back and would be counted twice in the totals.
  it('no cuenta dos veces una fila que se repite entre páginas', async () => {
    const page0 = Array.from({ length: 100 }, (_, i) => tx(`t${i}`, -1000, now));
    // La página 1 repite t99 (desplazada por un INSERT concurrente) y agrega t100.
    const page1 = [tx('t99', -1000, now), tx('t100', -1000, now)];

    mockApi.transactions.listTransactions
      .mockResolvedValueOnce({ success: true, data: { transactions: page0, total: 101 } })
      .mockResolvedValueOnce({ success: true, data: { transactions: page1, total: 101 } });

    setup();

    await waitFor(() => {
      expect(mockApi.transactions.listTransactions).toHaveBeenCalledTimes(2);
    });

    // 101 filas distintas, no 102: el gasto total debe ser 101 x 1000 = 101000.
    // El separador de miles de es-CR es un espacio fino, así que se compara
    // sobre los dígitos y no sobre el texto formateado.
    await waitFor(() => {
      expect(montosRenderizados()).toContain('10100000'); // 101000,00
    });
    // Y la prueba solo vale si distingue: 102 filas darían 102000.
    expect(montosRenderizados()).not.toContain('10200000');
  });

  // A failed page used to discard the whole window silently, dropping back to
  // the 50-item store while presenting it as the complete period.
  it('conserva las páginas que sí llegaron y avisa que la ventana es parcial', async () => {
    const page0 = Array.from({ length: 100 }, (_, i) => tx(`p${i}`, -100, now));
    mockApi.transactions.listTransactions
      .mockResolvedValueOnce({ success: true, data: { transactions: page0, total: 250 } })
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK', message: 'boom' } });

    setup();

    await waitFor(() => {
      expect(screen.getByText(/100.*250/)).toBeInTheDocument();
    });
  });

  // Nothing arrived at all: the charts run on the synced store, and the user
  // must be told rather than shown partial data as if it were the period.
  it('avisa cuando cae al store porque la API no respondió', async () => {
    storeTransactions.value = [tx('s1', -500, now)];
    mockApi.transactions.listTransactions.mockRejectedValue(new Error('offline'));

    setup();

    await waitFor(() => {
      expect(screen.getByText(/only recent transactions/i)).toBeInTheDocument();
    });
  });
});
