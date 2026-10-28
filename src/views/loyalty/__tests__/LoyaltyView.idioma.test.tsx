import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoyaltyView } from '../LoyaltyView';
import { precargarIdioma } from '@/test/idiomas';
import { LANGUAGES, loadLanguage } from '@/i18n/translations';

// El catalogo de Recompensas lo siembra el servidor en espanol ("Cashback ₡500",
// "₡500 de vuelta a tu cuenta CRC") y el historial guarda sus descripciones
// ("Canje: Cashback ₡500", "Invitado registrado") tambien en espanol. Con la app
// en otro idioma, la pantalla de Recompensas quedaba a medias: titulos en el
// idioma de la persona y premios en espanol. Los cuatro premios de cashback se
// escriben con su monto (cashbackMinor) en el idioma de la pantalla; lo que la
// pantalla no reconoce se muestra como llega.

const mocks = vi.hoisted(() => ({
  getAccount: vi.fn(),
  getRewards: vi.fn(),
  getTransactions: vi.fn(),
  getCashbackRules: vi.fn(),
  redeemReward: vi.fn(),
}));

vi.mock('@/api', () => ({ getApiLayer: () => ({ loyalty: mocks }) }));

const premios = [
  { id: 'r1', name: 'Cashback ₡500', description: '₡500 de vuelta a tu cuenta CRC', cashbackMinor: 50_000, pointsCost: 500 },
  { id: 'r2', name: 'Cashback ₡1,000', description: '₡1,000 de vuelta a tu cuenta CRC', cashbackMinor: 100_000, pointsCost: 900 },
  { id: 'r3', name: 'Cashback ₡2,500', description: '₡2,500 de vuelta a tu cuenta CRC', cashbackMinor: 250_000, pointsCost: 2000 },
  { id: 'r4', name: 'Cashback ₡5,000', description: '₡5,000 de vuelta a tu cuenta CRC', cashbackMinor: 500_000, pointsCost: 3800 },
].map((p) => ({ ...p, category: 'discount', imageUrl: '', stock: -1, redeemableNow: true }));

const CREADO = '2026-10-20T15:32:11Z';
const movimientos = [
  { id: 't1', type: 'redeem', points: -500, description: 'Canje: Cashback ₡500', createdAt: CREADO },
  { id: 't2', type: 'bonus', points: 500, description: 'Invitado registrado', createdAt: CREADO },
  { id: 't3', type: 'earn', points: 100, description: 'Bono de un evento que la pantalla no conoce', createdAt: CREADO },
];

function pintar() {
  return render(
    <LanguageProvider>
      <LoyaltyView onClose={() => {}} />
    </LanguageProvider>,
  );
}

beforeAll(async () => {
  await precargarIdioma('en');
  await precargarIdioma('ja');
  await precargarIdioma('fr');
});

beforeEach(() => {
  localStorage.clear();
  mocks.getAccount.mockResolvedValue({
    success: true,
    data: { tier: 'bronze', availablePoints: 4000, lifetimePoints: 4000, pointsToNextTier: 100 },
  });
  mocks.getRewards.mockResolvedValue({ success: true, data: premios });
  mocks.getTransactions.mockResolvedValue({ success: true, data: movimientos });
  mocks.getCashbackRules.mockResolvedValue({ success: true, data: [] });
});

describe('LoyaltyView: el catalogo en el idioma de la persona', () => {
  it('en ingles, los cuatro premios salen con su nombre y su descripcion en ingles', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    pintar();

    expect(await screen.findByText('₡500 back to your CRC account')).toBeInTheDocument();
    expect(screen.getByText('₡1,000 back to your CRC account')).toBeInTheDocument();
    expect(screen.getByText('₡2,500 back to your CRC account')).toBeInTheDocument();
    expect(screen.getByText('₡5,000 back to your CRC account')).toBeInTheDocument();
    expect(screen.getByText('Cashback ₡500')).toBeInTheDocument();
    expect(screen.queryByText(/de vuelta a tu cuenta/)).toBeNull();
  });

  it.each(['ja', 'fr'])('en %s, ningun premio queda en espanol y el monto se conserva', async (idioma) => {
    localStorage.setItem('kiramopay_language', idioma);
    pintar();

    expect(await screen.findAllByText(/₡1,000/)).not.toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/de vuelta a tu cuenta/);
  });

  it('en espanol el catalogo se ve igual que llega del servidor', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    pintar();

    expect(await screen.findByText('₡500 de vuelta a tu cuenta CRC')).toBeInTheDocument();
    expect(screen.getByText('Cashback ₡500')).toBeInTheDocument();
  });

  it('un premio que no es de cashback se muestra como llega', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    mocks.getRewards.mockResolvedValue({
      success: true,
      data: [{ ...premios[0], id: 'x1', name: 'Entrada al cine', description: 'Dos entradas para cualquier funcion', cashbackMinor: undefined }],
    });
    pintar();

    expect(await screen.findByText('Entrada al cine')).toBeInTheDocument();
    expect(screen.getByText('Dos entradas para cualquier funcion')).toBeInTheDocument();
  });

  it('un premio cuyo nombre no es el de siempre no se pisa con la plantilla', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    mocks.getRewards.mockResolvedValue({
      success: true,
      data: [{ ...premios[0], id: 'x2', name: 'Cashback de bienvenida', description: 'Te regalamos ₡500 por empezar' }],
    });
    pintar();

    expect(await screen.findByText('Cashback de bienvenida')).toBeInTheDocument();
    expect(screen.getByText('Te regalamos ₡500 por empezar')).toBeInTheDocument();
  });
});

describe('LoyaltyView: el historial en el idioma de la persona', () => {
  async function abrirHistorial(nombreDeLaPestana: RegExp) {
    const user = userEvent.setup();
    pintar();
    await user.click(await screen.findByRole('button', { name: nombreDeLaPestana }));
  }

  it('en ingles, el canje y el bono de referido salen en ingles', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    await abrirHistorial(/^History$/);

    expect(await screen.findByText('Redeemed: Cashback ₡500')).toBeInTheDocument();
    expect(screen.getByText('Friend you invited signed up')).toBeInTheDocument();
    // Lo que no es una plantilla conocida llega tal cual.
    expect(screen.getByText('Bono de un evento que la pantalla no conoce')).toBeInTheDocument();
    expect(screen.queryByText(/^Canje:/)).toBeNull();
  });

  it('en japones tampoco queda el espanol de las plantillas', async () => {
    localStorage.setItem('kiramopay_language', 'ja');
    await abrirHistorial(/履歴/);

    await screen.findByText('Bono de un evento que la pantalla no conoce');
    expect(document.body.textContent).not.toMatch(/Canje:|Invitado registrado/);
  });

  it('en espanol se ve igual que llega del servidor', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    await abrirHistorial(/^Historial$/);

    expect(await screen.findByText('Canje: Cashback ₡500')).toBeInTheDocument();
    expect(screen.getByText('Invitado registrado')).toBeInTheDocument();
  });
});

describe('las plantillas del catalogo en los siete idiomas', () => {
  it.each(LANGUAGES.map((l) => l.code))('%s: llevan el monto y el premio donde corresponde', async (codigo) => {
    const d = (await loadLanguage(codigo)) as unknown as Record<string, string>;
    expect(d.loyalty_reward_cashback_name).toContain('{monto}');
    expect(d.loyalty_reward_cashback_desc).toContain('{monto}');
    expect(d.loyalty_tx_redeem).toContain('{premio}');
    expect(d.loyalty_tx_referral).toBeTruthy();
  });
});
