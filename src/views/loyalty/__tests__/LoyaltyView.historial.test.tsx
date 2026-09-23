import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoyaltyView } from '../LoyaltyView';
import { fechaYHora } from '@/utils/fechaPlazo';
import type { ApiResponse } from '@/api/types';
import type { PointsAccount, PointsTransaction, Reward, CashbackRule } from '@/api/repositories/loyalty.repository';

// El servidor guarda un canje en negativo (loyalty/cashback.go) y la pantalla
// le anteponia otro "-": el historial decia "--3,800". La semilla de la cuenta
// de demostracion guardaba los canjes en positivo, y por eso ahi no se veia.
// La fecha, ademas, salia tal cual la manda el servidor (RFC 3339).

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getRewards: vi.fn(),
  getTransactions: vi.fn(),
  getCashbackRules: vi.fn(),
  redeemReward: vi.fn(),
}));

vi.mock('@/api', () => ({ getApiLayer: () => ({ loyalty: mocks }) }));

const cuenta: PointsAccount = {
  id: 'a1', userId: 'u1', totalPoints: 4000, availablePoints: 4000, lifetimePoints: 4000, tier: 'bronze',
};

const CANJE_ISO = '2026-09-20T15:32:11.123456Z';

async function abrirHistorial(movimientos: PointsTransaction[]) {
  mocks.getAccount.mockResolvedValue({ success: true, data: cuenta } satisfies ApiResponse<PointsAccount>);
  mocks.getRewards.mockResolvedValue({ success: true, data: [] } satisfies ApiResponse<Reward[]>);
  mocks.getTransactions.mockResolvedValue({ success: true, data: movimientos } satisfies ApiResponse<PointsTransaction[]>);
  mocks.getCashbackRules.mockResolvedValue({ success: true, data: [] } satisfies ApiResponse<CashbackRule[]>);

  const user = userEvent.setup();
  render(
    <LanguageProvider>
      <LoyaltyView onClose={() => {}} />
    </LanguageProvider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Historial' }));
  await screen.findByText(movimientos[0].description);
}

/** El renglon del historial: la descripcion vive dos niveles adentro. */
function renglon(descripcion: string): HTMLElement {
  return screen.getByText(descripcion).parentElement!.parentElement!;
}

/** Los puntos del renglon, sin el separador de miles (depende del entorno). */
function puntos(descripcion: string): string {
  const numero = within(renglon(descripcion)).getByText((contenido) => /\d/.test(contenido) && /^[+-]/.test(contenido));
  return (numero.textContent ?? '').replace(/[^\d+-]/g, '');
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('LoyaltyView — el historial de puntos', () => {
  it('un canje que el servidor manda en negativo lleva un solo signo', async () => {
    await abrirHistorial([
      { id: 'p1', type: 'redeem', points: -3800, description: 'Canje: Cashback ₡5.000', createdAt: CANJE_ISO },
    ]);

    expect(puntos('Canje: Cashback ₡5.000')).toBe('-3800');
  });

  it('el signo sale del tipo: el canje en positivo (como la semilla vieja) resta y lo ganado suma', async () => {
    await abrirHistorial([
      { id: 'p2', type: 'redeem', points: 500, description: 'Canje: Cashback ₡500', createdAt: CANJE_ISO },
      { id: 'p3', type: 'earn', points: 150, description: 'Pago ICE - 1.5% cashback', createdAt: CANJE_ISO },
    ]);

    expect(puntos('Canje: Cashback ₡500')).toBe('-500');
    expect(puntos('Pago ICE - 1.5% cashback')).toBe('+150');
  });

  it('la fecha sale en el idioma de la pantalla, no como la manda el servidor', async () => {
    await abrirHistorial([
      { id: 'p1', type: 'redeem', points: -3800, description: 'Canje: Cashback ₡5.000', createdAt: CANJE_ISO },
    ]);

    expect(screen.queryByText(CANJE_ISO)).not.toBeInTheDocument();
    expect(within(renglon('Canje: Cashback ₡5.000')).getByText(fechaYHora(CANJE_ISO, 'es'))).toBeInTheDocument();
  });
});
