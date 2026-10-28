import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { HomeView } from '../HomeView';
import { registrarDesplazamientos } from '@/test/desplazamientos';

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
  totpVerify: vi.fn(),
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
    mfa: { totpVerify: mocks.totpVerify },
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
  mocks.totpVerify.mockResolvedValue({ success: true, data: { verified: true } });
});

// Quien cobra con QR desde Inicio es una persona, no un comercio: el texto del
// codigo fijo hablaba de imprimirlo y pegarlo en el mostrador, y el vencimiento
// de un cobro de un dia decia "Vence en 1440 min".
describe('Cobrar con QR — lo que lee una persona', () => {
  it('el codigo fijo se explica para una persona, no para un mostrador', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));
    await screen.findByTestId('qr-code');

    expect(screen.queryByText(/mostrador/i)).not.toBeInTheDocument();
    expect(screen.getByText('Este código es fijo: compártelo cuando quieras que te paguen.')).toBeInTheDocument();
  });

  it('el vencimiento de un cobro de un dia se lee en horas', async () => {
    mocks.createCharge.mockResolvedValue({
      success: true,
      data: { ...cobro, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000 + 5_000).toISOString() },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));
    await screen.findByTestId('qr-code');
    await user.type(screen.getByPlaceholderText('0.00'), '5000');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));

    expect(await screen.findByText('Vence en 24 h')).toBeInTheDocument();
    expect(screen.queryByText(/1440/)).not.toBeInTheDocument();
  });

  it('un cobro que vence pronto sigue leyendose en minutos', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));
    await screen.findByTestId('qr-code');
    await user.type(screen.getByPlaceholderText('0.00'), '5000');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));

    expect(await screen.findByText('Vence en 20 min')).toBeInTheDocument();
  });
});

describe('Cobrar con QR — el codigo se recicla', () => {
  it('la hoja abre con el codigo puesto, sin paso previo de generarlo', async () => {
    const user = userEvent.setup();
    pintar();

    // Nombre exacto: el banner de Inicio agrega su propio boton "Cobrar
    // ahora", y /cobrar/i ya no basta para distinguirlos.
    await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));

    await waitFor(() => expect(mocks.getMyCode).toHaveBeenCalled());
    const qr = await screen.findByTestId('qr-code');
    expect(qr).toHaveAttribute('data-value', codigo.qrData);
    // El paso previo desaparece: ya no hay nada que "generar".
    expect(screen.queryByRole('button', { name: 'Generar QR' })).not.toBeInTheDocument();
  });

  it('cobrar un monto emite un cobro contra ese mismo codigo', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));
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

    await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));
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

