import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HomeView } from '../HomeView';
import type { Transaction } from '@/types';

// jsdom no trae ResizeObserver y el grafico del gasto del mes lo usa para
// medirse; sin esto la tarjeta ni siquiera monta.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('@/api', () => ({
  getApiLayer: () => ({}),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <svg data-testid="qr-code" />,
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(),
  refreshTransactions: vi.fn(),
}));

const appState = vi.hoisted(() => ({
  transactions: [] as Transaction[],
  baseCurrency: 'CRC',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      transactions: appState.transactions,
      baseCurrency: appState.baseCurrency,
      accounts: [
        { ccy: 'CRC', balance: 500000, symbol: '₡', flag: '🇨🇷', iban: '', name: 'Colones', type: 'fiat' },
        { ccy: 'USD', balance: 100, symbol: '$', flag: '🇺🇸', iban: '', name: 'Dolares', type: 'fiat', rateToUsd: 1 },
      ],
    },
    dispatch: vi.fn(),
  }),
}));

// Del mes en curso: la tarjeta solo mira desde el dia 1.
function txDelMes(id: string, amount: number, ccy: string): Transaction {
  const ahora = new Date();
  const fecha = new Date(ahora.getFullYear(), ahora.getMonth(), 1, 12, 0, 0);
  return {
    id,
    title: `Movimiento ${id}`,
    type: amount > 0 ? 'credit' : 'debit',
    amount,
    ccy,
    date: fecha.toLocaleDateString('es-CR'),
    dateISO: fecha.toISOString(),
    status: 'completed',
    category: 'Transfer',
    kind: 'sinpe_send',
  };
}

function setup() {
  return render(
    <LanguageProvider>
      <HomeView />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  appState.transactions = [];
  appState.baseCurrency = 'CRC';
});

describe('HomeView — gastado este mes', () => {
  // La tarjeta rotula colones a mano: sumar dolares 1:1 los imprimia como si
  // fueran colones.
  it('suma solo los gastos en colones', () => {
    appState.transactions = [txDelMes('c1', -25000, 'CRC'), txDelMes('u1', -100, 'USD')];

    setup();

    expect(screen.getByText('₡25,000.00')).toBeInTheDocument();
    // Con el codigo anterior: 25000 + 100 = "₡25,100.00".
    expect(screen.queryByText('₡25,100.00')).not.toBeInTheDocument();
    expect(screen.getByText(/otras monedas: 1/i)).toBeInTheDocument();
  });

  it('no avisa de otras monedas cuando todo el mes esta en colones', () => {
    appState.transactions = [txDelMes('c1', -25000, 'CRC')];

    setup();

    expect(screen.getByText('₡25,000.00')).toBeInTheDocument();
    expect(screen.queryByText(/otras monedas/i)).not.toBeInTheDocument();
  });
});
