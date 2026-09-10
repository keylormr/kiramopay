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
