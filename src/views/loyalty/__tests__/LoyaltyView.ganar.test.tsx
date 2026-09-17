import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoyaltyView } from '../LoyaltyView';

// La pestana Ganar pintaba "1% cashback" en verde y en negrita, como un
// beneficio vigente, cuando ninguna operacion de la app acredita puntos. Las
// reglas se siguen mostrando, pero como lo que son: una vista previa.
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

const regla = (id: string, category: string, percentage: number) => ({
  id, category, percentage, maxPoints: 200, active: true,
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
    data: { tier: 'bronze', availablePoints: 0, lifetimePoints: 0, pointsToNextTier: 5000 },
  });
  mocks.getRewards.mockResolvedValue({ success: true, data: [] });
  mocks.getTransactions.mockResolvedValue({ success: true, data: [] });
  mocks.getCashbackRules.mockResolvedValue({
    success: true,
    data: [
      regla('r1', 'sinpe', 1),
      regla('r2', 'services', 1.5),
      regla('r3', 'crypto', 0.5),
      regla('r4', 'recharge', 2),
      regla('r5', 'qr_payment', 1),
    ],
  });
});

describe('LoyaltyView — pestana Ganar', () => {
  it('dice a la vista, junto a las reglas, que todavia no acreditan puntos', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Ganar' }));

    const nota = screen.getByRole('note');
    expect(nota).toHaveTextContent('Vista previa: estas reglas aún no acreditan puntos');
    expect(nota).toHaveTextContent('Hoy ninguna operación de la app suma puntos, ni SINPE ni pagos.');
    // La vieja frase prometia una fecha que nadie fijo.
    expect(screen.queryByText(/se activará próximamente/)).toBeNull();
  });

  it('conserva la informacion de cada regla y la marca como proximamente', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Ganar' }));

    expect(screen.getByText('1.5%')).toBeInTheDocument();
    expect(screen.getAllByText('Máx. por transacción: 200 pts')).toHaveLength(5);
    expect(screen.getAllByText('Próximamente')).toHaveLength(5);
  });

  it('nombra las categorias en el idioma de la app, no con la clave del servidor', async () => {
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Ganar' }));

    for (const nombre of ['SINPE', 'Servicios', 'Crypto', 'Recargas', 'Pago con QR']) {
      expect(screen.getByText(nombre)).toBeInTheDocument();
    }
    expect(screen.queryByText(/^Services$/i)).toBeNull();
    expect(screen.queryByText(/^Qr payment$/i)).toBeNull();
  });
});
