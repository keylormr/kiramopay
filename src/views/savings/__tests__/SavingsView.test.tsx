import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SavingsView } from '../SavingsView';
import { useSavingsStore } from '@/stores/savings.store';

const mocks = vi.hoisted(() => ({
  api: {
    savings: {
      getGoals: vi.fn(),
      createGoal: vi.fn(),
      deposit: vi.fn(),
      deleteGoal: vi.fn(),
    },
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mocks.api }));

vi.mock('@/services/dataSync', () => ({ refreshAccounts: vi.fn() }));

const appState = vi.hoisted(() => ({ baseCurrency: 'CRC' }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      baseCurrency: appState.baseCurrency,
      accounts: [
        { ccy: 'USD', balance: 5, symbol: '$', flag: '🇺🇸', iban: '', name: 'Dolares', type: 'fiat' },
        { ccy: 'CRC', balance: 200000, symbol: '₡', flag: '🇨🇷', iban: '', name: 'Colones', type: 'fiat' },
      ],
    },
    dispatch: vi.fn(),
  }),
}));

const meta = {
  id: 'g1',
  name: 'Casa',
  target: 100000,
  saved: 0,
  icon: 'piggy-bank',
  color: '#3b82f6',
  createdAt: '2026-09-01T00:00:00.000Z',
};

function setup() {
  return render(
    <LanguageProvider>
      <SavingsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  useSavingsStore.setState({ goals: [] });
  appState.baseCurrency = 'CRC';
  mocks.api.savings.getGoals.mockResolvedValue({ success: true, data: [meta] });
});

describe('SavingsView — la hoja de deposito habla en colones', () => {
  // Las metas se crean y se rotulan en colones; el saldo salia de la cuenta de
  // la moneda base, que se cambia con un toque en el home.
  it('muestra el saldo de la cuenta en colones aunque la moneda base sea otra', async () => {
    appState.baseCurrency = 'USD';
    const user = userEvent.setup();

    setup();

    await user.click(await screen.findByRole('button', { name: 'Agregar fondos' }));

    await waitFor(() => {
      expect(screen.getByText(/Disponible: ₡200,000\.00/)).toBeInTheDocument();
    });
    // Con el codigo anterior se leia el saldo de la cuenta en dolares (5) y se
    // rotulaba en colones.
    expect(screen.queryByText(/₡5\.00/)).not.toBeInTheDocument();
  });

  // La validacion de fondos usa la misma cuenta que la etiqueta.
  it('deja depositar contra el saldo en colones con la moneda base en dolares', async () => {
    appState.baseCurrency = 'USD';
    mocks.api.savings.deposit.mockResolvedValue({ success: true, data: { saved: 10000 } });
    const user = userEvent.setup();

    setup();

    await user.click(await screen.findByRole('button', { name: 'Agregar fondos' }));
    await user.type(await screen.findByPlaceholderText('0'), '10000');
    await user.click(screen.getByRole('button', { name: 'Depositar' }));

    await waitFor(() => {
      expect(mocks.api.savings.deposit).toHaveBeenCalledWith('g1', 10000);
    });
  });
});
