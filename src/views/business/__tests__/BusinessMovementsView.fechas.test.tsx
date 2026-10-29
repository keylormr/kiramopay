import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessMovementsView } from '../BusinessMovementsView';
import type { QRMerchant, QRPayment } from '@/api/repositories/qrpayment.repository';

// La fecha y hora de cada cobro salian con el formato del telefono, no con el
// idioma de la app. Con el telefono en ingles y la app en espanol, el cajero
// leia 09/04 (mes/dia) donde esperaba dia/mes, y una hora en 12 h distinta a la
// de su idioma. Ahora la hora sale en el idioma de la app y en la zona de quien
// mira, que es la misma con la que el servidor cuenta el dia.

const mocks = vi.hoisted(() => ({
  api: {
    qrPayments: {
      getMerchantPayments: vi.fn(),
      getMerchantDailyTotals: vi.fn(),
      getMerchantWithdrawals: vi.fn(),
      exportMerchantReportCsv: vi.fn(),
    },
  },
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  getApiLayer: () => mocks.api,
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

const ISO = '2026-09-04T15:30:00Z'; // 09:30 en Costa Rica

const cobro = {
  id: 'c1', qrCodeId: 'q1', payerId: 'p', receiverId: 'r', merchantId: 'm1',
  amount: 2500, fee: 12.5, currency: 'CRC', status: 'completed', createdAt: ISO,
} as unknown as QRPayment;

const comercio = {
  id: 'm1', name: 'Soda', description: '', category: 'food', qrCode: 'MRC-1',
  active: true, cedula: '3101', cedulaType: 'juridica', legalName: 'Soda SA',
  verificationStatus: 'verified', commissionBps: 50, plan: 'base', role: 'owner',
} as unknown as QRMerchant;

const pintar = () =>
  render(
    <LanguageProvider>
      <BusinessMovementsView merchant={comercio} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(360);
  Object.values(mocks.api.qrPayments).forEach((fn) => fn.mockReset());
  mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({ success: true, data: [cobro] });
  mocks.api.qrPayments.getMerchantDailyTotals.mockResolvedValue({ success: true, data: [] });
  mocks.api.qrPayments.getMerchantWithdrawals.mockResolvedValue({ success: true, data: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BusinessMovementsView: la hora del cobro en el idioma de la app', () => {
  it('con la app en espanol sale la hora de es-CR, aunque el telefono este en ingles', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    pintar();

    const fila = (await screen.findAllByTestId('movimiento'))[0];
    expect(fila.textContent).toMatch(/9:30\s+a\.\s*m\./);
    expect(fila.textContent).not.toMatch(/9:30\s*AM/);
  });

  it('con la app en ingles sale la hora de en-US', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    pintar();

    const fila = (await screen.findAllByTestId('movimiento'))[0];
    expect(fila.textContent).toMatch(/9:30\s*AM/);
  });
});
