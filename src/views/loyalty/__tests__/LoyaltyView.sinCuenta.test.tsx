import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoyaltyView } from '../LoyaltyView';

// Si la cuenta de puntos no se puede consultar, la pantalla mostraba "0" y
// nivel Bronce: exactamente lo mismo que ve alguien que de verdad tiene cero.
// Un cero es una afirmacion sobre el saldo de puntos; no saberlo no lo es.
const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getRewards: vi.fn(),
  getTransactions: vi.fn(),
  getCashbackRules: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    loyalty: {
      getAccount: mocks.getAccount,
      getRewards: mocks.getRewards,
      getTransactions: mocks.getTransactions,
      getCashbackRules: mocks.getCashbackRules,
      redeemReward: vi.fn(),
    },
  }),
}));

const pintar = () =>
  render(
    <LanguageProvider>
      <LoyaltyView onClose={() => {}} />
    </LanguageProvider>,
  );

describe('LoyaltyView cuando la cuenta de puntos no carga', () => {
  beforeEach(() => {
    mocks.getRewards.mockResolvedValue({ success: true, data: [] });
    mocks.getTransactions.mockResolvedValue({ success: true, data: [] });
    mocks.getCashbackRules.mockResolvedValue({ success: true, data: [] });
  });

  it('no muestra 0 puntos: muestra que no hay dato', async () => {
    mocks.getAccount.mockResolvedValue({ success: false, error: { code: 'X', message: 'sin red' } });
    pintar();

    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
    // El numero grande de puntos no puede ser un cero inventado.
    expect(screen.queryByText('0')).toBeNull();
    // Y se ofrece volver a intentarlo (el idioma del proveedor puede variar).
    expect(screen.getByRole('button', { name: /reintentar|retry/i })).toBeTruthy();
  });

  it('una cuenta que de verdad tiene cero puntos si muestra 0', async () => {
    mocks.getAccount.mockResolvedValue({
      success: true,
      data: { tier: 'bronze', availablePoints: 0, lifetimePoints: 0, pointsToNextTier: 100 },
    });
    pintar();

    await waitFor(() => expect(screen.getAllByText('0').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /reintentar|retry/i })).toBeNull();
  });
});
