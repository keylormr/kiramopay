import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessHomeView } from '../BusinessHomeView';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';

// El rotulo del mostrador. Pedirlo para un comercio que dejo de estar aprobado
// respondia 400 PAYMENT_FAILED "merchant is pending verification", y la hoja lo
// pintaba tal cual, en ingles. Cada rechazo con codigo se dice en el idioma de
// la app, y el resto cae al aviso de la hoja.
const mocks = vi.hoisted(() => ({ getMerchantCode: vi.fn() }));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    qrPayments: {
      getMerchantBalance: vi.fn().mockResolvedValue({ success: true, data: 0 }),
      getCatalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLocations: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getMerchantCode: mocks.getMerchantCode,
    },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

const COMERCIO = {
  id: 'm1', name: 'Soda', description: '', category: 'food', qrCode: 'MRC-1',
  active: true, cedula: '3101', cedulaType: 'juridica', legalName: 'Soda SA',
  verificationStatus: 'verified', commissionBps: 50, role: 'owner',
} as unknown as QRMerchant;

function pintar() {
  return render(
    <LanguageProvider>
      <BusinessHomeView merchant={COMERCIO} payments={[]} onReload={vi.fn()} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.getMerchantCode.mockReset();
});

describe('BusinessHomeView — el rotulo del mostrador', () => {
  it('un comercio que no puede cobrar lo dice en el idioma de la app', async () => {
    mocks.getMerchantCode.mockResolvedValue({
      success: false,
      error: { code: 'MERCHANT_UNAVAILABLE', message: 'merchant is not available' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Generar QR de cobro' }));

    expect(await screen.findByText('Ese comercio no puede recibir pagos por ahora.')).toBeInTheDocument();
    expect(screen.queryByText('merchant is not available')).not.toBeInTheDocument();
  });

  it('un rechazo que la pantalla no conoce cae al aviso de la hoja', async () => {
    mocks.getMerchantCode.mockResolvedValue({
      success: false,
      error: { code: 'LOCATION_NOT_FOUND', message: 'location not found' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(screen.getByRole('button', { name: 'Generar QR de cobro' }));

    expect(await screen.findByText('No se pudo generar el QR')).toBeInTheDocument();
    expect(screen.queryByText('location not found')).not.toBeInTheDocument();
  });
});
