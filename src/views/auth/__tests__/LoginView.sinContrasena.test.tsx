import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoginView } from '../LoginView';

// La pantalla sondea con la contrasena vacia para saber si esta cuenta entra
// sin ella. Dos cosas hay que fijar: que una cuenta de demostracion entre de
// una vez, y que el sondeo NO deje al usuario atrapado ni le muestre un error
// antes de haber escrito nada.
const mocks = vi.hoisted(() => ({ login: vi.fn(), user: null as Record<string, unknown> | null }));

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
    user: mocks.user,
    login: mocks.login,
    logoutReason: null,
    clearLogoutReason: vi.fn(),
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

function pintar(onLogin = vi.fn()) {
  render(
    <LanguageProvider>
      <LoginView onLogin={onLogin} onRegister={vi.fn()} />
    </LanguageProvider>,
  );
  return onLogin;
}

const CAMPO = 'Usuario, cédula, correo o teléfono';

describe('LoginView: entrada sin contrasena', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    mocks.login.mockReset();
    mocks.user = null;
  });

  it('una cuenta de demostracion entra tecleando solo el nombre de usuario', async () => {
    mocks.login.mockImplementation(async (_id: string, password: string) => {
      if (password) return { success: false, code: 'AUTH_FAILED' };
      mocks.user = { firstName: 'Demo', lastName: 'KiramoPay', username: 'demo' };
      return { success: true };
    });
    const user = userEvent.setup();
    const onLogin = pintar();

    await user.type(screen.getByPlaceholderText(CAMPO), 'demo');
    await user.click(screen.getByText('Continuar'));

    await waitFor(() => expect(onLogin).toHaveBeenCalled());
    // No se le pidio contrasena en ningun momento.
    expect(screen.queryByPlaceholderText('Contraseña')).toBeNull();
    // Y se guarda el nombre de usuario para la proxima entrada, no la cedula.
    expect(localStorage.getItem('kiramopay_last_cedula')).toBe('demo');
  });

  it('una cuenta normal pasa al campo de contrasena, sin error a la vista', async () => {
    mocks.login.mockImplementation(async (_id: string, password: string) =>
      password ? { success: true } : { success: false, code: 'PASSWORD_REQUIRED' },
    );
    const user = userEvent.setup();
    pintar();

    await user.type(screen.getByPlaceholderText(CAMPO), 'keilor');
    await user.click(screen.getByText('Continuar'));

    await waitFor(() => expect(screen.getByPlaceholderText('Contraseña')).toBeInTheDocument());
    // El sondeo fallido no puede pintar la pantalla de rojo antes de que el
    // usuario haya escrito una sola letra de su contrasena.
    expect(screen.queryByText('Usuario o contraseña incorrecta')).toBeNull();
  });

  it('el limitador si se muestra en el paso del identificador', async () => {
    mocks.login.mockResolvedValue({ success: false, code: 'RATE_LIMITED' });
    const user = userEvent.setup();
    pintar();

    await user.type(screen.getByPlaceholderText(CAMPO), 'keilor');
    await user.click(screen.getByText('Continuar'));

    await waitFor(() =>
      expect(screen.getByText('Demasiados intentos. Espera un momento e intenta de nuevo.')).toBeInTheDocument(),
    );
    // Y no se avanza: mandar al campo de contrasena solo para que falle otra
    // vez le haria perder el intento.
    expect(screen.queryByPlaceholderText('Contraseña')).toBeNull();
  });
});
