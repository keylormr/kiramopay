import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { precargarIdioma } from '@/test/idiomas';
import { fechaYHora } from '@/utils/fechaPlazo';
import { TransactionsView } from '../TransactionsView';
import type { Transaction } from '@/types';

// La fecha de un movimiento se pintaba tal como la escribia el adaptador, con
// toLocaleDateString('es-CR'): en ingles, "4/9/2026" se lee 9 de abril. La de
// maquina ya viajaba en dateISO y ninguna pantalla la usaba para mostrarla.

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

const ISO = '2026-09-04T15:30:00Z';

function movimiento(extra: Partial<Transaction> = {}): Transaction {
  return {
    id: 'm1',
    title: 'Pago a Acme',
    type: 'debit',
    amount: -5000,
    ccy: 'CRC',
    date: '4/9/2026',
    dateISO: ISO,
    status: 'completed',
    category: 'Transfer',
    kind: 'sinpe_send',
    ...extra,
  };
}

async function pintar() {
  render(
    <LanguageProvider>
      <TransactionsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
  await waitFor(() => expect(mockApi.transactions.listTransactions).toHaveBeenCalled());
}

beforeAll(() => precargarIdioma('en'));

beforeEach(() => {
  localStorage.clear();
  mockApi.transactions.listTransactions.mockReset();
  mockApi.transactions.listTransactions.mockImplementation(async () => ({
    success: true,
    data: { transactions: appState.transactions, total: appState.transactions.length },
  }));
});

describe('TransactionsView — la fecha en el idioma de la pantalla', () => {
  it('en ingles, la fila y el detalle muestran la fecha en formato ingles y no el d/m de es-CR', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    appState.transactions = [movimiento()];
    const user = userEvent.setup();

    await pintar();

    expect(await screen.findByText(fechaYHora(ISO, 'en'))).toBeInTheDocument();
    expect(screen.queryByText('4/9/2026')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Pago a Acme/ }));
    const detalle = await screen.findByRole('dialog', { name: 'Transaction Details' });
    expect(within(detalle).getByText(fechaYHora(ISO, 'en'))).toBeInTheDocument();
    expect(within(detalle).queryByText('4/9/2026')).not.toBeInTheDocument();
  });

  it('un movimiento sin fecha de maquina (guardado por una version anterior) muestra la que trae', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    appState.transactions = [movimiento({ date: 'Hoy, 9:41 AM', dateISO: undefined })];

    await pintar();

    expect(await screen.findByText('Hoy, 9:41 AM')).toBeInTheDocument();
  });
});
