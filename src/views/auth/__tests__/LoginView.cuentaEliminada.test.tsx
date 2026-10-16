import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { useAuthStore } from '@/stores/auth.store';
import { LoginView } from '../LoginView';

// Quien elimina su cuenta vuelve al login: tiene que ver que se elimino (si no,
// parece que la app lo expulso sin motivo), y el login lleva a la politica de
// privacidad, que Google Play exige dentro de la app.

vi.mock('@/services/dataSync', () => ({ syncAllData: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { isAuthenticated: false, user: null, passwordHash: '', settings: { biometricEnabled: false } },
    dispatch: vi.fn(),
  }),
}));

vi.mock('@/stores/settings.store', () => {
  const state = () => ({ biometricEnabled: false });
  const hook = ((sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state())) as unknown as {
    (sel?: unknown): unknown;
    getState: () => ReturnType<typeof state>;
  };
  hook.getState = state;
  return { useSettingsStore: hook };
});

const abrirPublico = vi.hoisted(() => vi.fn());
vi.mock('@/utils/enlacesLegales', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  abrirPublico,
}));

const pintar = () =>
  render(
    <LanguageProvider>
      <LoginView onLogin={vi.fn()} onRegister={vi.fn()} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  abrirPublico.mockReset();
  useAuthStore.setState({ logoutReason: null });
});
afterEach(cleanup);

describe('LoginView — cuenta eliminada y politica de privacidad', () => {
  it('avisa que la cuenta se elimino, y el aviso se puede cerrar', async () => {
    useAuthStore.setState({ logoutReason: 'deleted' });
    const user = userEvent.setup();
    pintar();

    expect(screen.getByText('Cuenta eliminada')).toBeInTheDocument();
    expect(screen.getByText(/tus datos personales se borraron/)).toBeInTheDocument();
    // No es el aviso de cuenta bloqueada.
    expect(screen.queryByText('Cuenta bloqueada')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByText('Cuenta eliminada')).toBeNull();
  });

  it('sin motivo de salida no hay aviso', () => {
    pintar();
    expect(screen.queryByText('Cuenta eliminada')).toBeNull();
  });

  it('el login enlaza la politica de privacidad', async () => {
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Política de privacidad' }));
    expect(abrirPublico).toHaveBeenCalledWith('/privacidad');
  });
});
