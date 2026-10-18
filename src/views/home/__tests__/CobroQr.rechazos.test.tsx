import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HomeView } from '../HomeView';

// Los rechazos de la hoja de cobrar. Pedir el codigo, cobrar un monto o
// quitarlo pintaban `res.error.message` cuando el codigo no era de los del
// cobro: el texto del servidor, en ingles, y cuando fallaba la base al crear el
// cobro, la frase del driver. Ahora cada rechazo con codigo se dice en el
// idioma de la app, y el resto cae al aviso de la hoja.

const mocks = vi.hoisted(() => ({
  getMyCode: vi.fn(),
  createCharge: vi.fn(),
  cancelCharge: vi.fn(),
  resolveQr: vi.fn(),
  scanAndPay: vi.fn(),
}));

vi.mock('@/api', () => ({
  MFA_REQUIRED: 'MFA_REQUIRED',
  getApiLayer: () => ({
    qrPayments: {
      getMyCode: mocks.getMyCode,
      createCharge: mocks.createCharge,
      cancelCharge: mocks.cancelCharge,
      resolveQr: mocks.resolveQr,
      scanAndPay: mocks.scanAndPay,
    },
    mfa: { totpVerify: vi.fn() },
  }),
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(() => Promise.resolve()),
  refreshTransactions: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/stores/notification.store', () => ({
  useNotificationStore: (selector: (s: unknown) => unknown) =>
    selector({ notifications: [], unreadCount: 0 }),
}));

vi.mock('@/stores/auth.store', () => {
  const hook = () => ({ user: { id: 'user-001', firstName: 'Keilor', lastName: 'Martinez' } });
  hook.getState = hook;
  hook.setState = vi.fn();
  hook.subscribe = vi.fn();
  return { useAuthStore: hook };
});

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      isAuthenticated: true,
      user: { id: 'user-001', firstName: 'Keilor', lastName: 'Martinez', phone: '70265093' },
      baseCurrency: 'CRC',
      accounts: [
        { ccy: 'CRC', balance: 850000, symbol: '₡', flag: '', iban: '', name: 'Colones', type: 'fiat' },
      ],
      transactions: [],
      sinpeContacts: [],
      notifications: [],
      settings: { darkMode: false },
      crypto: { assets: [] },
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size }: { value: string; size: number }) => (
    <svg data-testid="qr-code" data-value={value} width={size} height={size} />
  ),
}));

vi.mock('@/components/QrScannerPanel', () => ({
  QrScannerPanel: ({ active, onDecode }: { active: boolean; onDecode: (s: string) => void }) =>
    active ? (
      <button onClick={() => onDecode('KP:p2p_receive:abcd1234:0:EUR:iffffffffffffffffffffffff')}>
        simular-escaneo
      </button>
    ) : null,
}));

const codigo = {
  id: 'code-1',
  type: 'p2p_receive' as const,
  amount: 0,
  currency: 'CRC',
  qrData: 'KP:p2p_receive:code1234:0:CRC:iaaaaaaaaaaaaaaaaaaaaaaaa',
  singleUse: false,
  used: false,
  status: 'active' as const,
};

const cobro = {
  id: 'charge-1',
  qrCodeId: 'code-1',
  createdBy: 'user-001',
  amount: 5000,
  currency: 'CRC',
  channel: 'link' as const,
  status: 'pending' as const,
  qrData: 'KP:p2p_request:chg12345:500000:CRC:xbbbbbbbbbbbbbbbbbbbbbbbb',
  expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
};

function pintar() {
  return render(
    <LanguageProvider>
      <HomeView />
    </LanguageProvider>,
  );
}

async function abrirCobrar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));
}

async function cobrarMonto(user: ReturnType<typeof userEvent.setup>) {
  await abrirCobrar(user);
  await screen.findByTestId('qr-code');
  await user.type(screen.getByPlaceholderText('0.00'), '5000');
  await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.getMyCode.mockResolvedValue({ success: true, data: codigo });
  mocks.createCharge.mockResolvedValue({ success: true, data: cobro });
  mocks.cancelCharge.mockResolvedValue({ success: true });
  mocks.resolveQr.mockResolvedValue({
    success: true,
    data: { kind: 'code', payeeName: 'Ana', currency: 'EUR', amount: 0, qrCodeId: 'code-9' },
  });
});

