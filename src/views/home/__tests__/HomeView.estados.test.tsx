import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HomeView } from '../HomeView';
import type { Transaction } from '@/types';

// Los movimientos recientes del Inicio no decian el estado: un SINPE que fallo
// se veia igual que uno que salio, con el monto restado. Se marca lo que no
// esta completado; lo completado queda como siempre, sin rotulo.

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    transactions: { getSummary: vi.fn().mockResolvedValue({ success: false, error: { code: 'X', message: '' } }) },
  }),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <svg data-testid="qr-code" />,
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn().mockResolvedValue(undefined),
  refreshTransactions: vi.fn().mockResolvedValue(undefined),
}));

const appState = vi.hoisted(() => ({ transactions: [] as Transaction[] }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      transactions: appState.transactions,
      baseCurrency: 'CRC',
      accounts: [{ ccy: 'CRC', balance: 500000, symbol: '₡', flag: '', iban: '', name: 'Colones', type: 'fiat' }],
    },
    dispatch: vi.fn(),
  }),
}));

function tx(id: string, title: string, amount: number, status: string): Transaction {
  return {
    id, title, type: amount > 0 ? 'credit' : 'debit', amount, ccy: 'CRC',
    date: '4/9/2026', dateISO: '2026-09-04T15:30:00Z',
    status: status as Transaction['status'], category: 'Transfer', kind: 'sinpe_send',
  };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('HomeView — el estado de los movimientos recientes', () => {
  it('un fallido y uno pendiente dicen su estado; el completado va sin rotulo', async () => {
    appState.transactions = [
      tx('m1', 'Pago a Acme', -5000, 'failed'),
      tx('m2', 'Ana Mora', -3000, 'pending'),
      tx('m3', 'Soda Tica', -1200, 'completed'),
    ];

    render(
      <LanguageProvider>
        <HomeView />
      </LanguageProvider>,
    );

    const fila = (titulo: string) => screen.getByText(titulo).closest('[data-movimiento]') as HTMLElement;
    expect(await screen.findByText('Fallido')).toBeInTheDocument();
    expect(fila('Pago a Acme')).toHaveTextContent('Fallido');
    expect(fila('Ana Mora')).toHaveTextContent('Pendiente');
    expect(fila('Soda Tica')).not.toHaveTextContent('Completado');
    // El monto de lo que no movio dinero va tachado.
    expect(screen.getByText('-₡5,000.00')).toHaveClass('line-through');
    expect(screen.getByText('-₡1,200.00')).not.toHaveClass('line-through');
  });
});
