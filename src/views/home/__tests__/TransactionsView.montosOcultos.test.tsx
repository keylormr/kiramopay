import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { useSettingsStore } from '@/stores/settings.store';
import { TransactionsView } from '../TransactionsView';
import type { Transaction } from '@/types';

const mockApi = vi.hoisted(() => ({
  transactions: { listTransactions: vi.fn() },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const lista: Transaction[] = [
  {
    id: 'a1',
    title: 'Pago de prueba',
    type: 'credit',
    amount: 5000,
    ccy: 'CRC',
    date: '01/09/2026',
    dateISO: '2026-09-01T12:00:00.000Z',
    status: 'completed',
    category: 'Transfer',
    kind: 'sinpe_send',
  },
];

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { transactions: lista, baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

async function abrir() {
  render(
    <LanguageProvider>
      <TransactionsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
  await waitFor(() => expect(mockApi.transactions.listTransactions).toHaveBeenCalled());
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mockApi.transactions.listTransactions.mockReset();
  mockApi.transactions.listTransactions.mockResolvedValue({
    success: true,
    data: { transactions: lista, total: lista.length },
  });
});

afterEach(() => {
  cleanup();
  act(() => useSettingsStore.setState({ saldoOculto: false }));
});

describe('TransactionsView - montos ocultos', () => {
  it('muestra los montos del resumen y de la fila cuando no estan ocultos', async () => {
    useSettingsStore.setState({ saldoOculto: false });
    await abrir();

    // Resumen (ingresos y neto) y la fila.
    expect(screen.getAllByText('+₡5,000.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Monto oculto')).not.toBeInTheDocument();
  });

  it('tapa los montos del resumen y de la fila cuando la persona los oculta', async () => {
    useSettingsStore.setState({ saldoOculto: true });
    await abrir();

    expect(screen.queryByText('+₡5,000.00')).not.toBeInTheDocument();
    expect(screen.queryByText(/5,000/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Monto oculto').length).toBeGreaterThanOrEqual(3);
  });

  it('el ojo de la cabecera cambia la preferencia', async () => {
    useSettingsStore.setState({ saldoOculto: false });
    await abrir();
    const user = userEvent.setup();

    const ojo = screen.getAllByRole('button').find((b) => b.hasAttribute('aria-pressed'));
    expect(ojo).toBeDefined();
    await user.click(ojo as HTMLElement);

    expect(useSettingsStore.getState().saldoOculto).toBe(true);
    expect(screen.queryByText(/5,000/)).not.toBeInTheDocument();
  });
});
