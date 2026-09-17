import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SavingsView } from '../SavingsView';
import { useSavingsStore } from '@/stores/savings.store';
import { useAuthStore } from '@/stores/auth.store';
import type { User } from '@/types/auth.types';

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
  useAuthStore.setState({ user: null });
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

// Decision del dueno (2026-09-13): metas activas 3 / 10 / sin tope segun el
// plan. Quien ya tiene mas conserva todo; solo no crea mas.
describe('SavingsView — el tope de metas del plan', () => {
  const metas = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ ...meta, id: `g${i + 1}`, name: `Meta ${i + 1}` }));

  const conPlan = (plan: User['plan']) =>
    useAuthStore.setState({
      user: { id: 'u1', phone: '', firstName: 'K', lastName: 'M', kycLevel: 1, createdAt: '', plan } as User,
    });

  const montar = (onOpenPlans = vi.fn()) =>
    render(
      <LanguageProvider>
        <SavingsView onClose={vi.fn()} onOpenPlans={onOpenPlans} />
      </LanguageProvider>,
    );

  it('con Gratis y 3 metas no abre el formulario: explica el tope y lleva a los planes', async () => {
    mocks.api.savings.getGoals.mockResolvedValue({ success: true, data: metas(3) });
    const onOpenPlans = vi.fn();
    const user = userEvent.setup();
    montar(onOpenPlans);

    const mensaje = 'Tu plan Gratis permite 3 metas activas. Plus permitirá hasta 10, muy pronto.';
    expect(await screen.findByText(mensaje)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nueva meta' }));

    expect(await screen.findByText('Llegaste al tope de tu plan')).toBeInTheDocument();
    expect(screen.getAllByText(mensaje)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Crear meta' })).toBeNull();

    const verPlanes = screen.getAllByRole('button', { name: /Ver planes/ });
    await user.click(verPlanes[verPlanes.length - 1]);
    expect(onOpenPlans).toHaveBeenCalledTimes(1);
    expect(mocks.api.savings.createGoal).not.toHaveBeenCalled();
  });

  it('con Plus y 3 metas si abre el formulario', async () => {
    conPlan('plus');
    mocks.api.savings.getGoals.mockResolvedValue({ success: true, data: metas(3) });
    const user = userEvent.setup();
    montar();

    await user.click(await screen.findByRole('button', { name: 'Nueva meta' }));

    expect(await screen.findByRole('button', { name: 'Crear meta' })).toBeInTheDocument();
    expect(screen.queryByText(/Tu plan Plus permite/)).toBeNull();
  });

  it('con Pro no hay tope aunque tenga muchas', async () => {
    conPlan('pro');
    mocks.api.savings.getGoals.mockResolvedValue({ success: true, data: metas(25) });
    montar();

    expect(await screen.findByText('Meta 25')).toBeInTheDocument();
    expect(screen.queryByText(/permite/)).toBeNull();
  });

  it('cuando el servidor responde SAVINGS_GOAL_LIMIT lo explica con su detalle, no con un error generico', async () => {
    mocks.api.savings.createGoal.mockResolvedValue({
      success: false,
      error: { code: 'SAVINGS_GOAL_LIMIT', message: 'limit', details: { plan: 'free', limite: 3, actuales: 4 } },
    });
    const user = userEvent.setup();
    montar();

    await user.click(await screen.findByRole('button', { name: 'Nueva meta' }));
    await user.type(await screen.findByPlaceholderText('Ej: Vacaciones, Auto nuevo...'), 'Viaje');
    await user.type(screen.getByPlaceholderText('0'), '50000');
    await user.click(screen.getByRole('button', { name: 'Crear meta' }));

    expect(await screen.findByText('Llegaste al tope de tu plan')).toBeInTheDocument();
    expect(screen.getByText('Tu plan Gratis permite 3 metas activas. Plus permitirá hasta 10, muy pronto.')).toBeInTheDocument();
    expect(screen.getByText('Hoy tienes 4 y las conservas todas; solo no puedes crear otra.')).toBeInTheDocument();
    expect(screen.queryByText('No se pudo crear la meta. Intenta de nuevo.')).toBeNull();
  });

  it('quien ya tiene mas que su tope conserva todas sus metas y se le dice', async () => {
    mocks.api.savings.getGoals.mockResolvedValue({ success: true, data: metas(5) });
    montar();

    expect(await screen.findByText('Hoy tienes 5 y las conservas todas; solo no puedes crear otra.')).toBeInTheDocument();
    for (let i = 1; i <= 5; i++) expect(screen.getByText(`Meta ${i}`)).toBeInTheDocument();
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
    // CampoMonto muestra el separador de miles; el monto sigue siendo 10000.
    expect(monto).toHaveValue('10,000');
  });

  // Bug real: la caja del monto tenia un ancho fijo (w-48) sin autoWidth. Con
  // separador de miles, un deposito de ₡1.000.000 no cabia y el texto se
  // recortaba mientras la persona escribia, sin poder ver cuanto iba a
  // depositar.
  it('el campo de monto crece con la cifra en vez de quedar en una caja de ancho fijo', async () => {
    const user = userEvent.setup();

    setup();

    await user.click(await screen.findByRole('button', { name: 'Agregar fondos' }));
    const monto = await screen.findByPlaceholderText('0');
    await user.type(monto, '1000000');

    expect(monto).toHaveValue('1,000,000');
    // Antes: className fija "w-48" y sin la prop autoWidth. Con autoWidth el
    // ancho se deriva del propio texto ya formateado.
    expect((monto as HTMLInputElement).style.width).not.toBe('');
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

// Hallazgo QA n=54: con "0" en el objetivo el boton quedaba habilitado, el
// servidor rechazaba y la hoja solo decia "no se pudo crear la meta".
describe('SavingsView — el objetivo de una meta nueva', () => {
  const abrirFormulario = async (user: ReturnType<typeof userEvent.setup>) => {
    setup();
    await user.click(await screen.findByRole('button', { name: 'Nueva meta' }));
    await user.type(await screen.findByPlaceholderText('Ej: Vacaciones, Auto nuevo...'), 'Casa');
  };

  it.each(['0', '0.00', '0.001', '.'])('con "%s" el boton queda deshabilitado', async (valor) => {
    const user = userEvent.setup();
    await abrirFormulario(user);

    await user.type(screen.getByLabelText('Monto objetivo'), valor);

    expect(screen.getByRole('button', { name: 'Crear meta' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Crear meta' }));
    expect(mocks.api.savings.createGoal).not.toHaveBeenCalled();
  });

  it('con "0" dice por que, junto al campo', async () => {
    const user = userEvent.setup();
    await abrirFormulario(user);

    await user.type(screen.getByLabelText('Monto objetivo'), '0');

    expect(screen.getByText('El monto objetivo debe ser mayor a cero.')).toBeInTheDocument();
    expect(screen.getByLabelText('Monto objetivo')).toHaveAttribute('aria-invalid', 'true');
  });

  it('un nombre de solo espacios no habilita el boton', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(await screen.findByRole('button', { name: 'Nueva meta' }));
    await user.type(await screen.findByPlaceholderText('Ej: Vacaciones, Auto nuevo...'), '   ');
    await user.type(screen.getByLabelText('Monto objetivo'), '50000');

    expect(screen.getByRole('button', { name: 'Crear meta' })).toBeDisabled();
  });

  it('un objetivo valido se envia, y el campo vacio no muestra aviso', async () => {
    mocks.api.savings.createGoal.mockResolvedValue({ success: true, data: { ...meta, id: 'g2', name: 'Casa' } });
    const user = userEvent.setup();
    await abrirFormulario(user);

    expect(screen.queryByText('El monto objetivo debe ser mayor a cero.')).toBeNull();
    await user.type(screen.getByLabelText('Monto objetivo'), '50000');
    await user.click(screen.getByRole('button', { name: 'Crear meta' }));

    await waitFor(() => {
      expect(mocks.api.savings.createGoal).toHaveBeenCalledWith(expect.objectContaining({ name: 'Casa', target: 50000 }));
    });
  });

  it('si el servidor rechaza el objetivo, la hoja dice el motivo en vez del generico', async () => {
    mocks.api.savings.createGoal.mockResolvedValue({
      success: false,
      error: { code: 'SAVINGS_INVALID_TARGET', message: 'the target must be greater than zero' },
    });
    const user = userEvent.setup();
    await abrirFormulario(user);
    await user.type(screen.getByLabelText('Monto objetivo'), '50000');
    await user.click(screen.getByRole('button', { name: 'Crear meta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El monto objetivo debe ser mayor a cero.');
    expect(screen.queryByText('No se pudo crear la meta. Intenta de nuevo.')).toBeNull();
    expect(screen.queryByText(/greater than zero/)).toBeNull();
  });

  it('un rechazo desconocido cae al generico traducido, nunca al texto del servidor', async () => {
    mocks.api.savings.createGoal.mockResolvedValue({
      success: false,
      error: { code: 'CREATE_FAILED', message: 'internal server error' },
    });
    const user = userEvent.setup();
    await abrirFormulario(user);
    await user.type(screen.getByLabelText('Monto objetivo'), '50000');
    await user.click(screen.getByRole('button', { name: 'Crear meta' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo crear la meta. Intenta de nuevo.');
  });
});
