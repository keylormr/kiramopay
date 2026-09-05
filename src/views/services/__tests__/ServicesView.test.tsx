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
      accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
      savedServices: [],
      billHistory: [],
      rechargeHistory: [],
    },
    dispatch: mocks.dispatch,
  }),
}));

vi.mock('@/services/dataSync', () => ({ refreshAccounts: vi.fn(() => Promise.resolve()) }));

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

  // Lo más importante: un rechazo NO puede verse como un pago hecho.
  it('no muestra éxito cuando el servidor rechaza el pago', async () => {
    mocks.api.services.payBill.mockResolvedValue({
      success: false,
      error: { code: 'PAYMENT_FAILED', message: 'saldo insuficiente' },
    });
    const user = userEvent.setup();
    setup();

    await completarPago(user);

    expect(await screen.findByText('saldo insuficiente')).toBeInTheDocument();
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
    await user.click(screen.getByText('Verificar y activar'));

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
});
