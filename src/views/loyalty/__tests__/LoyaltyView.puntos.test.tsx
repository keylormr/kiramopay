import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoyaltyView } from '../LoyaltyView';
import type { ApiResponse } from '@/api/types';
import type { PointsAccount, PointsTransaction, Reward, CashbackRule } from '@/api/repositories/loyalty.repository';

// Los puntos se escribian con toLocaleString() del telefono. En uno configurado
// en es-CR, 12500 salia "12 500", contra la coma de miles que el dueno decidio
// para toda la app (ver utils/money.ts).

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getRewards: vi.fn(),
  getTransactions: vi.fn(),
  getCashbackRules: vi.fn(),
  redeemReward: vi.fn(),
}));

vi.mock('@/api', () => ({ getApiLayer: () => ({ loyalty: mocks }) }));

const cuenta: PointsAccount = {
  id: 'a1', userId: 'u1', totalPoints: 12500, availablePoints: 12500, lifetimePoints: 12500, tier: 'bronze',
};

// Un telefono configurado en es-CR: sin locale explicito, agrupa como es-CR.
const original = Number.prototype.toLocaleString;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
    this: number,
    locales?: Intl.LocalesArgument,
    opciones?: Intl.NumberFormatOptions,
  ) {
    return original.call(this, locales ?? 'es-CR', opciones);
  });
  mocks.getAccount.mockResolvedValue({ success: true, data: cuenta } satisfies ApiResponse<PointsAccount>);
  mocks.getRewards.mockResolvedValue({ success: true, data: [] } satisfies ApiResponse<Reward[]>);
  mocks.getTransactions.mockResolvedValue({ success: true, data: [] } satisfies ApiResponse<PointsTransaction[]>);
  mocks.getCashbackRules.mockResolvedValue({ success: true, data: [] } satisfies ApiResponse<CashbackRule[]>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LoyaltyView — los puntos con la coma de miles de la app', () => {
  it('12500 puntos salen 12,500 aunque el telefono este en es-CR', async () => {
    render(
      <LanguageProvider>
        <LoyaltyView onClose={() => {}} />
      </LanguageProvider>,
    );

    expect(await screen.findByText('12,500')).toBeInTheDocument();
    expect(screen.queryByText((propio) => /12\s500/.test(propio))).not.toBeInTheDocument();
  });
});
