import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoyaltyView } from '../LoyaltyView';
import type { ApiResponse } from '@/api/types';
import type { PointsAccount, PointsTransaction, Reward, CashbackRule } from '@/api/repositories/loyalty.repository';

// HALLAZGO 78: la pantalla esperaba las CUATRO peticiones (cuenta, recompensas,
// historial, reglas de cashback) con un solo Promise.allSettled antes de
// pintar cualquier cosa. Cuenta y Recompensas -lo unico que se ve al abrir- no
// necesitan a Historial ni a Ganar, dos pestanas que ni siquiera estan a la
// vista: por eso la pantalla se quedaba "un buen rato" con solo un circulo
// girando aunque el propio saldo ya tuviera respuesta.
function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => { resolver = r; });
  return { promesa, resolver };
}

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getRewards: vi.fn(),
  getTransactions: vi.fn(),
  getCashbackRules: vi.fn(),
  redeemReward: vi.fn(),
}));

vi.mock('@/api', () => ({ getApiLayer: () => ({ loyalty: mocks }) }));

function pintar() {
  return render(
    <LanguageProvider>
      <LoyaltyView onClose={() => {}} />
    </LanguageProvider>,
  );
}

const cuenta: PointsAccount = {
  id: 'a1', userId: 'u1', totalPoints: 4000, availablePoints: 4000, lifetimePoints: 4000, tier: 'bronze',
};
const premio: Reward = {
  id: 'r1', name: 'Cashback ₡500', description: '', category: 'discount',
  pointsCost: 500, imageUrl: '', stock: -1, cashbackMinor: 50_000,
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.redeemReward.mockReset();
});

describe('LoyaltyView — la cuenta y Recompensas no esperan a las otras pestanas', () => {
  it('pinta el saldo y el catalogo apenas contestan, sin esperar a Historial ni a Ganar', async () => {
    mocks.getAccount.mockResolvedValue({ success: true, data: cuenta } satisfies ApiResponse<PointsAccount>);
    mocks.getRewards.mockResolvedValue({ success: true, data: [premio] } satisfies ApiResponse<Reward[]>);
    // Historial y reglas de cashback NUNCA contestan en esta prueba: si la
    // pantalla siguiera esperandolas, el saldo tampoco aparecería jamás.
    const historial = diferida<ApiResponse<PointsTransaction[]>>();
    const reglas = diferida<ApiResponse<CashbackRule[]>>();
    mocks.getTransactions.mockReturnValue(historial.promesa);
    mocks.getCashbackRules.mockReturnValue(reglas.promesa);

    pintar();

    // El separador de miles depende del entorno (coma, punto o espacio): lo
    // que importa es que el saldo (4000, sin ceros inventados) ya aparecio.
    await screen.findAllByText((contenido) => contenido.replace(/[^\d]/g, '') === '4000');
    expect(await screen.findByText('Cashback ₡500')).toBeInTheDocument();
  });

  it('la pestana Historial muestra un esqueleto, no "sin historial", mientras su peticion sigue en camino', async () => {
    mocks.getAccount.mockResolvedValue({ success: true, data: cuenta } satisfies ApiResponse<PointsAccount>);
    mocks.getRewards.mockResolvedValue({ success: true, data: [] } satisfies ApiResponse<Reward[]>);
    const historial = diferida<ApiResponse<PointsTransaction[]>>();
    mocks.getTransactions.mockReturnValue(historial.promesa);
    mocks.getCashbackRules.mockResolvedValue({ success: true, data: [] } satisfies ApiResponse<CashbackRule[]>);

    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Historial' }));
    // Todavia no se sabe si hay historial: no puede decir que no hay.
    expect(screen.queryByText('Sin historial de puntos')).toBeNull();
    const esqueletos = document.querySelectorAll('.animate-pulse');
    expect(esqueletos.length).toBeGreaterThan(0);

    historial.resolver({ success: true, data: [] });
    await waitFor(() => expect(screen.getByText('Sin historial de puntos')).toBeInTheDocument());
  });
});
