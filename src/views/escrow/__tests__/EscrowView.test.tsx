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
  mockApi.mfa.totpVerify.mockReset();
  mockDataSync.refreshAccounts.mockClear();
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
