import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ServicesView } from '../ServicesView';

const mocks = vi.hoisted(() => ({
  api: {
    services: { payBill: vi.fn(), recharge: vi.fn() },
    mfa: { totpVerify: vi.fn() },
  },
  dispatch: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      user: { id: 'u1' },
      accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
      savedServices: [],
      billHistory: [],
      rechargeHistory: [],
    },
    dispatch: mocks.dispatch,
  }),
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn(() => Promise.resolve()),
  refreshTransactions: vi.fn(() => Promise.resolve()),
}));

function setup() {
  return render(
    <LanguageProvider>
      <ServicesView />
    </LanguageProvider>,
  );
}

/** Abre el formulario de pago de un proveedor y lo completa. */
async function completarPago(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('ICE Electricidad'));
  await user.type(await screen.findByPlaceholderText('Ej: 1234567'), '123456');
  await user.type(screen.getByPlaceholderText('0'), '250000');
  await user.click(screen.getByRole('button', { name: /^Pagar/ }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.api.services.payBill.mockReset();
  mocks.api.services.recharge.mockReset();
  mocks.api.mfa.totpVerify.mockReset();
  mocks.dispatch.mockReset();
});

describe('ServicesView — pago de servicios', () => {
  // Antes este flujo era un setTimeout: fingia el pago sin llamar al servidor y
  // SIEMPRE mostraba "¡Pago exitoso!". Ahora tiene que llamar de verdad.
  it('paga a través de la API y solo entonces muestra el éxito', async () => {
    mocks.api.services.payBill.mockResolvedValue({
      success: true,
      data: { id: 'b1', providerId: 'ice', amount: 250000, status: 'paid' },
    });
    const user = userEvent.setup();
    setup();

    await completarPago(user);

    await waitFor(() => {
      expect(mocks.api.services.payBill).toHaveBeenCalledWith(
        expect.objectContaining({ providerId: 'ice', clientId: '123456', amount: 250000 }),
      );
    });
    expect(await screen.findByText('¡Pago exitoso!')).toBeInTheDocument();
  });

  // Lo más importante: un rechazo NO puede verse como un pago hecho. Y se
  // dice en el idioma de la app y con su motivo: la pantalla mostraba el texto
  // del servidor tal cual ("process payment: insufficient balance"), y después
  // un "no se pudo completar la acción" sin decir por qué.
  it('no muestra éxito cuando el servidor rechaza el pago', async () => {
    mocks.api.services.payBill.mockResolvedValue({
      success: false,
      error: { code: 'INSUFFICIENT_BALANCE', message: 'insufficient balance' },
    });
    const user = userEvent.setup();
    setup();

    await completarPago(user);

    expect(await screen.findByText('Fondos insuficientes')).toBeInTheDocument();
    expect(screen.queryByText('insufficient balance')).not.toBeInTheDocument();
    expect(screen.queryByText('¡Pago exitoso!')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  // El gate de MFA del backend saltaba pero la app nunca ofrecía el código: la
  // operación moría con un error crudo en inglés.
  it('ofrece el código de verificación y reintenta el pago', async () => {
    mocks.api.services.payBill
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } })
      .mockResolvedValueOnce({ success: true, data: { id: 'b1', amount: 250000, status: 'paid' } });
    mocks.api.mfa.totpVerify.mockResolvedValue({ success: true, data: { verified: true } });
    const user = userEvent.setup();
    setup();

    await completarPago(user);

    // Aparece el desafío en vez del error en inglés.
    expect(await screen.findByText('Verificación requerida')).toBeInTheDocument();
    expect(screen.queryByText('mfa needed')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByText('Verificar y pagar'));

    await waitFor(() => {
      expect(mocks.api.mfa.totpVerify).toHaveBeenCalledWith('123456', 'high_value_tx');
      expect(mocks.api.services.payBill).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('¡Pago exitoso!')).toBeInTheDocument();
  });

  // El servidor niega el cobro cuando no hay convenio con la empresa: la
  // pantalla tiene que decir por que, y que el saldo no se movio. Antes solo
  // repetia el texto crudo del servidor.
  it('explica la negativa cuando no hay convenio con la empresa', async () => {
    mocks.api.services.payBill.mockResolvedValue({
      success: false,
      error: { code: 'SIN_CONVENIO', message: 'el pago no se puede entregar todavia' },
    });
    const user = userEvent.setup();
    setup();

    await completarPago(user);

    expect(
      await screen.findByText(/Todavía no tenemos convenio con esta empresa/),
    ).toBeInTheDocument();
    expect(screen.getByText(/tu saldo sigue igual/)).toBeInTheDocument();
    expect(screen.queryByText('el pago no se puede entregar todavia')).not.toBeInTheDocument();
    expect(screen.queryByText('¡Pago exitoso!')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

// n=69 de la QA 2026-09-13: con monto "0" el boton de pagar quedaba
// habilitado (azul) y el clic no hacia absolutamente nada, sin avisar.
describe('ServicesView — pago de servicios: monto invalido (hallazgo n=69)', () => {
  it('con monto "0" el boton de pagar queda deshabilitado y no llama al servidor', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByText('ICE Electricidad'));
    await user.type(await screen.findByPlaceholderText('Ej: 1234567'), '123456');
    await user.type(screen.getByPlaceholderText('0'), '0');

    expect(screen.getByRole('button', { name: /^Pagar/ })).toBeDisabled();
    expect(mocks.api.services.payBill).not.toHaveBeenCalled();
  });
  // No hay caso de monto negativo por UI aqui: CampoMonto (utils/campoMonto.ts)
  // ya no preserva el signo "-" al teclear, asi que este input nunca llega a
  // valer un numero negativo desde el teclado.
});

describe('ServicesView — recarga', () => {
  /** Abre la recarga de Kolbi con numero y monto elegidos. */
  async function completarRecarga(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('tab', { name: 'Recarga' }));
    await user.click(screen.getByText('Kolbi'));
    await user.type(await screen.findByPlaceholderText('8888-0000'), '88880000');
    const montos = screen.getByText('Selecciona monto').parentElement as HTMLElement;
    await user.click(within(montos).getAllByRole('button')[0]);
    await user.click(screen.getByRole('button', { name: /^Recarga ₡/ }));
  }

  // n=68 de la QA 2026-09-13: formatCurrency(1000).replace(',00', '') borraba
  // la coma de miles en vez del ".00" final y mostraba "₡10.00" en vez de
  // "₡1,000" — cien veces menos que el monto real que si se cobraba.
  it('los botones de monto muestran la cifra real, no cien veces menos (hallazgo n=68)', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('tab', { name: 'Recarga' }));
    await user.click(screen.getByText('Kolbi'));
    const montos = (await screen.findByText('Selecciona monto')).parentElement as HTMLElement;
    const botones = within(montos).getAllByRole('button');

    // Kolbi: [1000, 2000, 3000, 5000, 10000, 20000] colones (ver PHONE_OPERATORS).
    expect(botones.map((b) => b.textContent)).toEqual([
      '₡1,000', '₡2,000', '₡3,000', '₡5,000', '₡10,000', '₡20,000',
    ]);
    expect(screen.queryByText('₡10.00')).not.toBeInTheDocument();
  });

  // Misma negativa, otro canal: sin convenio con el operador la recarga no
  // llega al telefono, y eso hay que decirlo.
  it('explica la negativa cuando no hay convenio con el operador', async () => {
    mocks.api.services.recharge.mockResolvedValue({
      success: false,
      error: { code: 'SIN_CONVENIO', message: 'el pago no se puede entregar todavia' },
    });
    const user = userEvent.setup();
    setup();

    await completarRecarga(user);

    expect(
      await screen.findByText(/Todavía no tenemos convenio con este operador/),
    ).toBeInTheDocument();
    expect(screen.queryByText('el pago no se puede entregar todavia')).not.toBeInTheDocument();
    expect(screen.queryByText('¡Recarga exitosa!')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  // Como el pago: la recarga rechazada mostraba el texto del servidor tal cual.
  it('una recarga rechazada se dice en el idioma de la app', async () => {
    mocks.api.services.recharge.mockResolvedValue({
      success: false,
      error: { code: 'INSUFFICIENT_BALANCE', message: 'insufficient balance' },
    });
    const user = userEvent.setup();
    setup();

    await completarRecarga(user);

    expect(await screen.findByText('Fondos insuficientes')).toBeInTheDocument();
    expect(screen.queryByText('insufficient balance')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['DAILY_LIMIT_EXCEEDED', 'daily transaction limit exceeded', 'Este pago supera tu límite diario.'],
    ['MONTHLY_LIMIT_EXCEEDED', 'monthly transaction limit exceeded', 'Este pago supera tu límite mensual.'],
  ])('la recarga rechazada con %s dice cuál tope', async (code, message, texto) => {
    mocks.api.services.recharge.mockResolvedValue({ success: false, error: { code, message } });
    const user = userEvent.setup();
    setup();

    await completarRecarga(user);

    expect(await screen.findByText(texto)).toBeInTheDocument();
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });

  // Sin respuesta, la recarga pudo haber salido: la pantalla lo dice así, y
  // tocar otra vez con los mismos datos lleva la misma llave, de modo que el
  // servidor contesta con aquella recarga en vez de cobrar otra.
  it('sin respuesta lo dice, y recargar otra vez lleva la misma llave', async () => {
    mocks.api.services.recharge
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' } })
      .mockResolvedValueOnce({
        success: true,
        data: { id: 'r1', operatorId: 'kolbi', phone: '88880000', amount: 1000, date: '', status: 'completed' },
      });
    const user = userEvent.setup();
    setup();

    await completarRecarga(user);
    expect(await screen.findByText(/^No pudimos confirmar la recarga/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Recarga ₡/ }));
    await waitFor(() => expect(mocks.api.services.recharge).toHaveBeenCalledTimes(2));

    const [primero, segundo] = mocks.api.services.recharge.mock.calls.map((c) => c[0]);
    expect(primero.idempotencyKey).toMatch(/\S/);
    expect(segundo.idempotencyKey).toBe(primero.idempotencyKey);
  });

  it('una recarga que ya estaba hecha lo dice y no se anota otra vez', async () => {
    mocks.api.services.recharge.mockResolvedValue({
      success: true,
      data: {
        id: 'r1', operatorId: 'kolbi', phone: '88880000', amount: 1000, date: '', status: 'completed', repetida: true,
      },
    });
    const user = userEvent.setup();
    setup();

    await completarRecarga(user);

    expect(await screen.findByText('Esa recarga ya se había hecho')).toBeInTheDocument();
    expect(screen.queryByText('¡Recarga exitosa!')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

// Pagar un recibo no llevaba llave de idempotencia: con la red cortada después
// del cobro, la pantalla decía "revisa tu conexión" con el botón activo, y
// tocarlo otra vez cobraba de nuevo.
describe('ServicesView — la llave del pago de un recibo', () => {
  const pedidos = () => mocks.api.services.payBill.mock.calls.map((c) => c[0]);
  const pagado = { success: true, data: { id: 'b1', providerId: 'ice', amount: 250000, status: 'paid' } };

  it('sin respuesta lo dice, y pagar otra vez lleva la misma llave', async () => {
    mocks.api.services.payBill
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' } })
      .mockResolvedValueOnce(pagado);
    const user = userEvent.setup();
    setup();

    await completarPago(user);
    expect(await screen.findByText(/^No pudimos confirmar el pago/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Pagar/ }));
    expect(await screen.findByText('¡Pago exitoso!')).toBeInTheDocument();

    const [primero, segundo] = pedidos();
    expect(primero.idempotencyKey).toMatch(/\S/);
    expect(segundo.idempotencyKey).toBe(primero.idempotencyKey);
  });

  // El 500: el servidor falló y el pago pudo haber salido. Es lo mismo que la
  // red cortada, no un rechazo.
  it('el fallo del servidor es un pago sin confirmar, no un rechazo', async () => {
    mocks.api.services.payBill.mockResolvedValue({
      success: false,
      error: { code: 'PAYMENT_FAILED', message: 'internal server error' },
    });
    const user = userEvent.setup();
    setup();

    await completarPago(user);

    expect(await screen.findByText(/^No pudimos confirmar el pago/)).toBeInTheDocument();
    expect(screen.queryByText('internal server error')).not.toBeInTheDocument();
  });

  it.each([
    ['DAILY_LIMIT_EXCEEDED', 'daily transaction limit exceeded', 'Este pago supera tu límite diario.'],
    ['MONTHLY_LIMIT_EXCEEDED', 'monthly transaction limit exceeded', 'Este pago supera tu límite mensual.'],
    [
      'LLAVE_REUTILIZADA',
      'idempotency key reused for a different movement',
      'Esa operación ya se hizo con otros datos. Revisa tus transacciones antes de intentar de nuevo.',
    ],
  ])('el rechazo %s dice su motivo', async (code, message, texto) => {
    mocks.api.services.payBill.mockResolvedValue({ success: false, error: { code, message } });
    const user = userEvent.setup();
    setup();

    await completarPago(user);

    expect(await screen.findByText(texto)).toBeInTheDocument();
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });

  it('el reintento tras el segundo factor lleva la misma llave', async () => {
    mocks.api.services.payBill
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } })
      .mockResolvedValueOnce(pagado);
    mocks.api.mfa.totpVerify.mockResolvedValue({ success: true, data: { verified: true } });
    const user = userEvent.setup();
    setup();

    await completarPago(user);
    await screen.findByText('Verificación requerida');
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByText('Verificar y pagar'));
    expect(await screen.findByText('¡Pago exitoso!')).toBeInTheDocument();

    const [primero, segundo] = pedidos();
    expect(primero.idempotencyKey).toMatch(/\S/);
    expect(segundo.idempotencyKey).toBe(primero.idempotencyKey);
  });

  // Cancelar el segundo factor deja el pago sin hacer (el servidor lo pide
  // antes de cobrar), y el siguiente intento es otro pago.
  it('cancelar el segundo factor suelta la llave', async () => {
    mocks.api.services.payBill.mockResolvedValue({
      success: false,
      error: { code: 'MFA_REQUIRED', message: 'mfa needed' },
    });
    const user = userEvent.setup();
    setup();

    await completarPago(user);
    const reto = (await screen.findByText('Verificación requerida')).closest('[role="dialog"]') as HTMLElement;
    await user.click(within(reto).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByText('Verificación requerida')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /^Pagar/ }));
    await waitFor(() => expect(mocks.api.services.payBill).toHaveBeenCalledTimes(2));

    const [primero, segundo] = pedidos();
    expect(segundo.idempotencyKey).not.toBe(primero.idempotencyKey);
  });

  // Un pago hecho suelta la llave: pagar otra vez lo mismo, a propósito, es
  // otro pago.
  it('después de un pago hecho, el siguiente igual lleva otra llave', async () => {
    mocks.api.services.payBill.mockResolvedValue(pagado);
    const user = userEvent.setup();
    setup();

    await completarPago(user);
    await screen.findByText('¡Pago exitoso!');
    await user.click(screen.getByRole('button', { name: 'Listo' }));
    await completarPago(user);
    await waitFor(() => expect(mocks.api.services.payBill).toHaveBeenCalledTimes(2));

    const [primero, segundo] = pedidos();
    expect(segundo.idempotencyKey).toMatch(/\S/);
    expect(segundo.idempotencyKey).not.toBe(primero.idempotencyKey);
  });

  // La repetición: el servidor contestó con un pago que YA estaba hecho bajo
  // esa llave. "¡Pago exitoso!" y otra fila en el historial harían creer que
  // se pagó dos veces.
  it('un pago que ya estaba hecho lo dice y no se anota otra vez', async () => {
    mocks.api.services.payBill.mockResolvedValue({
      success: true,
      data: { ...pagado.data, repetida: true },
    });
    const user = userEvent.setup();
    setup();

    await completarPago(user);

    expect(await screen.findByText('Ese pago ya se había hecho')).toBeInTheDocument();
    expect(screen.getByText(/No se cobró otra vez/)).toBeInTheDocument();
    expect(screen.queryByText('¡Pago exitoso!')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

// El ejemplo del numero de cliente decia "Ej: 1234567" en cualquier idioma.
describe('ServicesView — el formulario de pago en otro idioma', () => {
  it('en ingles, el ejemplo del numero de cliente sale en ingles', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByText('ICE Electricidad'));

    expect(await screen.findByPlaceholderText('e.g. 1234567')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Ej: 1234567')).not.toBeInTheDocument();
  });
});