// El estado del cobro llegaba en /qr/resolve y nadie lo leia: la hoja pintaba
// un cobro ya pagado como vigente, con el boton Pagar habilitado, y el motivo
// aparecia solo despues de intentarlo.
describe('Pagar un QR — cobro que ya no se puede pagar', () => {
  async function escanearCobro(status: string) {
    mocks.resolveQr.mockResolvedValue({
      success: true,
      data: { kind: 'charge', merchantName: 'Super La Esquina', currency: 'CRC', amount: 100, chargeId: 'charge-9', qrCodeId: 'code-1', status },
    });
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: /escanear/i }));
    await user.click(await screen.findByRole('button', { name: 'simular-escaneo' }));
    await screen.findByText('Super La Esquina');
    return user;
  }

  it.each([
    ['paid', 'Ese cobro ya fue pagado.'],
    ['cancelled', 'Ese cobro fue cancelado.'],
    ['expired', 'Ese cobro venció.'],
  ])('un cobro %s se avisa de entrada y no ofrece Pagar', async (status, aviso) => {
    const user = await escanearCobro(status);

    expect(await screen.findByRole('status')).toHaveTextContent(aviso);
    expect(screen.getByText('Si todavía debes ese monto, pide a quien te cobra un código nuevo.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pagar' })).toBeNull();

    // La unica salida es cerrar, y cerrar no intenta ningun pago.
    // Por su texto: la X de la hoja tambien se llama "Cerrar".
    await user.click(screen.getByText('Cerrar', { selector: 'button' }));
    expect(mocks.scanAndPay).not.toHaveBeenCalled();
  });

  it('un cobro reemplazado pide volver a escanear, sin la pista de pedir otro codigo', async () => {
    await escanearCobro('superseded');

    expect(await screen.findByRole('status')).toHaveTextContent('El cobro cambió. Vuelve a escanear.');
    expect(screen.queryByText(/pide a quien te cobra/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pagar' })).toBeNull();
  });

  it('un cobro pendiente se paga como siempre', async () => {
    const user = await escanearCobro('pending');

    expect(screen.queryByRole('status')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Pagar' }));
    await waitFor(() => expect(mocks.scanAndPay).toHaveBeenCalledTimes(1));
  });
});

// Desde ₡100.000 el servidor responde 428 MFA_REQUIRED, como en SINPE. La hoja
// mostraba el motivo y el pago quedaba imposible de completar.
describe('Pagar un QR — segundo factor en montos altos', () => {
  const mfa = { success: false, error: { code: 'MFA_REQUIRED', message: 'MFA challenge required for amounts >= 100,000 CRC' } };

  async function pagarMontoAlto(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /escanear/i }));
    await user.click(await screen.findByRole('button', { name: 'simular-escaneo' }));
    await screen.findByText('Soda Tica');
    await user.type(screen.getByPlaceholderText('0.00'), '150000');
    await user.click(screen.getByRole('button', { name: 'Pagar' }));
  }

  it('pide el codigo y, al verificarlo, reintenta EL MISMO pago', async () => {
    mocks.scanAndPay.mockResolvedValueOnce(mfa);
    const user = userEvent.setup();
    pintar();

    await pagarMontoAlto(user);
    expect(await screen.findByText('Verificación requerida')).toBeInTheDocument();
    // El texto del servidor, en ingles, no llega a la pantalla.
    expect(screen.queryByText(/MFA challenge required/)).toBeNull();

    await user.type(screen.getByLabelText(/código/i), '123456');
    await user.click(screen.getByRole('button', { name: 'Verificar y pagar' }));

    await waitFor(() => expect(mocks.scanAndPay).toHaveBeenCalledTimes(2));
    expect(mocks.totpVerify).toHaveBeenCalledWith('123456', 'high_value_tx');
    const primera = mocks.scanAndPay.mock.calls[0][0];
    const segunda = mocks.scanAndPay.mock.calls[1][0];
    expect(primera.idempotencyKey).toBeTruthy();
    expect(segunda.idempotencyKey).toBe(primera.idempotencyKey);
    expect(segunda.amount).toBe(150000);
    expect((await screen.findAllByText('Pago realizado')).length).toBeGreaterThan(0);
  });

  it('cerrar la verificacion no paga, dice por que y suelta el nonce', async () => {
    mocks.scanAndPay.mockResolvedValueOnce(mfa).mockResolvedValueOnce(mfa);
    const user = userEvent.setup();
    pintar();

    await pagarMontoAlto(user);
    await screen.findByText('Verificación requerida');
    await user.keyboard('{Escape}');

    expect(
      await screen.findByText('Este pago necesita tu código de verificación en dos pasos. Toca Pagar para ingresarlo.'),
    ).toBeInTheDocument();
    expect(mocks.scanAndPay).toHaveBeenCalledTimes(1);

    // Volver a tocar Pagar es un intento nuevo, con su propia llave.
    await user.click(screen.getByRole('button', { name: 'Pagar' }));
    await waitFor(() => expect(mocks.scanAndPay).toHaveBeenCalledTimes(2));
    expect(mocks.scanAndPay.mock.calls[1][0].idempotencyKey).not.toBe(mocks.scanAndPay.mock.calls[0][0].idempotencyKey);
  });
});

