import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SavingsView } from '../SavingsView';
import { useSavingsStore } from '@/stores/savings.store';
import { useAuthStore } from '@/stores/auth.store';

// Depositar y retirar armaban una llave nueva en cada llamada: si la red se
// cortaba sin traer la respuesta, el movimiento pudo haberse hecho, la hoja
// decia "tu dinero sigue en la billetera" y tocar otra vez lo hacia de nuevo.

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

vi.mock('@/services/dataSync', () => ({ refreshAccounts: vi.fn(() => Promise.resolve()) }));

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

const SIN_RED = { success: false, error: { code: 'NETWORK_ERROR', message: 'Sin conexión' } };

function setup() {
  return render(
    <LanguageProvider>
      <SavingsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

type Usuario = ReturnType<typeof userEvent.setup>;

async function depositar(user: Usuario, monto: string) {
  await user.click(await screen.findByRole('button', { name: 'Agregar fondos' }));
  await user.type(await screen.findByPlaceholderText('0'), monto);
  await user.click(screen.getByRole('button', { name: 'Depositar' }));
}

function llaveDe(fn: ReturnType<typeof vi.fn>, llamada: number): string {
  const llave = fn.mock.calls[llamada]?.[2];
  expect(typeof llave).toBe('string');
  expect((llave as string).length).toBeGreaterThan(0);
  return llave as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  useSavingsStore.setState({ goals: [] });
  useAuthStore.setState({ user: null });
  mocks.api.savings.getGoals.mockResolvedValue({ success: true, data: [meta] });
});

describe('SavingsView — la llave de depositar y retirar', () => {
  it('tras un corte de red lo dice, y depositar otra vez lleva la misma llave', async () => {
    mocks.api.savings.deposit
      .mockResolvedValueOnce(SIN_RED)
      .mockResolvedValueOnce({ success: true, data: { ...meta, saved: 35000 } });
    const user = userEvent.setup();
    setup();

    await depositar(user, '10000');

    expect(await screen.findByText(/^No pudimos confirmar el movimiento/)).toBeInTheDocument();
    expect(screen.queryByText(/Tu dinero sigue en la billetera/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Depositar' }));
    await waitFor(() => expect(mocks.api.savings.deposit).toHaveBeenCalledTimes(2));
    expect(llaveDe(mocks.api.savings.deposit, 1)).toBe(llaveDe(mocks.api.savings.deposit, 0));
  });

  it('despues de un deposito hecho, el siguiente igual lleva otra llave', async () => {
    mocks.api.savings.deposit
      .mockResolvedValueOnce({ success: true, data: { ...meta, saved: 35000 } })
      .mockResolvedValueOnce({ success: true, data: { ...meta, saved: 45000 } });
    const user = userEvent.setup();
    setup();

    await depositar(user, '10000');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Depositar' })).not.toBeInTheDocument());
    await depositar(user, '10000');

    await waitFor(() => expect(mocks.api.savings.deposit).toHaveBeenCalledTimes(2));
    expect(llaveDe(mocks.api.savings.deposit, 1)).not.toBe(llaveDe(mocks.api.savings.deposit, 0));
  });

  // Que la llave de un deposito cortado no se trague uno nuevo identico lo
  // resuelve el servidor, que marca la repeticion: la pantalla lo dice y suelta
  // la llave.
  it('un deposito que ya estaba hecho lo dice, y el siguiente igual lleva otra llave', async () => {
    mocks.api.savings.deposit
      .mockResolvedValueOnce(SIN_RED)
      .mockResolvedValueOnce({ success: true, data: { ...meta, saved: 35000, repetida: true } })
      .mockResolvedValueOnce({ success: true, data: { ...meta, saved: 45000 } });
    const user = userEvent.setup();
    setup();

    await depositar(user, '10000');
    await screen.findByText(/^No pudimos confirmar el movimiento/);
    await user.click(screen.getByRole('button', { name: 'Depositar' }));

    expect(await screen.findByText(/^Ese movimiento ya se había hecho/)).toBeInTheDocument();

    await depositar(user, '10000');
    await waitFor(() => expect(mocks.api.savings.deposit).toHaveBeenCalledTimes(3));
    expect(llaveDe(mocks.api.savings.deposit, 2)).not.toBe(llaveDe(mocks.api.savings.deposit, 0));
  });

  it('tras un corte de red, retirar otra vez lleva la misma llave', async () => {
    mocks.api.savings.withdraw
      .mockResolvedValueOnce(SIN_RED)
      .mockResolvedValueOnce({ success: true, data: { ...meta, saved: 20000 } });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Retirar fondos' }));
    await user.type(await screen.findByPlaceholderText('0'), '5000');
    await user.click(screen.getByRole('button', { name: 'Retirar' }));

    expect(await screen.findByText(/^No pudimos confirmar el movimiento/)).toBeInTheDocument();
    expect(screen.queryByText(/Tu dinero sigue en la meta/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retirar' }));
    await waitFor(() => expect(mocks.api.savings.withdraw).toHaveBeenCalledTimes(2));
    expect(llaveDe(mocks.api.savings.withdraw, 1)).toBe(llaveDe(mocks.api.savings.withdraw, 0));
  });
});
