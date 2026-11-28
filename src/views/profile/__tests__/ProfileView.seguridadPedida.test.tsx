import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ProfileView } from '../ProfileView';

// Tocar un aviso de seguridad lleva a Perfil, a la seccion de Seguridad: la
// pantalla baja hasta ella y el foco queda en su titulo.

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => ({
    kyc: { getStatus: vi.fn().mockResolvedValue({ success: false }), verifyIdentity: vi.fn() },
    loyalty: { getReferralSummary: vi.fn().mockResolvedValue({ success: false }) },
    mfa: { totpStatus: vi.fn().mockResolvedValue({ success: false }) },
    transactions: { getSummary: vi.fn().mockResolvedValue({ success: false }) },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [],
      baseCurrency: 'CRC',
      user: { id: 'u1', firstName: 'Ana', lastName: 'Mora', kycLevel: 0, email: 'a@b.co', phone: '+50688880001' },
      settings: { biometricEnabled: false, notifications: true, language: 'es' },
      transactions: [],
      theme: 'light',
    },
    dispatch: vi.fn(),
  }),
}));

const bajar = vi.fn();

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  bajar.mockReset();
  Element.prototype.scrollIntoView = bajar;
});

afterEach(() => cleanup());

function pintar(seguridadPedida: number, atendida = vi.fn()) {
  render(
    <LanguageProvider>
      <ProfileView seguridadPedida={seguridadPedida} onSeguridadAtendida={atendida} />
    </LanguageProvider>,
  );
  return atendida;
}

describe('ProfileView: un aviso de seguridad lleva a Seguridad', () => {
  it('baja hasta la seccion, le da el foco a su titulo y suelta el pedido', async () => {
    const atendida = pintar(3);

    const titulo = screen.getByRole('heading', { name: 'Seguridad' });
    await waitFor(() => expect(atendida).toHaveBeenCalledTimes(1));
    expect(bajar).toHaveBeenCalledTimes(1);
    expect(bajar.mock.contexts[0]).toBe(titulo);
    expect(titulo).toHaveFocus();
  });

  it('abierta de la forma normal, no se mueve', async () => {
    const atendida = pintar(0);

    expect(screen.getByRole('heading', { name: 'Seguridad' })).toBeInTheDocument();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(bajar).not.toHaveBeenCalled();
    expect(atendida).not.toHaveBeenCalled();
  });
});
