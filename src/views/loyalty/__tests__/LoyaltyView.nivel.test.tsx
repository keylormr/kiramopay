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
  it('en espanol dice "Nivel Plata", no "silver Nivel" ni "Nivel silver"', async () => {
    conNivel('silver');

    expect(await screen.findByText('Nivel Plata')).toBeInTheDocument();
    expect(screen.queryByText('silver Nivel')).not.toBeInTheDocument();
    expect(screen.queryByText(/silver/i)).not.toBeInTheDocument();
  });

  it.each([
    ['bronze', 'Nivel Bronce'],
    ['gold', 'Nivel Oro'],
    ['platinum', 'Nivel Platino'],
  ])('el nivel %s se lee en espanol', async (nivel, texto) => {
    conNivel(nivel);

    expect(await screen.findByText(texto)).toBeInTheDocument();
    expect(screen.queryByText(/bronze|gold|platinum/i)).not.toBeInTheDocument();
  });

  // La barra de progreso nombraba el siguiente nivel en ingles y con el numero
  // pegado: "Gold: 25,000 pts".
  it('la barra de progreso nombra el siguiente nivel en espanol', async () => {
    conNivel('silver');

    expect(await screen.findByText('Oro: 25,000 pts')).toBeInTheDocument();
    expect(screen.queryByText(/Gold/)).not.toBeInTheDocument();
  });

  it('en ingles el nivel sigue leyendose en ingles', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    conNivel('silver');

    expect(await screen.findByText('Silver tier')).toBeInTheDocument();
    expect(screen.getByText('Gold: 25,000 pts')).toBeInTheDocument();
  });

  // La etiqueta y el icono del nivel Plata casi no se distinguian del fondo
  // plateado: el color del metal (#C0C0C0, #E5E4E2) es el de un relleno, no el
  // de un texto. El texto lleva una clase con contraste propio, no el color del
  // metal en linea.
  it('la etiqueta del nivel no usa el color pastel del metal como color de texto', async () => {
    conNivel('silver');

    const etiqueta = await screen.findByText('Nivel Plata');
    expect(etiqueta.style.color).toBe('');
    expect(etiqueta.className).toMatch(/text-/);
  });

  it('en el nivel mas alto dice "Nivel maximo" en espanol, no "Max"', async () => {
    conNivel('platinum');

    expect(await screen.findByText('Nivel máximo')).toBeInTheDocument();
    expect(screen.queryByText('Max')).not.toBeInTheDocument();
  });
});
