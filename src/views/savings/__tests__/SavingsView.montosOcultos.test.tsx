import { act, cleanup, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SavingsView } from '../SavingsView';
import { useSavingsStore } from '@/stores/savings.store';
import { useAuthStore } from '@/stores/auth.store';
import { useSettingsStore } from '@/stores/settings.store';

const mocks = vi.hoisted(() => ({
  api: {
    savings: {
      getGoals: vi.fn(),
      createGoal: vi.fn(),
      deposit: vi.fn(),
      withdraw: vi.fn(),
      deleteGoal: vi.fn(),
    },
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mocks.api }));
vi.mock('@/services/dataSync', () => ({ refreshAccounts: vi.fn(), refreshTransactions: vi.fn() }));
vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      baseCurrency: 'CRC',
      accounts: [{ ccy: 'CRC', balance: 200000, symbol: '₡', flag: '', iban: '', name: 'Colones', type: 'fiat' }],
    },
    dispatch: vi.fn(),
  }),
}));

const meta = {
  id: 'g1',
  name: 'Casa',
  target: 100000,
  saved: 25000,
  icon: 'piggy-bank',
  color: '#3b82f6',
  createdAt: '2026-09-01T00:00:00.000Z',
};

function abrir() {
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
  useAuthStore.setState({ user: null });
  mocks.api.savings.getGoals.mockResolvedValue({ success: true, data: [meta] });
});

afterEach(() => {
  cleanup();
  act(() => useSettingsStore.setState({ saldoOculto: false }));
});

describe('SavingsView - montos ocultos', () => {
  it('muestra el total y lo apartado de cada meta cuando no estan ocultos', async () => {
    useSettingsStore.setState({ saldoOculto: false });
    abrir();

    expect(await screen.findByText('Casa')).toBeInTheDocument();
    expect(screen.getAllByText(/25,000/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('Monto oculto')).not.toBeInTheDocument();
  });

  it('tapa el total, el objetivo y lo apartado de cada meta cuando la persona los oculta', async () => {
    useSettingsStore.setState({ saldoOculto: true });
    abrir();

    expect(await screen.findByText('Casa')).toBeInTheDocument();
    expect(screen.queryByText(/25,000/)).not.toBeInTheDocument();
    expect(screen.queryByText(/100,000/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Monto oculto').length).toBeGreaterThanOrEqual(4);
  });
});
