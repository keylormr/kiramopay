import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessMovementsView } from '../BusinessMovementsView';
import type { QRPayment } from '@/api/repositories/qrpayment.repository';

// La fecha y hora de cada cobro salian con toLocaleString(undefined): el
// formato del telefono, no el idioma de la app. Con el telefono en ingles y la
// app en espanol, el cajero leia 09/04 (mes/dia) donde esperaba dia/mes.

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

const ISO = '2026-09-04T15:30:00Z';

const cobro = {
  id: 'c1', qrCodeId: 'q1', payerId: 'p', receiverId: 'r', merchantId: 'm1',
  amount: 2500, fee: 12.5, currency: 'CRC', status: 'completed', createdAt: ISO,
} as unknown as QRPayment;

const DIA_Y_HORA: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };

// Un telefono configurado en ingles: sin locale explicito, formatea en en-US.
const original = Date.prototype.toLocaleString;
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (
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

describe('BusinessMovementsView — la fecha del cobro en el idioma de la app', () => {
  it('con la app en espanol sale dia/mes y hora de es-CR, aunque el telefono este en ingles', () => {
    localStorage.setItem('kiramopay_language', 'es');

    render(
      <LanguageProvider>
        <BusinessMovementsView payments={[cobro]} />
      </LanguageProvider>,
    );

    expect(screen.getByText(new Date(ISO).toLocaleString('es-CR', DIA_Y_HORA))).toBeInTheDocument();
    expect(screen.queryByText(new Date(ISO).toLocaleString('en-US', DIA_Y_HORA))).not.toBeInTheDocument();
  });
});
