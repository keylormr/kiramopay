import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HomeView } from '../HomeView';

// El QR reciclable, desde la pantalla: el codigo ya esta cuando se abre la
// hoja (antes habia que tocar "Generar QR", y cada toque creaba una fila
// permanente y pagable), cobrar un monto emite un COBRO contra ese codigo, y el
// nonce del pago de monto abierto sobrevive a un fallo de red.
//
// Esa ultima es la que vigila el doble cobro: si el nonce se soltara cuando la
// respuesta NO llego, el reintento seria un cargo nuevo.

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

const mockDispatch = vi.fn();
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
    dispatch: mockDispatch,
  }),
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, size }: { value: string; size: number }) => (
    <svg data-testid="qr-code" data-value={value} width={size} height={size} />
  ),
}));

// El escaner se reemplaza por un boton que entrega una cadena: la camara no
// existe en jsdom, y lo que se quiere probar es lo que pasa DESPUES de escanear.
vi.mock('@/components/QrScannerPanel', () => ({
  QrScannerPanel: ({ active, onDecode }: { active: boolean; onDecode: (s: string) => void }) =>
    active ? (
      <button onClick={() => onDecode('KP:merchant_dynamic:abcd1234:0:CRC:iffffffffffffffffffffffff')}>
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.getMyCode.mockResolvedValue({ success: true, data: codigo });
  mocks.createCharge.mockResolvedValue({ success: true, data: cobro });
  mocks.cancelCharge.mockResolvedValue({ success: true });
  mocks.resolveQr.mockResolvedValue({
    success: true,
    data: { kind: 'code', merchantName: 'Soda Tica', currency: 'CRC', amount: 0, qrCodeId: 'code-1' },
  });
  mocks.scanAndPay.mockResolvedValue({
    success: true,
    data: { id: 'p1', qrCodeId: 'code-1', payerId: 'u', receiverId: 'o', amount: 1000, fee: 0, currency: 'CRC', status: 'completed', createdAt: '' },
  });
});

describe('Cobrar con QR — el codigo se recicla', () => {
  it('la hoja abre con el codigo puesto, sin paso previo de generarlo', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: /cobrar/i }));

    await waitFor(() => expect(mocks.getMyCode).toHaveBeenCalled());
    const qr = await screen.findByTestId('qr-code');
    expect(qr).toHaveAttribute('data-value', codigo.qrData);
    // El paso previo desaparece: ya no hay nada que "generar".
    expect(screen.queryByRole('button', { name: 'Generar QR' })).not.toBeInTheDocument();
  });

  it('cobrar un monto emite un cobro contra ese mismo codigo', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: /cobrar/i }));
    await screen.findByTestId('qr-code');

    await user.type(screen.getByPlaceholderText('0.00'), '5000');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));

    await waitFor(() => {
      expect(mocks.createCharge).toHaveBeenCalledWith(
        expect.objectContaining({ qrCodeId: 'code-1', amount: 5000 }),
      );
    });
    // El QR que se muestra pasa a ser el del cobro; el codigo sigue existiendo.
    await waitFor(() => {
      expect(screen.getByTestId('qr-code')).toHaveAttribute('data-value', cobro.qrData);
    });
  });

  it('cambiar el monto REEMPLAZA el cobro en vez de dejar dos vivos', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: /cobrar/i }));
    await screen.findByTestId('qr-code');

    const monto = screen.getByPlaceholderText('0.00');
    await user.type(monto, '5000');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));
    await waitFor(() => expect(mocks.createCharge).toHaveBeenCalledTimes(1));

    await user.type(screen.getByPlaceholderText('0.00'), '7500');
    await user.click(screen.getByRole('button', { name: 'Cambiar monto' }));

    await waitFor(() => {
      expect(mocks.createCharge).toHaveBeenLastCalledWith(
        expect.objectContaining({ amount: 7500, replaces: 'charge-1' }),
      );
    });
  });
});

describe('Pagar un QR — el nonce y el doble cobro', () => {
  async function escanearYPagar(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /escanear/i }));
    await user.click(await screen.findByRole('button', { name: 'simular-escaneo' }));
    await screen.findByText('Soda Tica');
    await user.type(screen.getByPlaceholderText('0.00'), '1000');
    await user.click(screen.getByRole('button', { name: /pagar/i }));
  }

  // LA PRUEBA DEL DOBLE COBRO. Cuando la respuesta NO llega, el pago pudo
  // haberse hecho: soltar el nonce convertiria el reintento en un cargo nuevo.
  it('un fallo de red CONSERVA el nonce, para que el reintento sea el mismo pago', async () => {
    mocks.scanAndPay.mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'sin red' } });
    const user = userEvent.setup();
    pintar();

    await escanearYPagar(user);
    await waitFor(() => expect(mocks.scanAndPay).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /pagar/i }));
    await waitFor(() => expect(mocks.scanAndPay).toHaveBeenCalledTimes(2));

    const primera = mocks.scanAndPay.mock.calls[0][0].idempotencyKey;
    const segunda = mocks.scanAndPay.mock.calls[1][0].idempotencyKey;
    expect(primera).toBeTruthy();
    expect(segunda).toBe(primera);
  });

  // Un RECHAZO del servidor si es definitivo: el reintento corregido es otro
  // pago y tiene que llevar otra llave.
  it('un rechazo del servidor suelta el nonce', async () => {
    mocks.scanAndPay.mockResolvedValueOnce({ success: false, error: { code: 'INSUFFICIENT_FUNDS', message: 'no alcanza' } });
    const user = userEvent.setup();
    pintar();

    await escanearYPagar(user);
    await waitFor(() => expect(mocks.scanAndPay).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: /pagar/i }));
    await waitFor(() => expect(mocks.scanAndPay).toHaveBeenCalledTimes(2));

    const primera = mocks.scanAndPay.mock.calls[0][0].idempotencyKey;
    const segunda = mocks.scanAndPay.mock.calls[1][0].idempotencyKey;
    expect(primera).toBeTruthy();
    expect(segunda).not.toBe(primera);
  });

  // Un cobro concreto NO lleva nonce: es de un solo uso y se reclama
  // atomicamente. Aceptar uno dejaria convertirlo en dos cargos.
  it('pagar un COBRO no manda nonce y si manda el cobro que se vio', async () => {
    mocks.resolveQr.mockResolvedValue({
      success: true,
      data: { kind: 'charge', merchantName: 'Soda Tica', currency: 'CRC', amount: 5000, chargeId: 'charge-1', qrCodeId: 'code-1' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: /escanear/i }));
    await user.click(await screen.findByRole('button', { name: 'simular-escaneo' }));
    await screen.findByText('Soda Tica');
    await user.click(screen.getByRole('button', { name: /pagar/i }));

    await waitFor(() => {
      expect(mocks.scanAndPay).toHaveBeenCalledWith(
        expect.objectContaining({ chargeId: 'charge-1', idempotencyKey: undefined }),
      );
    });
  });
});
