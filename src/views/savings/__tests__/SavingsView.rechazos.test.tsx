import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SavingsView } from '../SavingsView';
import { useSavingsStore } from '@/stores/savings.store';
import { useAuthStore } from '@/stores/auth.store';

// Depositar y retirar respondian 400 SAVINGS_FAILED para todo: sin saldo, mas
// de lo guardado, un monto en cero, una meta que ya no existe y tambien una
// falla del servidor. La hoja decia "no se pudo, tu dinero sigue donde estaba"
// en todos los casos, aun cuando el servidor fallo y el dinero pudo haberse
// movido. Ahora cada motivo llega con su codigo y la falla es un 500.

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

// Lo que entrega el cliente HTTP ante el 500: el codigo del servidor y su
// propio texto, porque el del servidor es "internal server error".
const FALLA_DEL_SERVIDOR = {
  success: false,
  error: { code: 'SAVINGS_FAILED', message: 'Error del servidor. Intenta de nuevo más tarde.' },
};

function rechazo(code: string, message: string) {
  return { success: false, error: { code, message } };
}

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

async function retirar(user: Usuario, monto: string) {
  await user.click(await screen.findByRole('button', { name: 'Retirar fondos' }));
  await user.type(await screen.findByPlaceholderText('0'), monto);
  await user.click(screen.getByRole('button', { name: 'Retirar' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks no vacia las respuestas encoladas con mockResolvedValueOnce:
  // la que una prueba no llego a usar se la llevaba la siguiente.
  Object.values(mocks.api.savings).forEach((fn) => fn.mockReset());
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  useSavingsStore.setState({ goals: [] });
  useAuthStore.setState({ user: null });
  mocks.api.savings.getGoals.mockResolvedValue({ success: true, data: [meta] });
});

describe('SavingsView — cada rechazo de depositar y retirar con su motivo', () => {
  it('depositar sin saldo lo dice, y no con el texto del servidor', async () => {
    mocks.api.savings.deposit.mockResolvedValue(rechazo('INSUFFICIENT_BALANCE', 'insufficient balance'));
    const user = userEvent.setup();
    setup();

    await depositar(user, '10000');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No tienes saldo suficiente en la billetera para ese depósito.',
    );
    expect(screen.queryByText(/insufficient balance/)).not.toBeInTheDocument();
  });

  it.each([
    ['depositar', depositar, 'deposit'],
    ['retirar', retirar, 'withdraw'],
  ] as const)('%s un monto que no es mayor a cero lo dice', async (_n, mover, metodo) => {
    mocks.api.savings[metodo].mockResolvedValue(
      rechazo('SAVINGS_INVALID_AMOUNT', 'the amount must be greater than zero'),
    );
    const user = userEvent.setup();
    setup();

    await mover(user, '10000');

    expect(await screen.findByRole('alert')).toHaveTextContent('El monto debe ser mayor a cero.');
  });

  // La meta se elimino desde otro dispositivo: se dice y la lista se trae de
  // nuevo, para que no siga ofreciendo una meta que no esta.
  it.each([
    ['depositar', depositar, 'deposit'],
    ['retirar', retirar, 'withdraw'],
  ] as const)('%s en una meta que ya no existe lo dice y actualiza la lista', async (_n, mover, metodo) => {
    mocks.api.savings[metodo].mockResolvedValue(rechazo('SAVINGS_GOAL_NOT_FOUND', 'savings goal not found'));
    const user = userEvent.setup();
    setup();

    await mover(user, '10000');

    expect(await screen.findByRole('alert')).toHaveTextContent('Esa meta ya no existe. Actualizamos la lista.');
    await waitFor(() => expect(mocks.api.savings.getGoals).toHaveBeenCalledTimes(2));
  });

  // La meta tenia menos de lo que la hoja creia (se retiro desde otro lado):
  // se dice, y lo disponible pasa a ser lo de verdad, asi que el mismo monto ya
  // no se puede mandar.
  it('retirar mas de lo que la meta tiene lo dice y actualiza lo disponible', async () => {
    mocks.api.savings.withdraw.mockResolvedValue(
      rechazo('SAVINGS_EXCEEDS_SAVED', 'the amount exceeds what the goal holds'),
    );
    // La primera es la carga de la pantalla; la segunda, la de despues del rechazo.
    mocks.api.savings.getGoals
      .mockResolvedValueOnce({ success: true, data: [meta] })
      .mockResolvedValueOnce({ success: true, data: [{ ...meta, saved: 5000 }] });
    const user = userEvent.setup();
    setup();

    await retirar(user, '10000');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'La meta tiene menos de lo que querías retirar. Actualizamos lo disponible.',
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retirar' })).toBeDisabled());
  });

  // El 500 no es un rechazo: el movimiento pudo haberse hecho. Decir "tu
  // dinero sigue en la billetera" era afirmar algo que la pantalla no sabe.
  it('una falla del servidor al depositar queda sin confirmar, y el reintento lleva la misma llave', async () => {
    mocks.api.savings.deposit
      .mockResolvedValueOnce(FALLA_DEL_SERVIDOR)
      .mockResolvedValueOnce({ success: true, data: { ...meta, saved: 35000 } });
    const user = userEvent.setup();
    setup();

    await depositar(user, '10000');

    expect(await screen.findByRole('alert')).toHaveTextContent(/^No pudimos confirmar el movimiento/);
    expect(screen.queryByText(/Tu dinero sigue en la billetera/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Depositar' }));
    await waitFor(() => expect(mocks.api.savings.deposit).toHaveBeenCalledTimes(2));
    expect(mocks.api.savings.deposit.mock.calls[1][2]).toBe(mocks.api.savings.deposit.mock.calls[0][2]);
  });

  it('una falla del servidor al retirar queda sin confirmar, y el reintento lleva la misma llave', async () => {
    mocks.api.savings.withdraw
      .mockResolvedValueOnce(FALLA_DEL_SERVIDOR)
      .mockResolvedValueOnce({ success: true, data: { ...meta, saved: 20000 } });
    const user = userEvent.setup();
    setup();

    await retirar(user, '5000');

    expect(await screen.findByRole('alert')).toHaveTextContent(/^No pudimos confirmar el movimiento/);
    expect(screen.queryByText(/Tu dinero sigue en la meta/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retirar' }));
    await waitFor(() => expect(mocks.api.savings.withdraw).toHaveBeenCalledTimes(2));
    expect(mocks.api.savings.withdraw.mock.calls[1][2]).toBe(mocks.api.savings.withdraw.mock.calls[0][2]);
  });

  // Un codigo que la pantalla no conoce es un rechazo (lo que el servidor no
  // reconoce es el 500): el texto de siempre, nunca el del servidor, que es
  // para quien integra la API y esta en ingles.
  it('un rechazo sin texto propio cae al de siempre, no al del servidor', async () => {
    mocks.api.savings.deposit.mockResolvedValue(rechazo('ALGO_NUEVO', 'something the server says'));
    const user = userEvent.setup();
    setup();

    await depositar(user, '10000');

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo depositar. Tu dinero sigue en la billetera.');
    expect(screen.queryByText(/something the server says/)).not.toBeInTheDocument();
  });
});
