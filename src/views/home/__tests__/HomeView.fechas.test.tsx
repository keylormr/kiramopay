import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { precargarIdioma } from '@/test/idiomas';
import { fechaYHora } from '@/utils/fechaPlazo';
import { HomeView } from '../HomeView';
import type { Transaction } from '@/types';

// Los movimientos recientes del Inicio pintaban la fecha que escribia el
// adaptador en es-CR (d/m/aaaa), con la app en el idioma que fuera.

// jsdom no trae ResizeObserver y el grafico del gasto del mes lo usa.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    transactions: { getSummary: vi.fn().mockResolvedValue({ success: false, error: { code: 'X', message: '' } }) },
  }),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <svg data-testid="qr-code" />,
}));

vi.mock('@/services/dataSync', () => ({
  refreshAccounts: vi.fn().mockResolvedValue(undefined),
  refreshTransactions: vi.fn().mockResolvedValue(undefined),
}));

const appState = vi.hoisted(() => ({ transactions: [] as Transaction[] }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      transactions: appState.transactions,
      baseCurrency: 'CRC',
      accounts: [{ ccy: 'CRC', balance: 500000, symbol: '₡', flag: '', iban: '', name: 'Colones', type: 'fiat' }],
    },
    dispatch: vi.fn(),
  }),
}));

const ISO = '2026-09-04T15:30:00Z';

beforeAll(() => precargarIdioma('en'));

beforeEach(() => {
  localStorage.clear();
});

describe('HomeView — la fecha de los movimientos recientes', () => {
  it('en ingles, sale en formato ingles y no en el d/m de es-CR', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    appState.transactions = [{
      id: 'm1', title: 'Pago a Acme', type: 'debit', amount: -5000, ccy: 'CRC',
      date: '4/9/2026', dateISO: ISO, status: 'completed', category: 'Transfer', kind: 'sinpe_send',
    }];

    render(
      <LanguageProvider>
        <HomeView />
      </LanguageProvider>,
    );

    expect(await screen.findByText(fechaYHora(ISO, 'en'))).toBeInTheDocument();
    expect(screen.queryByText('4/9/2026')).not.toBeInTheDocument();
  });
});
