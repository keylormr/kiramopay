import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ProfileView } from '../ProfileView';

// Los limites de transaccion dependen del nivel de KYC. Si la consulta fallaba,
// la pantalla caia a 500.000 diarios y 5.000.000 mensuales, que son los del
// nivel VERIFICADO: a una cuenta basica -cuyo tope real es 100.000 al dia- se
// le mostraba cinco veces su limite. Es el mismo error que la migracion 042
// tuvo que corregir en la base de datos.
const mocks = vi.hoisted(() => ({ getStatus: vi.fn() }));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => ({
    kyc: { getStatus: mocks.getStatus, verifyIdentity: vi.fn() },
    loyalty: { getReferralSummary: vi.fn().mockResolvedValue({ success: false }) },
    // La vista consulta el estado del segundo factor al montarse; sin esto la
    // promesa queda sin manejar y ensucia la corrida entera.
    mfa: { totpStatus: vi.fn().mockResolvedValue({ success: false }) },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      user: { id: 'u1', firstName: 'Ana', lastName: 'Mora', kycLevel: 0, email: 'a@b.co' },
      settings: { biometricEnabled: false, notifications: true, language: 'es' },
      transactions: [],
      theme: 'light',
    },
    dispatch: vi.fn(),
  }),
}));

const pintar = () =>
  render(
    <LanguageProvider>
      <ProfileView />
    </LanguageProvider>,
  );

describe('ProfileView: limites de transaccion', () => {
  beforeEach(() => mocks.getStatus.mockReset());

  it('si no se pudieron consultar, no inventa el limite del nivel verificado', async () => {
    mocks.getStatus.mockResolvedValue({ success: false, error: { code: 'X', message: 'sin red' } });
    pintar();

    // 500.000 es el tope del nivel VERIFICADO; una cuenta basica tiene 100.000.
    await waitFor(() => expect(screen.queryByText(/₡500,000/)).toBeNull());
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('con la respuesta del servidor muestra el limite real de la cuenta', async () => {
    mocks.getStatus.mockResolvedValue({
      success: true,
      data: { kycLevel: 0, kycStatus: 'pending', dailyLimit: 100000, monthlyLimit: 500000 },
    });
    pintar();

    await waitFor(() => expect(screen.getAllByText(/₡100,000/).length).toBeGreaterThan(0));
  });
});
