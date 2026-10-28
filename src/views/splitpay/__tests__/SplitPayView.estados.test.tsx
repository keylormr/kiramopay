import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SplitPayView } from '../SplitPayView';
import { LANGUAGES, loadLanguage } from '@/i18n/translations';
import { precargarIdioma } from '@/test/idiomas';

// La lista de cuentas divididas pintaba el estado tal como lo manda el servidor:
// "active", "settled", "cancelled", en minusculas y en ingles, dentro de una
// pantalla en cualquier otro idioma. Cada estado tiene su texto en los siete
// idiomas; un estado que la app no conoce se muestra como llega.

const mocks = vi.hoisted(() => ({ listSplits: vi.fn() }));

vi.mock('@/api', () => ({ getApiLayer: () => ({ splitPay: { listSplits: mocks.listSplits } }) }));
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'yo' } }),
}));

const grupo = (id: string, title: string, status: string) => ({
  id, creatorId: 'yo', title, totalAmount: 3000, currency: 'CRC',
  splitType: 'equal' as const, status, createdAt: '2026-09-07T00:00:00Z',
});

const grupos = [
  grupo('g1', 'Cena', 'active'),
  grupo('g2', 'Paseo', 'settled'),
  grupo('g3', 'Regalo', 'cancelled'),
];

const pintar = () =>
  render(
    <LanguageProvider>
      <SplitPayView onClose={() => {}} />
    </LanguageProvider>,
  );

beforeAll(async () => {
  await precargarIdioma('en');
  await precargarIdioma('ja');
});

beforeEach(() => {
  localStorage.clear();
  mocks.listSplits.mockResolvedValue({ success: true, data: grupos });
});

describe('SplitPayView: el estado de cada cuenta dividida', () => {
  it('en espanol', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    pintar();
    expect(await screen.findByText('Activa')).toBeInTheDocument();
    expect(screen.getByText('Saldada')).toBeInTheDocument();
    expect(screen.getByText('Cancelada')).toBeInTheDocument();
    for (const crudo of ['active', 'settled', 'cancelled']) expect(screen.queryByText(crudo)).toBeNull();
  });

  it('en ingles', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    pintar();
    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Settled')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    for (const crudo of ['active', 'settled', 'cancelled']) expect(screen.queryByText(crudo)).toBeNull();
  });

  it('en japones tampoco queda el estado crudo', async () => {
    localStorage.setItem('kiramopay_language', 'ja');
    pintar();
    await screen.findByText('Cena');
    for (const crudo of ['active', 'settled', 'cancelled']) expect(screen.queryByText(crudo)).toBeNull();
  });

  it('un estado que la app no conoce se muestra como llega', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    mocks.listSplits.mockResolvedValue({ success: true, data: [grupo('g9', 'Raro', 'archived')] });
    pintar();
    expect(await screen.findByText('archived')).toBeInTheDocument();
  });

  it.each(LANGUAGES.map((l) => l.code))('%s: los tres estados tienen texto propio y distinto', async (codigo) => {
    const d = (await loadLanguage(codigo)) as unknown as Record<string, string>;
    const textos = [d.splitpay_status_active, d.splitpay_status_settled, d.splitpay_status_cancelled];
    for (const texto of textos) expect(texto?.trim()).toBeTruthy();
    expect(new Set(textos).size).toBe(3);
  });
});