// Sin saldo, por encima de un tope o a un comercio no habilitado, el pago se
// rechazaba con el texto del servidor tal cual ("qr payment transfer:
// insufficient balance"), en ingles. Cada rechazo se dice ahora en el idioma
// de la app, y uno que la pantalla no conoce cae al generico, nunca al texto
// del servidor.
describe('Pagar un QR — cada rechazo en el idioma de la app', () => {
  async function pagar(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /escanear/i }));
    await user.click(await screen.findByRole('button', { name: 'simular-escaneo' }));
    await screen.findByText('Soda Tica');
    await user.type(screen.getByPlaceholderText('0.00'), '1000');
    await user.click(screen.getByRole('button', { name: 'Pagar' }));
  }

  it.each([
    ['INSUFFICIENT_BALANCE', 'insufficient balance', 'Fondos insuficientes'],
    ['DAILY_LIMIT_EXCEEDED', 'daily spending limit exceeded', 'Este pago supera tu límite diario.'],
    ['MONTHLY_LIMIT_EXCEEDED', 'monthly spending limit exceeded', 'Este pago supera tu límite mensual.'],
    ['MERCHANT_UNAVAILABLE', 'merchant is not available', 'Ese comercio no puede recibir pagos por ahora.'],
    ['MERCHANT_NOT_FOUND', 'merchant not found', 'Ese código no existe o ya no es válido.'],
    // El motor de riesgo, como cualquier codigo que la pantalla no conoce.
    ['TRANSFER_BLOCKED', 'this transaction was blocked by the risk engine', 'No se pudo completar el pago'],
    ['ALGO_NUEVO', 'qr payment transfer: something new', 'No se pudo completar el pago'],
  ])('%s se dice en el idioma de la app, sin el texto del servidor', async (code, message, texto) => {
    mocks.scanAndPay.mockResolvedValueOnce({ success: false, error: { code, message } });
    const user = userEvent.setup();
    pintar();

    await pagar(user);

    expect(await screen.findByText(texto)).toBeInTheDocument();
    expect(screen.queryByText(message)).toBeNull();
  });

  // El 500: el servidor fallo y el pago pudo haber salido. Como sin red, la
  // llave se CONSERVA (el reintento es el mismo pago) y se dice que no se pudo
  // confirmar. Antes llegaba como un rechazo: la llave se soltaba y el
  // reintento era un cobro nuevo.
  it('PAYMENT_FAILED conserva el nonce y dice que el pago quedo sin confirmar', async () => {
    mocks.scanAndPay.mockResolvedValueOnce({
      success: false,
      error: { code: 'PAYMENT_FAILED', message: 'Hubo un problema en el servidor.' },
    });
    const user = userEvent.setup();
    pintar();

    await pagar(user);
    expect(await screen.findByText(/^No pudimos confirmar el pago/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pagar' }));
    await waitFor(() => expect(mocks.scanAndPay).toHaveBeenCalledTimes(2));
    const primera = mocks.scanAndPay.mock.calls[0][0].idempotencyKey;
    expect(primera).toBeTruthy();
    expect(mocks.scanAndPay.mock.calls[1][0].idempotencyKey).toBe(primera);
  });

  // PAGO_NO_REGISTRADO dice que el libro ya tiene este pago: el dinero se
  // movio en el intento anterior. Soltar la llave convertia el siguiente toque
  // en Pagar en un pago nuevo; conservada, el reintento es el mismo pago.
  it('PAGO_NO_REGISTRADO conserva el nonce y manda a revisar las transacciones', async () => {
    mocks.scanAndPay.mockResolvedValueOnce({
      success: false,
      error: { code: 'PAGO_NO_REGISTRADO', message: 'payment is in the ledger but has no sale' },
    });
    const user = userEvent.setup();
    pintar();

    await pagar(user);
    expect(await screen.findByText(/^El pago no quedó registrado/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pagar' }));
    await waitFor(() => expect(mocks.scanAndPay).toHaveBeenCalledTimes(2));
    const primera = mocks.scanAndPay.mock.calls[0][0].idempotencyKey;
    expect(primera).toBeTruthy();
    expect(mocks.scanAndPay.mock.calls[1][0].idempotencyKey).toBe(primera);
  });

  it('sin red tambien dice que el pago quedo sin confirmar', async () => {
    mocks.scanAndPay.mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'sin red' } });
    const user = userEvent.setup();
    pintar();

    await pagar(user);
    expect(await screen.findByText(/^No pudimos confirmar el pago/)).toBeInTheDocument();
  });
});

