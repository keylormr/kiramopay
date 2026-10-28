import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SavingsView } from '../SavingsView';
import { useSavingsStore } from '@/stores/savings.store';
import { useAuthStore } from '@/stores/auth.store';

// Depositar o retirar de una meta mueve el saldo, y la pantalla ya traia el
// saldo nuevo; pero la lista de movimientos del Inicio no se enteraba: al
// volver, el deposito y el retiro no estaban hasta recargar la pagina. El
// Inicio solo la refresca cuando llega una notificacion en vivo.
//
// hasBackend se lee UNA vez al cargar el modulo: la variable va en vi.hoisted.
const mocks = vi.hoisted(() => {
  import.meta.env.VITE_API_URL = 'http://localhost:8080';
  return {
    api: {
      savings: {
        getGoals: vi.fn(),
        createGoal: vi.fn(),
        deposit: vi.fn(),
        withdraw: vi.fn(),
        deleteGoal: vi.fn(),
      },
    },
    refreshAccounts: vi.fn(() => Promise.resolve()),
    refreshTransactions: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('@/api', () => ({ getApiLayer: () => mocks.api }));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: mocks.refreshAccounts,
  refreshTransactions: mocks.refreshTransactions,
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      baseCurrency: 'CRC',
      user: { id: 'u1' },
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
  useAuthStore.setState({ user: null });
  mocks.api.savings.getGoals.mockResolvedValue({ success: true, data: [meta] });
});

describe('SavingsView — los movimientos del Inicio despues de mover una meta', () => {
  it('depositar trae el saldo Y los movimientos', async () => {
    mocks.api.savings.deposit.mockResolvedValue({ success: true, data: { saved: 35000 } });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Agregar fondos' }));
    await user.type(await screen.findByPlaceholderText('0'), '10000');
    await user.click(screen.getByRole('button', { name: 'Depositar' }));

    await waitFor(() => expect(mocks.refreshAccounts).toHaveBeenCalled());
    expect(mocks.refreshTransactions).toHaveBeenCalled();
  });

  it('retirar trae el saldo Y los movimientos', async () => {
    mocks.api.savings.withdraw.mockResolvedValue({ success: true, data: { saved: 15000 } });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Retirar fondos' }));
    await user.type(await screen.findByPlaceholderText('0'), '10000');
    await user.click(screen.getByRole('button', { name: 'Retirar' }));

    await waitFor(() => expect(mocks.refreshAccounts).toHaveBeenCalled());
    expect(mocks.refreshTransactions).toHaveBeenCalled();
  });

  it('borrar una meta con plata (que la devuelve a la billetera) trae los dos', async () => {
    mocks.api.savings.deleteGoal.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    const confirmar = (await screen.findAllByRole('button', { name: 'Eliminar' })).pop()!;
    await user.click(confirmar);

    await waitFor(() => expect(mocks.refreshAccounts).toHaveBeenCalled());
    expect(mocks.refreshTransactions).toHaveBeenCalled();
  });

  it('un deposito rechazado no pide nada: no se movio nada', async () => {
    mocks.api.savings.deposit.mockResolvedValue({
      success: false,
      error: { code: 'INSUFFICIENT_BALANCE', message: 'x' },
    });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Agregar fondos' }));
    await user.type(await screen.findByPlaceholderText('0'), '10000');
    await user.click(screen.getByRole('button', { name: 'Depositar' }));

    await waitFor(() => expect(mocks.api.savings.deposit).toHaveBeenCalled());
    expect(mocks.refreshTransactions).not.toHaveBeenCalled();
  });
});
