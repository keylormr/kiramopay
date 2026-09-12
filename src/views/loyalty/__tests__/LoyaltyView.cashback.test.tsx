import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoyaltyView } from '../LoyaltyView';

// Canjear un premio descontaba puntos y devolvia un codigo que nadie leia. Ahora
// el cashback llega a la billetera, y la pantalla dice cuanto; si el fondo de
// promociones no alcanza, lo dice sin culpar a la persona.
const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getRewards: vi.fn(),
  getTransactions: vi.fn(),
  getCashbackRules: vi.fn(),
  redeemReward: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ loyalty: mocks }),
}));

const premio = {
  id: 'r1', name: 'Cashback ₡500', description: '₡500 de vuelta a tu cuenta CRC',
  category: 'discount', pointsCost: 500, imageUrl: '', stock: -1, cashbackMinor: 50_000,
};

function pintar() {
  return render(
    <LanguageProvider>
      <LoyaltyView onClose={() => {}} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  mocks.getAccount.mockResolvedValue({
    success: true,
    data: { tier: 'bronze', availablePoints: 4000, lifetimePoints: 4000, pointsToNextTier: 100 },
  });
  mocks.getRewards.mockResolvedValue({ success: true, data: [premio] });
  mocks.getTransactions.mockResolvedValue({ success: true, data: [] });
  mocks.getCashbackRules.mockResolvedValue({ success: true, data: [] });
  mocks.redeemReward.mockReset();
});

describe('LoyaltyView — el cashback llega', () => {
  it('dice cuanto se acredito', async () => {
    mocks.redeemReward.mockResolvedValue({
      success: true,
      data: { id: 'rd1', rewardId: 'r1', points: 500, status: 'completed', createdAt: '', cashbackMinor: 50_000 },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /canjear/i }));

    expect(await screen.findByText('₡500.00 acreditados a tu cuenta.')).toBeInTheDocument();
  });

  it('sin fondo de promociones lo dice, y aclara que no se descontaron puntos', async () => {
    mocks.redeemReward.mockResolvedValue({
      success: false,
      error: { code: 'LOYALTY_SIN_FONDOS', message: 'the promotions fund cannot cover this reward' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /canjear/i }));

    await waitFor(() => expect(screen.getByText(/no se descontaron tus puntos/i)).toBeInTheDocument());
    expect(screen.queryByText(/the promotions fund/i)).not.toBeInTheDocument();
  });
});
