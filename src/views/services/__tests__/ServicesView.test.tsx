import { render, screen, waitFor } from '@testing-library/react';
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
});