describe('Cobrar con QR — cada rechazo en el idioma de la app', () => {
  it('el codigo pedido en una moneda que no se maneja lo dice, sin el texto del servidor', async () => {
    mocks.getMyCode.mockResolvedValue({
      success: false,
      error: { code: 'UNSUPPORTED_CURRENCY', message: 'unsupported currency' },
    });
    const user = userEvent.setup();
    pintar();

    await abrirCobrar(user);

    expect(await screen.findByText(/^Ese código está en una moneda que KiramoPay no maneja/)).toBeInTheDocument();
    expect(screen.queryByText('unsupported currency')).not.toBeInTheDocument();
  });

  it('un rechazo del codigo sin clave propia cae al aviso de la hoja', async () => {
    mocks.getMyCode.mockResolvedValue({
      success: false,
      error: { code: 'PAYMENT_FAILED', message: 'merchant profile not found' },
    });
    const user = userEvent.setup();
    pintar();

    await abrirCobrar(user);

    expect(await screen.findByText('No se pudo generar el QR')).toBeInTheDocument();
    expect(screen.queryByText('merchant profile not found')).not.toBeInTheDocument();
  });

  it('un monto que el servidor no acepta lo dice en el idioma de la app', async () => {
    mocks.createCharge.mockResolvedValue({
      success: false,
      error: { code: 'MONTO_INVALIDO', message: 'el monto debe ser mayor que cero' },
    });
    const user = userEvent.setup();
    pintar();

    await cobrarMonto(user);

    expect(await screen.findByText('El monto tiene que ser mayor que cero.')).toBeInTheDocument();
    expect(screen.queryByText('el monto debe ser mayor que cero')).not.toBeInTheDocument();
  });

  // Lo que pasaba con un fallo de la base al crear el cobro: el 400 traia la
  // frase del driver y la hoja la mostraba.
  it('cobrar con un rechazo que la pantalla no conoce no muestra el texto del servidor', async () => {
    const crudo = 'insert charge: ERROR: value too long for type character varying(10) (SQLSTATE 22001)';
    mocks.createCharge.mockResolvedValue({ success: false, error: { code: 'PAYMENT_FAILED', message: crudo } });
    const user = userEvent.setup();
    pintar();

    await cobrarMonto(user);

    expect(await screen.findByText('No se pudo generar el QR')).toBeInTheDocument();
    expect(screen.queryByText(crudo)).not.toBeInTheDocument();
  });

  it('quitar el monto con un rechazo que la pantalla no conoce no muestra el texto del servidor', async () => {
    mocks.cancelCharge.mockResolvedValue({
      success: false,
      error: { code: 'PAYMENT_FAILED', message: 'update charge: conn closed' },
    });
    const user = userEvent.setup();
    pintar();

    await cobrarMonto(user);
    await waitFor(() => expect(screen.getByTestId('qr-code')).toHaveAttribute('data-value', cobro.qrData));
    await user.click(screen.getByRole('button', { name: 'Quitar monto' }));

    expect(await screen.findByText('No se pudo generar el QR')).toBeInTheDocument();
    expect(screen.queryByText('update charge: conn closed')).not.toBeInTheDocument();
  });
});

// El pago de un codigo en una moneda sin tope caia al 500, y la hoja decia "no
// pudimos confirmar el pago" por un rechazo en el que no se movio nada.
describe('Pagar un QR — una moneda que no se maneja', () => {
  it('lo dice con su texto, no como un pago sin confirmar', async () => {
    mocks.scanAndPay.mockResolvedValue({
      success: false,
      error: { code: 'UNSUPPORTED_CURRENCY', message: 'unsupported currency' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: /escanear/i }));
    await user.click(await screen.findByRole('button', { name: 'simular-escaneo' }));
    await screen.findByText('Ana');
    await user.type(screen.getByPlaceholderText('0.00'), '1000');
    await user.click(screen.getByRole('button', { name: /pagar/i }));

    expect(await screen.findByText(/^Ese código está en una moneda que KiramoPay no maneja/)).toBeInTheDocument();
    expect(screen.queryByText(/No pudimos confirmar el pago/)).not.toBeInTheDocument();
  });
});
