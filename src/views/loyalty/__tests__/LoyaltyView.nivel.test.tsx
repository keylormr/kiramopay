import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoyaltyView } from '../LoyaltyView';
import type { ApiResponse } from '@/api/types';
import type { PointsAccount, PointsTransaction, Reward, CashbackRule } from '@/api/repositories/loyalty.repository';

// El nivel se armaba pegando el nombre delante de la palabra traducida: en
// espanol salia "SILVER NIVEL", con el orden del ingles. Y quien ya esta en el
// nivel mas alto leia "Max", fijo en ingles en cualquier idioma.

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getRewards: vi.fn(),
  getTransactions: vi.fn(),
  getCashbackRules: vi.fn(),
  redeemReward: vi.fn(),
}));

vi.mock('@/api', () => ({ getApiLayer: () => ({ loyalty: mocks }) }));

function conNivel(tier: string) {
  const cuenta = {
    id: 'a1', userId: 'u1', totalPoints: 6000, availablePoints: 6000, lifetimePoints: 6000, tier,
  } as PointsAccount;
  mocks.getAccount.mockResolvedValue({ success: true, data: cuenta } satisfies ApiResponse<PointsAccount>);
  mocks.getRewards.mockResolvedValue({ success: true, data: [] } satisfies ApiResponse<Reward[]>);
  mocks.getTransactions.mockResolvedValue({ success: true, data: [] } satisfies ApiResponse<PointsTransaction[]>);
  mocks.getCashbackRules.mockResolvedValue({ success: true, data: [] } satisfies ApiResponse<CashbackRule[]>);
  render(
    <LanguageProvider>
      <LoyaltyView onClose={() => {}} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('LoyaltyView — el nivel en el orden del idioma', () => {
  it('en espanol dice "Nivel silver", no "silver Nivel"', async () => {
    conNivel('silver');

    expect(await screen.findByText('Nivel silver')).toBeInTheDocument();
    expect(screen.queryByText('silver Nivel')).not.toBeInTheDocument();
  });

  it('en el nivel mas alto dice "Nivel maximo" en espanol, no "Max"', async () => {
    conNivel('platinum');

    expect(await screen.findByText('Nivel máximo')).toBeInTheDocument();
    expect(screen.queryByText('Max')).not.toBeInTheDocument();
  });
});
