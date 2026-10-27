import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoyaltyView } from '../LoyaltyView';

// El fondo de promociones puede estar en cero, y el catalogo igual ofrecia
// "Canjear": el toque terminaba siempre en LOYALTY_SIN_FONDOS. El servidor dice
// por premio si se puede canjear ahora (`redeemableNow`); la pantalla no ofrece
// el boton de uno que no se puede, y lo explica. Sin ese dato (un servidor
// viejo) el boton sigue como antes y decide el servidor al tocar.
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

const premio = (extra: Record<string, unknown>) => ({
  id: 'r1', name: 'Cashback ₡500', description: '₡500 de vuelta a tu cuenta CRC',
  category: 'discount', pointsCost: 500, imageUrl: '', stock: -1, cashbackMinor: 50_000,
  ...extra,
});

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
  mocks.getTransactions.mockResolvedValue({ success: true, data: [] });
  mocks.getCashbackRules.mockResolvedValue({ success: true, data: [] });
  mocks.redeemReward.mockReset();
});

describe('LoyaltyView: premios que el fondo no cubre', () => {
  it('un premio que no se puede canjear ahora tiene el boton deshabilitado y lo explica', async () => {
    mocks.getRewards.mockResolvedValue({ success: true, data: [premio({ redeemableNow: false })] });
    const user = userEvent.setup();
    pintar();

    const boton = await screen.findByRole('button', { name: /canjear/i });
    expect(boton).toBeDisabled();
    expect(screen.getByText('No disponible por ahora. Tus puntos no se tocan.')).toBeInTheDocument();

    await user.click(boton);
    expect(mocks.redeemReward).not.toHaveBeenCalled();
  });

  it('un premio que si se puede canjear conserva el boton y no muestra el aviso', async () => {
    mocks.getRewards.mockResolvedValue({ success: true, data: [premio({ redeemableNow: true })] });
    pintar();

    expect(await screen.findByRole('button', { name: /canjear/i })).toBeEnabled();
    expect(screen.queryByText(/No disponible por ahora/)).toBeNull();
  });

  it('sin el dato del servidor el boton sigue habilitado y decide el servidor', async () => {
    mocks.getRewards.mockResolvedValue({ success: true, data: [premio({})] });
    pintar();

    expect(await screen.findByRole('button', { name: /canjear/i })).toBeEnabled();
    expect(screen.queryByText(/No disponible por ahora/)).toBeNull();
  });

  it('solo se deshabilitan los premios que no se pueden canjear', async () => {
    mocks.getRewards.mockResolvedValue({
      success: true,
      data: [
        premio({ id: 'r1', name: 'Cashback chico', redeemableNow: true }),
        premio({ id: 'r2', name: 'Cashback grande', pointsCost: 1000, cashbackMinor: 500_000, redeemableNow: false }),
      ],
    });
    pintar();

    await screen.findByText('Cashback grande');
    const botones = screen.getAllByRole('button', { name: /canjear/i });
    expect(botones).toHaveLength(2);
    expect(botones[0]).toBeEnabled();
    expect(botones[1]).toBeDisabled();
    expect(screen.getAllByText(/No disponible por ahora/)).toHaveLength(1);
  });
});
