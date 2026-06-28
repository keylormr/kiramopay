import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { MerchantView } from '../MerchantView';

const mockApi = vi.hoisted(() => ({
  qrPayments: {
    getMerchants: vi.fn(),
    registerMerchant: vi.fn(),
    createQRCode: vi.fn(),
    getPaymentHistory: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

// MerchantView reads the base account currency/symbol from the app state.
vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({ state: { accounts: [{ ccy: 'CRC', symbol: '₡' }], baseCurrency: 'CRC' } }),
}));

const verifiedMerchant = {
  id: 'm1', name: 'Soda Tica', description: 'Comidas', category: 'restaurant',
  qrCode: 'MRC-ABC', active: true, cedula: '3-101', cedulaType: 'juridica',
  legalName: 'Soda Tica SA', verificationStatus: 'verified', commissionBps: 50,
};

function setup() {
  return render(
    <LanguageProvider>
      <MerchantView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mockApi.qrPayments.getMerchants.mockReset();
  mockApi.qrPayments.registerMerchant.mockReset();
  mockApi.qrPayments.createQRCode.mockReset();
  mockApi.qrPayments.getPaymentHistory.mockReset();
  mockApi.qrPayments.getPaymentHistory.mockResolvedValue({ success: true, data: [] });
});

describe('MerchantView', () => {
  it('renders the empty state when there are no merchants', async () => {
    mockApi.qrPayments.getMerchants.mockResolvedValue({ success: true, data: [] });
    setup();
    expect(await screen.findByText('Aún no tienes comercios')).toBeInTheDocument();
  });

  it('renders a merchant card with its status and commission', async () => {
    mockApi.qrPayments.getMerchants.mockResolvedValue({ success: true, data: [verifiedMerchant] });
    setup();
    expect(await screen.findByText('Soda Tica')).toBeInTheDocument();
    expect(screen.getByText('Verificado')).toBeInTheDocument();
    expect(screen.getByText(/0\.50%/)).toBeInTheDocument();
  });

  it('registers a merchant with the KYC fields', async () => {
    mockApi.qrPayments.getMerchants.mockResolvedValue({ success: true, data: [] });
    mockApi.qrPayments.registerMerchant.mockResolvedValue({ success: true, data: verifiedMerchant });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Registrar comercio' }));

    const textboxes = screen.getAllByRole('textbox');
    await user.type(textboxes[0], 'Soda Tica');      // name
    await user.type(textboxes[1], 'Comidas');        // description
    await user.type(textboxes[2], '3-101-123');      // cedula
    await user.type(textboxes[3], 'Soda Tica SA');   // legal name
    await user.click(screen.getByRole('checkbox'));

    await user.click(screen.getByRole('button', { name: 'Registrar' }));

    await waitFor(() => expect(mockApi.qrPayments.registerMerchant).toHaveBeenCalled());
    const arg = mockApi.qrPayments.registerMerchant.mock.calls[0][0];
    expect(arg).toMatchObject({ name: 'Soda Tica', cedula: '3-101-123', legalName: 'Soda Tica SA' });
  });
});
