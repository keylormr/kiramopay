import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoyaltyView } from '../LoyaltyView';

// La pantalla de puntos traia una tarjeta de planes escrita a mano: Plus a $4,
// Pro a $11, "mejor tipo de cambio" y "sin comision entre bancos". Ninguno de
// esos precios ni beneficios existe. Ahora solo lleva a la pantalla de planes.
const mocks = vi.hoisted(() => ({
  api: {
    loyalty: {
      getAccount: vi.fn(),
      getRewards: vi.fn(),
      getTransactions: vi.fn(),
      getCashbackRules: vi.fn(),
      redeemReward: vi.fn(),
    },
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mocks.api }));

const pintar = (onOpenPlans?: () => void) =>
  render(
    <LanguageProvider>
      <LoyaltyView onClose={() => {}} onOpenPlans={onOpenPlans} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.api.loyalty.getAccount.mockResolvedValue({
    success: true,
    data: { tier: 'bronze', availablePoints: 120, lifetimePoints: 120, pointsToNextTier: 100 },
  });
  mocks.api.loyalty.getRewards.mockResolvedValue({ success: true, data: [] });
  mocks.api.loyalty.getTransactions.mockResolvedValue({ success: true, data: [] });
  mocks.api.loyalty.getCashbackRules.mockResolvedValue({ success: true, data: [] });
});

describe('LoyaltyView y los planes', () => {
  it('ya no pinta precios ni beneficios de planes inventados', async () => {
    pintar(vi.fn());
    await screen.findByRole('button', { name: /Planes/ });

    expect(screen.queryByText(/\$4|\$11\b/)).toBeNull();
    expect(screen.queryByText(/mejor tipo de cambio/i)).toBeNull();
    expect(screen.queryByText(/sin comisión entre bancos/i)).toBeNull();
    expect(screen.queryByText(/límites mayores|límites máximos/i)).toBeNull();
  });

  it('lleva a la pantalla de planes', async () => {
    const onOpenPlans = vi.fn();
    const user = userEvent.setup();
    pintar(onOpenPlans);

    await user.click(await screen.findByRole('button', { name: /Planes.*Gratis, Plus y Pro/ }));
    expect(onOpenPlans).toHaveBeenCalledTimes(1);
  });

  it('sin a donde ir no ofrece el acceso', async () => {
    pintar();
    await screen.findAllByText('120');
    expect(screen.queryByRole('button', { name: /Gratis, Plus y Pro/ })).toBeNull();
  });
});
