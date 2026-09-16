import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { EscrowView } from '../EscrowView';

const mockApi = vi.hoisted(() => ({
  escrow: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    fund: vi.fn(),
    release: vi.fn(),
    refund: vi.fn(),
    dispute: vi.fn(),
    cancel: vi.fn(),
    deliver: vi.fn(),
    adminList: vi.fn(),
    adminResolve: vi.fn(),
  },
  mfa: { totpVerify: vi.fn() },
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mockApi,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

// EscrowView reads the current user id to decide buyer/seller roles.
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: { user?: { id: string } }) => unknown) =>
    selector({ user: { id: 'buyer-1' } }),
}));

// Spy the global-balance refetch the view fires after a successful money action.
const mockDataSync = vi.hoisted(() => ({ refreshAccounts: vi.fn(() => Promise.resolve()) }));
vi.mock('@/services/dataSync', () => mockDataSync);

// La pantalla ofrece los contactos guardados para no teclear el numero.
const appState = vi.hoisted(() => ({
  sinpeContacts: [] as Array<{ id: string; name: string; phone: string; isFavorite?: boolean }>,
}));
vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({ state: { sinpeContacts: appState.sinpeContacts }, dispatch: vi.fn() }),
}));

function setup() {
  return render(
    <LanguageProvider>
      <EscrowView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

const pendingAgreement = {
  id: 'a1',
  buyerId: 'buyer-1',
  sellerId: 'seller-1',
  amountMinor: 25000000, // ₡250,000 — above the MFA threshold
  currency: 'CRC',
  status: 'pending',
  description: 'Laptop',
  createdAt: '',
  updatedAt: '',
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mockApi.escrow.list.mockResolvedValue({ success: true, data: [pendingAgreement] });
  mockApi.escrow.fund.mockReset();
  mockApi.escrow.create.mockReset();
  mockApi.escrow.deliver.mockReset();
  mockApi.escrow.release.mockReset();
  mockApi.mfa.totpVerify.mockReset();
  mockDataSync.refreshAccounts.mockClear();
  appState.sinpeContacts = [];
});

describe('EscrowView', () => {
  it('lists the caller agreements', async () => {
    setup();
    expect(await screen.findByText('Laptop')).toBeInTheDocument();
  });

  it('prompts for MFA when funding hits the high-value gate, then retries', async () => {
    mockApi.escrow.fund
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } })
      .mockResolvedValueOnce({ success: true, data: { ...pendingAgreement, status: 'funded' } });
    mockApi.mfa.totpVerify.mockResolvedValue({ success: true, data: { verified: true } });
    const user = userEvent.setup();
    setup();

    // Open the agreement detail, then fund (buyer + pending shows the Fondear button).
    await user.click(await screen.findByText('Laptop'));
    await user.click(await screen.findByText('Fondear'));

    // MFA challenge, not a raw error.
    expect(await screen.findByText('Verificación requerida')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByText('Verificar y activar'));

    await waitFor(() => {
      expect(mockApi.mfa.totpVerify).toHaveBeenCalledWith('123456', 'high_value_tx');
      expect(mockApi.escrow.fund).toHaveBeenCalledTimes(2);
    });
  });

  it('refetches the global wallet balance after a successful money action', async () => {
    mockApi.escrow.fund.mockResolvedValue({
      success: true,
      data: { ...pendingAgreement, status: 'funded' },
    });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByText('Laptop'));
    await user.click(await screen.findByText('Fondear'));

    await waitFor(() => expect(mockApi.escrow.fund).toHaveBeenCalledTimes(1));
    expect(mockDataSync.refreshAccounts).toHaveBeenCalled();
  });
});

