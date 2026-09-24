import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessHomeView } from '../BusinessHomeView';
import { fechaCorta } from '@/utils/fechaPlazo';
import type { QRMerchant, QRPayment } from '@/api/repositories/qrpayment.repository';

// La fecha de cada cobro reciente salia con toLocaleDateString() del telefono,
// no en el idioma de la app: con el telefono en ingles y la app en espanol,
// "9/4/2026" (mes/dia) para quien lee 9 de abril.

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    qrPayments: {
      getMerchantBalance: vi.fn().mockResolvedValue({ success: true, data: 777 }),
      getCatalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLocations: vi.fn().mockResolvedValue({ success: true, data: [] }),
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

const ISO = '2026-09-04T15:30:00Z';

const cobro = {
  id: 'c1', qrCodeId: 'q1', payerId: 'p', receiverId: 'r', merchantId: 'm1',
  amount: 2500, fee: 12.5, currency: 'CRC', status: 'completed', createdAt: ISO,
} as unknown as QRPayment;

// Un telefono configurado en ingles: sin locale explicito, formatea en en-US.
const original = Date.prototype.toLocaleDateString;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
    this: Date,
    locales?: Intl.LocalesArgument,
    opciones?: Intl.DateTimeFormatOptions,
  ) {
    return original.call(this, locales ?? 'en-US', opciones);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BusinessHomeView — la fecha de los cobros recientes', () => {
  it('con la app en espanol sale el dia de es-CR, aunque el telefono este en ingles', async () => {
    localStorage.setItem('kiramopay_language', 'es');

    render(
      <LanguageProvider>
        <BusinessHomeView merchant={COMERCIO} payments={[cobro]} paymentsFailed={false} onReload={vi.fn()} />
      </LanguageProvider>,
    );

    // La fecha comparte linea con la comision: se busca en el texto propio.
    expect(await screen.findByText((propio) => propio.includes(fechaCorta(ISO, 'es')))).toBeInTheDocument();
    expect(screen.queryByText((propio) => propio.includes('9/4/2026'))).not.toBeInTheDocument();
  });
});
