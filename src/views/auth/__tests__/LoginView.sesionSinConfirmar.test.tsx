import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoginView } from '../LoginView';

// Recargar sin red (o con el cupo de peticiones agotado) mandaba al login sin
// ninguna explicacion. Ahora la sesion no se cierra por un fallo pasajero, y
// esta pantalla lo dice con un boton para reintentar.
const mocks = vi.hoisted(() => ({
  restauracion: 'normal' as 'normal' | 'reintentando' | 'sin_conexion',
  bootstrap: vi.fn(),
  descartar: vi.fn(),
}));

vi.mock('@/services/dataSync', () => ({ syncAllData: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { isAuthenticated: false, user: null, passwordHash: '', settings: { biometricEnabled: false } },
    dispatch: vi.fn(),
  }),
}));

vi.mock('@/stores/auth.store', () => {
  const state = () => ({
    isAuthenticated: false,
    user: null,
    login: vi.fn(),
    logoutReason: null,
    clearLogoutReason: vi.fn(),
    restauracion: mocks.restauracion,
    bootstrap: mocks.bootstrap,
    descartarAvisoRestauracion: mocks.descartar,
  });
  const hook = ((sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state())) as unknown as {
    (sel?: unknown): unknown;
    getState: () => ReturnType<typeof state>;
  };
  hook.getState = state;
  return { useAuthStore: hook };
});

vi.mock('@/stores/settings.store', () => {
  const state = () => ({ biometricEnabled: false });
  const hook = ((sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state())) as unknown as {
    (sel?: unknown): unknown;
    getState: () => ReturnType<typeof state>;
  };
  hook.getState = state;
  return { useSettingsStore: hook };
});

const pintar = () =>
  render(
    <LanguageProvider>
      <LoginView onLogin={vi.fn()} onRegister={vi.fn()} />
    </LanguageProvider>,
  );

describe('LoginView: sesion sin confirmar', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    mocks.bootstrap.mockReset();
    mocks.bootstrap.mockResolvedValue(undefined);
    mocks.descartar.mockReset();
  });

  it('sin nada que avisar, no hay aviso', () => {
    mocks.restauracion = 'normal';
    pintar();
    expect(screen.queryByText('No pudimos confirmar tu sesión')).toBeNull();
  });

  it('explica que fallo la conexion, no la sesion, y deja reintentar', async () => {
    mocks.restauracion = 'sin_conexion';
    const user = userEvent.setup();
    pintar();

    const aviso = screen.getByRole('status');
    expect(aviso.textContent).toContain('No pudimos confirmar tu sesión');
    expect(aviso.textContent).toContain('Tu sesión no se cerró');

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(mocks.bootstrap).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(mocks.descartar).toHaveBeenCalledTimes(1);
  });

  it('mientras reintenta, el boton lo dice y no admite otro toque', async () => {
    mocks.restauracion = 'reintentando';
    const user = userEvent.setup();
    pintar();

    const boton = screen.getByRole('button', { name: 'Reintentando...' });
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute('aria-busy', 'true');
    await user.click(boton);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    // No se ofrece cerrar un aviso que esta en curso.
    expect(screen.queryByRole('button', { name: 'Cerrar' })).toBeNull();
  });

  it('sale en el idioma de la app', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    mocks.restauracion = 'sin_conexion';
    pintar();

    expect(await screen.findByText("We couldn't confirm your session")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