// El acuerdo se abria pidiendo el UUID del vendedor, con marcador
// "00000000-0000-0000-0000-000000000000". Ninguna pantalla de la aplicacion
// muestra el UUID de nadie: no habia forma de crear un acuerdo con una persona
// real, asi que el producto entero era inalcanzable desde la app.
describe('EscrowView — abrir un acuerdo con una persona real', () => {
  const abrirHoja = async (user: ReturnType<typeof userEvent.setup>) => {
    setup();
    await screen.findByText('Laptop');
    await user.click(screen.getByRole('button', { name: 'Nuevo acuerdo' }));
  };

  it('manda el TELEFONO del vendedor, no un identificador interno', async () => {
    mockApi.escrow.create.mockResolvedValue({
      success: true,
      data: { ...pendingAgreement, id: 'a2', description: 'Bicicleta' },
    });
    const user = userEvent.setup();
    await abrirHoja(user);

    await user.type(screen.getByPlaceholderText('8888-1234'), '88885678');
    await user.type(screen.getByPlaceholderText('0.00'), '1500');
    await user.type(screen.getByPlaceholderText(/qu[eé] se est[aá]/i), 'Bicicleta');
    await user.click(screen.getByText('Crear acuerdo', { selector: 'button' }));

    await waitFor(() =>
      expect(mockApi.escrow.create).toHaveBeenCalledWith(
        expect.objectContaining({ sellerPhone: '88885678', amountMinor: 150000 }),
      ),
    );
    // Y NO manda el campo que la persona no podia conseguir.
    expect(mockApi.escrow.create.mock.calls[0][0]).not.toHaveProperty('sellerId');
  });

  it('un contacto guardado llena el numero de un toque', async () => {
    appState.sinpeContacts = [
      { id: 'c1', name: 'Victor', phone: '+50688885678', isFavorite: true },
      { id: 'c2', name: 'Ana', phone: '+50688881111' },
    ];
    const user = userEvent.setup();
    await abrirHoja(user);

    await user.click(screen.getByText('Victor'));

    expect(screen.getByPlaceholderText('8888-1234')).toHaveValue('+50688885678');
  });

  it('si el numero no tiene cuenta lo dice, en vez del error generico', async () => {
    mockApi.escrow.create.mockResolvedValue({
      success: false,
      error: { code: 'ESCROW_SELLER_NOT_FOUND', message: 'that number does not have a KiramoPay account' },
    });
    const user = userEvent.setup();
    await abrirHoja(user);

    await user.type(screen.getByPlaceholderText('8888-1234'), '11112222');
    await user.type(screen.getByPlaceholderText('0.00'), '1500');
    await user.type(screen.getByPlaceholderText(/qu[eé] se est[aá]/i), 'Humo');
    await user.click(screen.getByText('Crear acuerdo', { selector: 'button' }));

    // La vista pinta el mismo error en la lista y en la hoja; basta con que
    // aparezca, y con que NO sea el generico.
    expect((await screen.findAllByText(/no tiene cuenta de KiramoPay/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/that number does not have/i)).not.toBeInTheDocument();
  });
});

// Un escrow fondeado no vencia nunca, y ninguna parte sabia que tenia un plazo.
// Ahora cada parte ve el plazo que le corre y que pasa si lo pierde.
describe('EscrowView — los plazos', () => {
  const fondeado = {
    ...pendingAgreement,
    id: 'a9',
    status: 'funded',
    description: 'Bicicleta',
    deliverBy: '2099-09-25T18:00:00.000Z',
  };

  it('el vendedor ve su plazo y el boton de marcar la entrega', async () => {
    // El usuario del mock es 'buyer-1': aca actua como VENDEDOR del acuerdo.
    const comoVendedor = { ...fondeado, buyerId: 'otra-persona', sellerId: 'buyer-1' };
    mockApi.escrow.list.mockResolvedValue({ success: true, data: [comoVendedor] });
    mockApi.escrow.deliver.mockResolvedValue({
      success: true,
      data: { ...comoVendedor, deliveredAt: '2099-09-12T10:00:00.000Z', reviewBy: '2099-09-19T10:00:00.000Z' },
    });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByText('Bicicleta'));
    expect(screen.getByText(/tienes hasta el .* para marcar la entrega/i)).toBeInTheDocument();

    await user.click(screen.getByText('Marcar como entregado'));
    await waitFor(() => expect(mockApi.escrow.deliver).toHaveBeenCalledWith('a9'));
    // Y ya entregado, el vendedor ve el plazo del comprador.
    expect(await screen.findByText(/si el comprador no reclama antes del/i)).toBeInTheDocument();
  });

  it('el comprador ve el plazo del vendedor y que pasa si vence', async () => {
    mockApi.escrow.list.mockResolvedValue({ success: true, data: [fondeado] });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByText('Bicicleta'));
    expect(screen.getByText(/el vendedor tiene hasta el .* se te devuelve el pago/i)).toBeInTheDocument();
    // El comprador no marca entregas.
    expect(screen.queryByText('Marcar como entregado')).not.toBeInTheDocument();
  });

  it('en una disputa el comprador puede ceder liberando', async () => {
    const disputado = { ...fondeado, status: 'disputed', disputeReason: 'no llego' };
    mockApi.escrow.list.mockResolvedValue({ success: true, data: [disputado] });
    mockApi.escrow.release.mockResolvedValue({ success: true, data: { ...disputado, status: 'released' } });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByText('Bicicleta'));
    expect(screen.getByText(/cualquiera de las dos partes puede ceder/i)).toBeInTheDocument();
    await user.click(screen.getByText('Liberar al vendedor'));
    await waitFor(() => expect(mockApi.escrow.release).toHaveBeenCalledWith('a9'));
  });

  it('un plazo vencido tiene su propio mensaje, una sola vez', async () => {
    const comoVendedor = { ...fondeado, buyerId: 'otra-persona', sellerId: 'buyer-1' };
    mockApi.escrow.list.mockResolvedValue({ success: true, data: [comoVendedor] });
    mockApi.escrow.deliver.mockResolvedValue({
      success: false,
      error: { code: 'ESCROW_DEADLINE_PASSED', message: 'the deadline for this step has passed' },
    });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByText('Bicicleta'));
    await user.click(screen.getByText('Marcar como entregado'));

    // El error se pintaba en la lista Y en la hoja: ahora solo donde ocurrio.
    await waitFor(() => expect(screen.getAllByText(/ese plazo ya venció/i)).toHaveLength(1));
  });
});

