import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { PayoutView } from '../PayoutView';

const mockApi = vi.hoisted(() => ({
  payout: {
    list: vi.fn(),
    rails: vi.fn(),
    create: vi.fn(),
    refresh: vi.fn(),
    get: vi.fn(),
  },
  mfa: { totpVerify: vi.fn() },
}));

// Runtime imports the views need from '@/api'; types are erased.
vi.mock('@/api', () => ({
  getApiLayer: () => mockApi,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

function setup() {
  return render(
    <LanguageProvider>
      <PayoutView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

const donePayout = {
  id: 'p1',
  userId: 'u1',
  rail: 'mock',
  amountMinor: 500000,
  currency: 'CRC',
  status: 'processing',
  destination: { type: 'bank_account', account: '123456', name: 'Acme SA' },
  createdAt: '',
  updatedAt: '',
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mockApi.payout.list.mockResolvedValue({ success: true, data: [] });
  mockApi.payout.rails.mockResolvedValue({ success: true, data: ['mock'] });
  mockApi.payout.create.mockReset();
  mockApi.mfa.totpVerify.mockReset();
});

describe('PayoutView', () => {
  it('renders the subtitle and empty state', async () => {
    setup();
    expect(await screen.findByText(/Env[ií]a fondos a cuentas externas/i)).toBeInTheDocument();
    expect(await screen.findByText('Sin pagos salientes')).toBeInTheDocument();
  });

  it('creates a payout, mapping the form to minor units + an idempotency key', async () => {
    mockApi.payout.create.mockResolvedValue({ success: true, data: donePayout });
    const user = userEvent.setup();
    setup();
    await screen.findByText('Sin pagos salientes'); // rails loaded → "+" enabled

    await user.click(screen.getByLabelText('Nuevo pago'));
    await user.type(screen.getByPlaceholderText('Nombre del beneficiario'), 'Acme SA');
    await user.type(screen.getByPlaceholderText('CR00000000000000000000'), '123456');
    await user.type(screen.getByPlaceholderText('0.00'), '5000');
    await user.click(screen.getByText('Enviar pago'));

    await waitFor(() => expect(mockApi.payout.create).toHaveBeenCalledTimes(1));
    const arg = mockApi.payout.create.mock.calls[0][0];
    expect(arg.rail).toBe('mock');
    expect(arg.amountMinor).toBe(500000);
    expect(arg.destination).toMatchObject({ account: '123456', name: 'Acme SA' });
    expect(arg.idempotencyKey).toBeTruthy();
  });

  it('prompts for MFA on MFA_REQUIRED and retries the create after verify', async () => {
    mockApi.payout.create
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } })
      .mockResolvedValueOnce({ success: true, data: donePayout });
    mockApi.mfa.totpVerify.mockResolvedValue({ success: true, data: { verified: true } });
    const user = userEvent.setup();
    setup();
    await screen.findByText('Sin pagos salientes');

    await user.click(screen.getByLabelText('Nuevo pago'));
    await user.type(screen.getByPlaceholderText('Nombre del beneficiario'), 'A');
    await user.type(screen.getByPlaceholderText('CR00000000000000000000'), '1');
    await user.type(screen.getByPlaceholderText('0.00'), '200000');
    await user.click(screen.getByText('Enviar pago'));

    // The MFA challenge appears instead of an error.
    expect(await screen.findByText('Verificación requerida')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByText('Verificar y activar'));

    await waitFor(() => {
      expect(mockApi.mfa.totpVerify).toHaveBeenCalledWith('123456', 'high_value_tx');
      expect(mockApi.payout.create).toHaveBeenCalledTimes(2);
    });
  });
});