// La hoja de pagar y la de cobrar pueden ser mas altas que un telefono chico:
// el error aparecia bajo el borde, sin anunciarse, y la persona tocaba de nuevo
// a ciegas. Como en el envio SINPE, el error se anuncia y se lleva a la vista.
describe('Pagar y cobrar con QR — el error se anuncia y queda a la vista', () => {
  const desplazados = registrarDesplazamientos();

  it('el rechazo del pago', async () => {
    mocks.scanAndPay.mockResolvedValueOnce({
      success: false,
      error: { code: 'INSUFFICIENT_BALANCE', message: 'insufficient balance' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: /escanear/i }));
    await user.click(await screen.findByRole('button', { name: 'simular-escaneo' }));
    await screen.findByText('Soda Tica');
    await user.type(screen.getByPlaceholderText('0.00'), '1000');
    await user.click(screen.getByRole('button', { name: 'Pagar' }));

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Fondos insuficientes');
    expect(desplazados).toContain(aviso);
  });

  it('el error al cobrar un monto', async () => {
    mocks.createCharge.mockResolvedValueOnce({
      success: false,
      error: { code: 'NETWORK_ERROR', message: 'Sin conexión' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Cobrar con QR' }));
    await screen.findByTestId('qr-code');
    await user.type(screen.getByPlaceholderText('0.00'), '5000');
    await user.click(screen.getByRole('button', { name: 'Cobrar este monto' }));

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Sin conexión');
    expect(desplazados).toContain(aviso);
  });
});

// /qr/resolve respondia QR_INVALIDO a cualquier error de la base: una caida
// pasajera se le decia a la persona como un codigo malo ("Ese codigo no existe
// o ya no es valido"), que no tiene sentido volver a intentar. Ahora el
// servidor separa las dos cosas (500 RESOLVE_FAILED) y la hoja dice que no se
// pudo verificar el codigo, con un boton para volver a intentarlo. Antes, sin
// red o con un 500, la hoja se quedaba en "—" sin decir nada.
describe('Pagar un QR — no se pudo verificar el codigo', () => {
  async function escanear() {
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: /escanear/i }));
    await user.click(await screen.findByRole('button', { name: 'simular-escaneo' }));
    return user;
  }

  it.each([
    ['RESOLVE_FAILED', 'Hubo un problema en el servidor.'],
    ['SERVER_ERROR', 'Hubo un problema en el servidor.'],
    ['NETWORK_ERROR', 'Sin conexión.'],
    ['TIMEOUT', 'La solicitud tardó demasiado.'],
  ])('%s dice que no se pudo verificar y reintentar vuelve a preguntar', async (code, message) => {
    mocks.resolveQr.mockResolvedValueOnce({ success: false, error: { code, message } });
    const user = await escanear();

    expect(await screen.findByText('No pudimos verificar el código. Intenta de nuevo.')).toBeInTheDocument();
    expect(screen.queryByText('Ese código no existe o ya no es válido.')).toBeNull();
    expect(screen.queryByText(message)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Soda Tica')).toBeInTheDocument();
    expect(mocks.resolveQr).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('No pudimos verificar el código. Intenta de nuevo.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });

  it('una excepcion al preguntar tambien lo dice', async () => {
    mocks.resolveQr.mockRejectedValueOnce(new Error('boom'));
    await escanear();

    expect(await screen.findByText('No pudimos verificar el código. Intenta de nuevo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  // La otra mitad: un codigo que de verdad no existe se sigue diciendo asi, y
  // no ofrece reintentar, porque reintentar no lo arregla.
  it('QR_INVALIDO sigue diciendo que el codigo no existe, sin ofrecer reintentar', async () => {
    mocks.resolveQr.mockResolvedValueOnce({
      success: false,
      error: { code: 'QR_INVALIDO', message: 'ese codigo no existe o ya no es valido' },
    });
    await escanear();

    expect(await screen.findByText('Ese código no existe o ya no es válido.')).toBeInTheDocument();
    expect(screen.queryByText('No pudimos verificar el código. Intenta de nuevo.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });
});
