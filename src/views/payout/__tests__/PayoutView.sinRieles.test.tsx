import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { PayoutView } from '../PayoutView';

// En produccion no hay ningun riel de pago y la pantalla pintaba en rojo "No
// hay rieles de pago disponibles." (en ingles, "No payment rails available."):
// jerga de quien construyo el modulo, con aspecto de error. No es un error: es
// algo que todavia no existe. Se dice en lenguaje simple y con el aspecto de un
// aviso.

const mockApi = vi.hoisted(() => ({
  payout: {
    list: vi.fn(),
    rails: vi.fn(),
    create: vi.fn(),
    refresh: vi.fn(),
    get: vi.fn(),
  },
  mfa: { totpVerify: vi.fn() },
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mockApi,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/services/dataSync', () => ({ refreshAccounts: vi.fn(() => Promise.resolve()) }));

const TEXTO = 'Enviar a cuentas de otros bancos todavía no está disponible.';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mockApi.payout.list.mockResolvedValue({ success: true, data: [] });
  mockApi.payout.rails.mockResolvedValue({ success: true, data: [] });
});

function pintar() {
  return render(
    <LanguageProvider>
      <PayoutView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

describe('PayoutView: sin ninguna via de envio', () => {
  it('lo dice en lenguaje simple', async () => {
    pintar();

    expect(await screen.findByText(TEXTO)).toBeInTheDocument();
    expect(screen.queryByText(/rieles?/i)).toBeNull();
  });

  it('no tiene aspecto de error', async () => {
    pintar();

    const aviso = await screen.findByText(TEXTO);
    // Ni el color rojo del error ni un rol de alerta: es un aviso de estado.
    expect(aviso.className).not.toMatch(/red|danger/);
    expect(aviso.closest('[role="alert"]')).toBeNull();
    expect(aviso.closest('[role="status"]')).not.toBeNull();
  });
});
