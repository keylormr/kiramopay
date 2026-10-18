import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SinpeView } from '../SinpeView';

// Solicitar dinero emite un cobro contra el codigo propio. Los rechazos de pedir
// el codigo, de emitir el cobro y de cancelarlo pintaban `res.error.message`
// cuando el codigo no era de los del cobro: el texto del servidor en ingles, o
// la frase del driver cuando fallaba la base.

const mocks = vi.hoisted(() => ({
  api: {
    sinpe: { send: vi.fn() },
    mfa: { totpVerify: vi.fn() },
    qrPayments: {
      getMyCode: vi.fn(),
      createCharge: vi.fn(),
      cancelCharge: vi.fn(),
      listCharges: vi.fn(),
    },
  },
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
      sinpeContacts: [],
      sinpeHistory: [],
      user: { id: 'u1', phone: '+506 8888-0000' },
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(() => Promise.resolve(true)),
  refreshSinpe: vi.fn(() => Promise.resolve()),
  refreshTransactions: vi.fn(() => Promise.resolve()),
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

function setup() {
  return render(
    <LanguageProvider>
      <SinpeView />
    </LanguageProvider>,
  );
}

async function solicitar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: 'Solicitar' })[0]);
  const hoja = within(await screen.findByRole('dialog'));
  await user.type(hoja.getByPlaceholderText('0'), '5000');
  await user.click(hoja.getByRole('button', { name: /Generar QR/ }));
  return hoja;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.api.qrPayments.getMyCode.mockReset().mockResolvedValue({ success: true, data: codigo });
  mocks.api.qrPayments.createCharge.mockReset();
  mocks.api.qrPayments.cancelCharge.mockReset();
  mocks.api.qrPayments.listCharges.mockReset().mockResolvedValue({ success: true, data: [] });
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: () => new Promise(() => {}) },
    configurable: true,
  });
});

describe('SinpeView — solicitar dinero, cada rechazo en el idioma de la app', () => {
  it('si no se pudo traer el codigo propio no muestra el texto del servidor', async () => {
    mocks.api.qrPayments.getMyCode.mockResolvedValue({
      success: false,
      error: { code: 'PAYMENT_FAILED', message: 'get code: conn refused' },
    });
    const user = userEvent.setup();
    setup();

    const hoja = await solicitar(user);

    expect(await hoja.findByText('No se pudo generar el QR')).toBeInTheDocument();
    expect(screen.queryByText('get code: conn refused')).not.toBeInTheDocument();
  });

  it('un monto que el servidor no acepta lo dice en el idioma de la app', async () => {
    mocks.api.qrPayments.createCharge.mockResolvedValue({
      success: false,
      error: { code: 'MONTO_INVALIDO', message: 'el monto debe ser mayor que cero' },
    });
    const user = userEvent.setup();
    setup();

    const hoja = await solicitar(user);

    expect(await hoja.findByText('El monto tiene que ser mayor que cero.')).toBeInTheDocument();
    expect(screen.queryByText('el monto debe ser mayor que cero')).not.toBeInTheDocument();
  });

  it('un rechazo que la pantalla no conoce cae al aviso de la hoja', async () => {
    const crudo = 'insert charge: ERROR: deadlock detected (SQLSTATE 40P01)';
    mocks.api.qrPayments.createCharge.mockResolvedValue({ success: false, error: { code: 'PAYMENT_FAILED', message: crudo } });
    const user = userEvent.setup();
    setup();

    const hoja = await solicitar(user);

    expect(await hoja.findByText('No se pudo generar el QR')).toBeInTheDocument();
    expect(screen.queryByText(crudo)).not.toBeInTheDocument();
  });
});
