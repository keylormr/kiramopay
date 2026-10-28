import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ProfileView } from '../ProfileView';

// Perfil > Limites tenia un boton "Solicitar aumento" sin onClick: se tocaba y
// no pasaba nada. El aumento de limites llega con la verificacion avanzada, que
// todavia no esta disponible; la hoja lo dice y no ofrece nada que no haga nada.

const BASE = { id: 'u1', firstName: 'Keilor', lastName: 'Mora', kycLevel: 1, email: '' };

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => ({
    kyc: {
      getStatus: vi.fn().mockResolvedValue({ success: true, data: { dailyLimit: 100000, monthlyLimit: 1000000 } }),
      verifyIdentity: vi.fn(),
    },
    loyalty: { getReferralSummary: vi.fn().mockResolvedValue({ success: false }) },
    mfa: { totpStatus: vi.fn().mockResolvedValue({ success: false }) },
    qrPayments: {
      listPendingMerchants: vi.fn().mockResolvedValue({ success: false }),
      listClosedMerchants: vi.fn().mockResolvedValue({ success: true, data: [] }),
    },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      user: BASE,
      settings: { biometricEnabled: false, notifications: true, language: 'es' },
      transactions: [],
      theme: 'light',
    },
    dispatch: vi.fn(),
  }),
}));

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
});

afterEach(() => {
  cleanup();
});

async function abrirLimites() {
  const user = userEvent.setup();
  render(
    <LanguageProvider>
      <ProfileView />
    </LanguageProvider>,
  );
  await user.click(await screen.findByRole('button', { name: /Límites de transacción/ }));
  return screen.findByRole('dialog', { name: 'Límites de transacción' });
}

describe('ProfileView: hoja de limites', () => {
  it('no ofrece solicitar un aumento', async () => {
    const hoja = await abrirLimites();

    expect(within(hoja).queryByRole('button', { name: /Solicitar aumento/ })).toBeNull();
    expect(within(hoja).queryByText(/Solicitar aumento/)).toBeNull();
  });

  it('dice que los limites mas altos llegan con la verificacion avanzada, todavia no disponible', async () => {
    const hoja = await abrirLimites();

    expect(
      within(hoja).getByText('Los límites más altos llegan con la verificación avanzada, que todavía no está disponible.'),
    ).toBeInTheDocument();
  });

  it('sigue mostrando los limites de la cuenta', async () => {
    const hoja = await abrirLimites();

    expect(within(hoja).getByText('Límite diario')).toBeInTheDocument();
    expect(within(hoja).getByText('Límite mensual')).toBeInTheDocument();
  });
});