describe('EscrowView — si la lista no carga', () => {
  it('no dice que no hay acuerdos: dice que no se pudo consultar, nunca el texto crudo del servidor', async () => {
    // Un codigo que la pantalla no conoce: el texto en ingles del servidor
    // ('sin red' aqui simula ese texto crudo) NUNCA debe llegar a pantalla.
    mockApi.escrow.list.mockResolvedValue({ success: false, error: { code: 'X', message: 'sin red' } });
    setup();

    expect(await screen.findByText('No se pudo completar la acción')).toBeInTheDocument();
    expect(screen.queryByText('sin red')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
    expect(screen.queryByText(/aún no tienes acuerdos/i)).not.toBeInTheDocument();
  });
});

// n=39 de la QA 2026-09-13: el texto crudo del servidor (en ingles) llegaba a
// pantalla siempre que el codigo no fuera ESCROW_SELLER_NOT_FOUND, incluso
// para codigos que la pantalla ya conoce y para los que no.
describe('EscrowView — nunca el texto crudo del servidor (hallazgo n=39)', () => {
  it('contigo mismo: ESCROW_SELF tiene su propio mensaje en espanol', async () => {
    mockApi.escrow.create.mockResolvedValue({
      success: false,
      error: { code: 'ESCROW_SELF', message: 'cannot create an agreement with yourself' },
    });
    const user = userEvent.setup();
    setup();
    await screen.findByText('Laptop');
    await user.click(screen.getByRole('button', { name: 'Nuevo acuerdo' }));

    await user.type(screen.getByPlaceholderText('8888-1234'), '88880001');
    await user.type(screen.getByPlaceholderText('0.00'), '100');
    await user.type(screen.getByPlaceholderText(/qu[eé] se est[aá]/i), 'Yo mismo');
    await user.click(screen.getByText('Crear acuerdo', { selector: 'button' }));

    expect(await screen.findByText('No puedes crear un acuerdo contigo mismo')).toBeInTheDocument();
    expect(screen.queryByText(/cannot create an agreement/i)).not.toBeInTheDocument();
  });

  it('un codigo del modulo que la pantalla no mapea explicitamente cae al generico, nunca al texto crudo', async () => {
    mockApi.escrow.create.mockResolvedValue({
      success: false,
      error: { code: 'ESCROW_FAILED', message: 'operation failed' },
    });
    const user = userEvent.setup();
    setup();
    await screen.findByText('Laptop');
    await user.click(screen.getByRole('button', { name: 'Nuevo acuerdo' }));

    await user.type(screen.getByPlaceholderText('8888-1234'), '88880002');
    await user.type(screen.getByPlaceholderText('0.00'), '100');
    await user.type(screen.getByPlaceholderText(/qu[eé] se est[aá]/i), 'Algo');
    await user.click(screen.getByText('Crear acuerdo', { selector: 'button' }));

    expect(await screen.findByText('No se pudo completar la acción')).toBeInTheDocument();
    expect(screen.queryByText(/operation failed/i)).not.toBeInTheDocument();
  });

  it('INVALID_REQUEST generico tambien cae al mensaje en espanol, no a "invalid request"', async () => {
    mockApi.escrow.create.mockResolvedValue({
      success: false,
      error: { code: 'INVALID_REQUEST', message: 'invalid request' },
    });
    const user = userEvent.setup();
    setup();
    await screen.findByText('Laptop');
    await user.click(screen.getByRole('button', { name: 'Nuevo acuerdo' }));

    await user.type(screen.getByPlaceholderText('8888-1234'), '88880003');
    await user.type(screen.getByPlaceholderText('0.00'), '100');
    await user.type(screen.getByPlaceholderText(/qu[eé] se est[aá]/i), 'Algo');
    await user.click(screen.getByText('Crear acuerdo', { selector: 'button' }));

    expect(await screen.findByText('No se pudo completar la acción')).toBeInTheDocument();
    expect(screen.queryByText('invalid request')).not.toBeInTheDocument();
  });
});

// n=40 de la QA 2026-09-13: con monto "0" el boton parecia listo (habilitado)
// y el clic no hacia absolutamente nada, sin avisar.
describe('EscrowView — monto invalido al crear (hallazgo n=40)', () => {
  const llenarSinMonto = async (user: ReturnType<typeof userEvent.setup>) => {
    setup();
    await screen.findByText('Laptop');
    await user.click(screen.getByRole('button', { name: 'Nuevo acuerdo' }));
    await user.type(screen.getByPlaceholderText('8888-1234'), '88880004');
    await user.type(screen.getByPlaceholderText(/qu[eé] se est[aá]/i), 'Bicicleta');
  };

  it('con monto "0" el boton de crear queda deshabilitado, igual que con el campo vacio', async () => {
    const user = userEvent.setup();
    await llenarSinMonto(user);

    await user.type(screen.getByPlaceholderText('0.00'), '0');

    expect(screen.getByText('Crear acuerdo', { selector: 'button' })).toBeDisabled();
    expect(mockApi.escrow.create).not.toHaveBeenCalled();
  });
  // No hay caso de monto negativo aqui: CampoMonto (utils/campoMonto.ts) ya
  // no preserva el signo "-" al teclear, asi que ese input nunca llega a
  // valer un numero negativo en esta pantalla.
});
