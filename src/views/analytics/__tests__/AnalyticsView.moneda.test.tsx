import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AnalyticsView } from '../AnalyticsView';
import { hoyCR } from '@/utils/periodos';
import type { SummaryGroup } from '@/api/repositories/transaction.repository';
import type { Transaction } from '@/types';

const mockApi = vi.hoisted(() => ({
  transactions: { getSummary: vi.fn() },
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

const gasto = (amount: number, ccy: string): SummaryGroup => ({
  date: hoyCR(),
  ccy,
  category: 'transfers',
  direction: 'out',
  count: 1,
  amountMinor: Math.round(amount * 100),
});

function tx(id: string, amount: number, ccy: string): Transaction {
  const dateISO = new Date().toISOString();
  return {
    id,
    title: `Movimiento ${id}`,
    type: amount > 0 ? 'credit' : 'debit',
    amount,
    ccy,
    description: '',
    date: dateISO,
    dateISO,
    status: 'completed',
    category: 'transfers',
    kind: 'sinpe_send',
  };
}

function responde(groups: SummaryGroup[], top: Transaction[] = []) {
  mockApi.transactions.getSummary.mockResolvedValue({ success: true, data: { from: '', to: '', groups, top, firstDate: null } });
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
    responde([gasto(1196850, 'CRC'), gasto(100, 'USD')], [tx('c1', -1196850, 'CRC'), tx('u1', -100, 'USD')]);

    setup();

    await waitFor(() => {
      expect(contiene('₡1,196,850.00')).toBe(true);
    });
    expect(contiene('₡1,196,950.00')).toBe(false);
    expect(contiene('$')).toBe(false);
  });

  // La moneda base se cambia con un toque en el home, y con ella la etiqueta de
  // TODOS los totales.
  it('con moneda base en dolares suma solo los dolares', async () => {
    appState.baseCurrency = 'USD';
    responde([gasto(1000, 'CRC'), gasto(25, 'USD')]);

    setup();

    await waitFor(() => {
      expect(contiene('$25.00')).toBe(true);
    });
    expect(contiene('$1,025.00')).toBe(false);
    expect(contiene('₡')).toBe(false);
  });

  // Lo que queda fuera se dice, no se esconde.
  it('avisa cuantos movimientos quedaron fuera por estar en otra moneda', async () => {
    responde([gasto(1000, 'CRC'), gasto(25, 'USD'), gasto(30, 'USD')]);

    setup();

    await waitFor(() => {
      expect(screen.getByText(/otras monedas: 2/i)).toBeInTheDocument();
    });
  });

  // Sin ningun movimiento en la moneda base, mostrar ceros seria mentir por
  // omision: se rotula la moneda que si tiene datos.
  it('si el periodo no tiene nada en la moneda base rotula la moneda con datos', async () => {
    appState.baseCurrency = 'USD';
    responde([gasto(1000, 'CRC'), gasto(2000, 'CRC')]);

    setup();

    await waitFor(() => {
      expect(contiene('₡3,000.00')).toBe(true);
    });
    expect(contiene('$')).toBe(false);
  });
});
