import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoginView } from '../LoginView';
import es from '@/i18n/languages/es';

// La pantalla sondea con la contrasena vacia para saber si esta cuenta entra
// sin ella. Dos cosas hay que fijar: que una cuenta de demostracion entre de
// una vez, y que el sondeo NO deje al usuario atrapado ni le muestre un error
// antes de haber escrito nada.
const mocks = vi.hoisted(() => ({ login: vi.fn(), user: null as Record<string, unknown> | null }));

// La huella: por defecto no hay sensor, como en el navegador; las pruebas de la
// huella lo encienden.
const bio = vi.hoisted(() => ({
  checkAvailability: vi.fn(),
  authenticate: vi.fn(),
  getCredentials: vi.fn(),
  setCredentials: vi.fn(),
}));
vi.mock('@/services/biometric', () => ({ biometricService: bio }));

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
    bio.checkAvailability.mockReset().mockResolvedValue({ isAvailable: false, biometryType: 'none' });
    bio.authenticate.mockReset();
    bio.getCredentials.mockReset();
    bio.setCredentials.mockReset();
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

  // El acceso rapido del ultimo usuario saltaba el sondeo y pedia la
  // contrasena siempre: una cuenta de demostracion que aparecia en "Ultimo
  // acceso" tenia que teclear su nombre a mano para entrar sin contrasena.
  describe('ultimo acceso', () => {
    beforeEach(() => {
      localStorage.setItem('kiramopay_last_cedula', 'demo');
      localStorage.setItem('kiramopay_last_name', 'Demo KiramoPay');
      localStorage.setItem('kiramopay_last_tipo', 'usuario');
    });

    it('una cuenta de demostracion entra de un toque', async () => {
      mocks.login.mockImplementation(async (_id: string, password: string) => {
        if (password) return { success: false, code: 'AUTH_FAILED' };
        mocks.user = { firstName: 'Demo', lastName: 'KiramoPay', username: 'demo' };
        return { success: true };
      });
      const user = userEvent.setup();
      const onLogin = pintar();

      await user.click(screen.getByText('Demo KiramoPay'));

      await waitFor(() => expect(onLogin).toHaveBeenCalled());
      expect(mocks.login).toHaveBeenCalledWith('demo', '');
      expect(screen.queryByPlaceholderText('Contraseña')).toBeNull();
    });

    it('una cuenta normal pasa al campo de contrasena, sin error a la vista', async () => {
      mocks.login.mockImplementation(async (_id: string, password: string) =>
        password ? { success: true } : { success: false, code: 'PASSWORD_REQUIRED' },
      );
      const user = userEvent.setup();
      pintar();

      await user.click(screen.getByText('Demo KiramoPay'));

      await waitFor(() => expect(screen.getByPlaceholderText('Contraseña')).toBeInTheDocument());
      expect(screen.queryByText('Usuario o contraseña incorrecta')).toBeNull();
    });

    it('el limitador se avisa ahi mismo y no se avanza', async () => {
      mocks.login.mockResolvedValue({ success: false, code: 'RATE_LIMITED' });
      const user = userEvent.setup();
      pintar();

      await user.click(screen.getByText('Demo KiramoPay'));

      await waitFor(() =>
        expect(screen.getByText('Demasiados intentos. Espera un momento e intenta de nuevo.')).toBeInTheDocument(),
      );
      expect(screen.queryByPlaceholderText('Contraseña')).toBeNull();
    });

    // Mientras el servidor contesta (con Render despertando, decenas de
    // segundos), la tarjeta tiene que decir que esta trabajando, y "No soy yo"
    // no puede correr: la respuesta llegaria despues y volveria a guardar el
    // nombre recien olvidado, o abriria la contrasena sin identificador.
    it('mientras consulta, la tarjeta avisa y "No soy yo" espera', async () => {
      let responder: (r: { success: boolean; code?: string }) => void = () => undefined;
      mocks.login.mockImplementation(() => new Promise((r) => { responder = r; }));
      const user = userEvent.setup();
      pintar();

      const tarjeta = screen.getByText('Demo KiramoPay').closest('button')!;
      await user.click(tarjeta);

      await waitFor(() => expect(tarjeta).toBeDisabled());
      expect(tarjeta).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByRole('button', { name: es.login_no_soy_yo })).toBeDisabled();

      responder({ success: false, code: 'PASSWORD_REQUIRED' });
      await waitFor(() => expect(screen.getByPlaceholderText('Contraseña')).toBeInTheDocument());
    });

    // Una cuenta que entra sin contrasena no guarda nada en el llavero: la
    // huella la mandaba al campo de contrasena que esa cuenta no tiene.
    it('la huella sin contrasena guardada consulta antes de pedirla', async () => {
      bio.checkAvailability.mockResolvedValue({ isAvailable: true, biometryType: 'fingerprint' });
      bio.authenticate.mockResolvedValue({ success: true });
      bio.getCredentials.mockResolvedValue(null);
      mocks.login.mockImplementation(async (_id: string, password: string) => {
        if (password) return { success: false, code: 'AUTH_FAILED' };
        mocks.user = { firstName: 'Demo', lastName: 'KiramoPay', username: 'demo' };
        return { success: true };
      });
      const user = userEvent.setup();
      const onLogin = pintar();

      await user.click(await screen.findByText(es.biometric_login));

      await waitFor(() => expect(onLogin).toHaveBeenCalled());
      expect(mocks.login).toHaveBeenCalledWith('demo', '');
      expect(screen.queryByPlaceholderText('Contraseña')).toBeNull();
    });
  });
});
