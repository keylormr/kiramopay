import { render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoyaltyView } from '../LoyaltyView';

// El catalogo de premios quedo apagado (migracion 060) porque canjear
// descontaba puntos y no entregaba nada. Con la lista vacia, la pantalla decia
// solo "Sin recompensas disponibles": quien sigue acumulando puntos por
// referidos no tenia forma de saber si los perdio o si el catalogo esta en
// pausa. La pantalla tiene que decirlo.
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

describe('LoyaltyView con el catalogo de premios apagado', () => {
  beforeEach(() => {
    // Sin fijar el idioma, se carga de forma asincronica y la asercion sobre
    // texto exacto depende del momento en que corra.
    localStorage.setItem('kiramopay_language', 'es');
    mocks.getAccount.mockResolvedValue({
      success: true,
      data: { tier: 'bronze', availablePoints: 4000, lifetimePoints: 4000, pointsToNextTier: 100 },
    });
    mocks.getRewards.mockResolvedValue({ success: true, data: [] });
    mocks.getTransactions.mockResolvedValue({ success: true, data: [] });
    mocks.getCashbackRules.mockResolvedValue({ success: true, data: [] });
  });

  it('explica que esta en pausa y que los puntos siguen guardados', async () => {
    render(
      <LanguageProvider>
        <LoyaltyView onClose={() => {}} />
      </LanguageProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Sin recompensas disponibles/i)).toBeTruthy());
    expect(screen.getByText(/en pausa/i)).toBeTruthy();
    expect(screen.getByText(/siguen guardados/i)).toBeTruthy();
  });
});
