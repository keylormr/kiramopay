import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ServicesView } from '../ServicesView';
import { fechaCorta } from '@/utils/fechaPlazo';

// Las recargas pintaban `recharge.date` tal cual, y lo que trae el servidor
// es `created_at`: "2026-09-04T15:30:00Z" en la fila, en cualquier idioma.

const ISO = '2026-09-04T15:30:00Z';

vi.mock('@/api', () => ({
  getApiLayer: () => ({ services: { payBill: vi.fn(), recharge: vi.fn() }, mfa: { totpVerify: vi.fn() } }),
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
      savedServices: [],
      billHistory: [],
      // Una fila como la arma el adaptador del servidor.
      rechargeHistory: [
        { id: 'r1', operatorId: 'kolbi', phone: '88880000', amount: 5000, date: ISO, dateISO: ISO, status: 'completed' },
      ],
    },
    dispatch: vi.fn(),
  }),
}));

vi.mock('@/services/dataSync', () => ({ refreshAccounts: vi.fn(() => Promise.resolve()) }));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('ServicesView — la fecha de las recargas', () => {
  it('las recargas recientes muestran el dia en el idioma de la app, no la fecha cruda', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <ServicesView />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole('tab', { name: 'Recarga' }));

    expect(screen.getByText(fechaCorta(ISO, 'es'))).toBeInTheDocument();
    expect(screen.queryByText(ISO)).not.toBeInTheDocument();
  });

  it('el historial tambien', async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <ServicesView />
      </LanguageProvider>,
    );

    await user.click(screen.getByRole('tab', { name: 'Historial' }));

    expect(screen.getByText(fechaCorta(ISO, 'es'))).toBeInTheDocument();
    expect(screen.queryByText(ISO)).not.toBeInTheDocument();
  });
});
