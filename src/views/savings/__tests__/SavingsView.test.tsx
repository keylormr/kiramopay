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

// El defecto que estas pruebas cierran: `if (res.success && res.data)` sin rama
// de fallo. La consulta se caia y la pantalla afirmaba "Total ahorrado 0" y
// "Sin metas de ahorro" — o sea, le decia al usuario que no tiene ahorros
// cuando lo unico cierto era que no se habian podido consultar.
describe('SavingsView — no inventa numeros ni festeja rechazos', () => {
  it('cuando la consulta de metas falla, lo dice en vez de afirmar que no hay ahorros', async () => {
    mocks.api.savings.getGoals.mockResolvedValue({ success: false, error: { code: 'FETCH_FAILED' } });

    setup();

    expect(await screen.findByText('No pudimos cargar tus metas de ahorro.')).toBeInTheDocument();
    expect(screen.queryByText('Sin metas de ahorro')).not.toBeInTheDocument();
    expect(screen.queryByText('Total ahorrado')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('cuando la consulta se cae con excepcion tampoco pinta una lista vacia', async () => {
    mocks.api.savings.getGoals.mockRejectedValue(new Error('sin red'));

    setup();

    expect(await screen.findByText('No pudimos cargar tus metas de ahorro.')).toBeInTheDocument();
  });

  // El `finally` cerraba la hoja y limpiaba el monto pasara lo que pasara: un
  // deposito RECHAZADO se veia exactamente igual que uno exitoso.
  it('un deposito rechazado deja la hoja abierta, el monto escrito y el motivo a la vista', async () => {
    mocks.api.savings.deposit.mockResolvedValue({ success: false, error: { code: 'SAVINGS_FAILED' } });
    const user = userEvent.setup();

    setup();

    await user.click(await screen.findByRole('button', { name: 'Agregar fondos' }));
    const monto = await screen.findByPlaceholderText('0');
    await user.type(monto, '10000');
    await user.click(screen.getByRole('button', { name: 'Depositar' }));

    expect(await screen.findByText('No se pudo depositar. Tu dinero sigue en la billetera.')).toBeInTheDocument();
    expect(monto).toHaveValue(10000);
  });

  // Borrar una meta con plata adentro era un toque sin pregunta.
  it('la X pide confirmacion y avisa que la plata guardada vuelve a la billetera', async () => {
    mocks.api.savings.getGoals.mockResolvedValue({ success: true, data: [{ ...meta, saved: 25000 }] });
    const user = userEvent.setup();

    setup();

    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));

    expect(await screen.findByText(/Vas a eliminar/)).toBeInTheDocument();
    expect(screen.getByText(/vuelven a tu billetera/)).toBeInTheDocument();
    expect(mocks.api.savings.deleteGoal).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => {
      expect(mocks.api.savings.deleteGoal).not.toHaveBeenCalled();
    });
  });

  it('confirmando el borrado si se elimina', async () => {
    mocks.api.savings.getGoals.mockResolvedValue({ success: true, data: [{ ...meta, saved: 25000 }] });
    mocks.api.savings.deleteGoal.mockResolvedValue({ success: true, data: { status: 'deleted' } });
    const user = userEvent.setup();

    setup();

    await user.click(await screen.findByRole('button', { name: 'Eliminar' }));
    const hoja = await screen.findByText(/Vas a eliminar/);
    expect(hoja).toBeInTheDocument();
    const botones = screen.getAllByRole('button', { name: 'Eliminar' });
    await user.click(botones[botones.length - 1]);

    await waitFor(() => {
      expect(mocks.api.savings.deleteGoal).toHaveBeenCalledWith('g1');
    });
  });
});
