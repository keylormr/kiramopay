import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ProfileView } from '../ProfileView';

// "Comercios cerrados" aparece en el Perfil solo para quien tiene alguno: es la
// entrada a consultar lo que vendieron, ya que un comercio cerrado no vuelve al
// selector de negocios.

const mocks = vi.hoisted(() => ({ listClosedMerchants: vi.fn() }));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => ({
    kyc: { getStatus: vi.fn().mockResolvedValue({ success: false }), verifyIdentity: vi.fn() },
    loyalty: { getReferralSummary: vi.fn().mockResolvedValue({ success: false }) },
    mfa: { totpStatus: vi.fn().mockResolvedValue({ success: false }) },
    qrPayments: {
      listPendingMerchants: vi.fn().mockResolvedValue({ success: false }),
      listClosedMerchants: mocks.listClosedMerchants,
    },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      user: { id: 'u1', firstName: 'Ana', lastName: 'Mora', kycLevel: 1, email: 'a@b.co' },
      settings: { biometricEnabled: false, notifications: true, language: 'es' },
      transactions: [],
      theme: 'light',
    },
    dispatch: vi.fn(),
  }),
}));

const unCerrado = {
  id: 'm1', name: 'Cafeteria Central', role: 'owner', active: false, closedAt: '2026-10-18T20:00:00Z',
};

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  mocks.listClosedMerchants.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ProfileView: comercios cerrados', () => {
  it('con alguno, la fila aparece y abre la consulta', async () => {
    mocks.listClosedMerchants.mockResolvedValue({ success: true, data: [unCerrado] });
    const onOpenClosedMerchants = vi.fn();
    const user = userEvent.setup();
    render(
      <LanguageProvider>
        <ProfileView onOpenClosedMerchants={onOpenClosedMerchants} />
      </LanguageProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Comercios cerrados/ }));
    expect(onOpenClosedMerchants).toHaveBeenCalled();
  });

  it.each([
    ['sin comercios cerrados', { success: true, data: [] }],
    ['si la consulta falla', { success: false, error: { code: 'FETCH_FAILED', message: 'x' } }],
  ])('%s no aparece', async (_caso, respuesta) => {
    mocks.listClosedMerchants.mockResolvedValue(respuesta);
    render(
      <LanguageProvider>
        <ProfileView onOpenClosedMerchants={vi.fn()} />
      </LanguageProvider>,
    );

    await waitFor(() => expect(mocks.listClosedMerchants).toHaveBeenCalled());
    // La consulta ya contesto: se espera una vuelta para que React pinte.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('button', { name: /Comercios cerrados/ })).toBeNull();
  });
});
