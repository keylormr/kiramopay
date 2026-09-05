import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoginView } from '../auth/LoginView';

// Create a shared mock login function
const mockLogin = vi.fn();
let mockUser: Record<string, unknown> | null = null;
// Motivo de la ultima expulsion (bloqueo remoto) y su descarte.
let mockLogoutReason: 'blocked' | null = null;
const mockClearLogoutReason = vi.fn();

// Mock dataSync to avoid heavy imports
vi.mock('@/services/dataSync', () => ({
  syncAllData: vi.fn().mockResolvedValue(undefined),
}));

// Mock useApp to avoid the Zustand hook chain
vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      isAuthenticated: false,
      user: null,
      passwordHash: '',
      settings: { biometricEnabled: false },
    },
    dispatch: vi.fn(),
  }),
}));

// Mock useAuthStore — needs to be a callable function (Zustand hook) AND have getState().
// La vista lee logoutReason/clearLogoutReason con selector, asi que el hook lo respeta.
vi.mock('@/stores/auth.store', () => {
  const state = () => ({
    isAuthenticated: false,
    user: mockUser,
    passwordHash: '',
    login: mockLogin,
    logoutReason: mockLogoutReason,
    clearLogoutReason: mockClearLogoutReason,
  });
  const hook = (selector?: (s: ReturnType<typeof state>) => unknown) =>
    selector ? selector(state()) : state();
  hook.getState = state;
  hook.setState = vi.fn();
  hook.subscribe = vi.fn();
  return { useAuthStore: hook };
});

function renderLoginView(props?: Partial<{ onLogin: () => void; onRegister: () => void }>) {
  const defaultProps = {
    onLogin: vi.fn(),
    onRegister: vi.fn(),
    ...props,
  };
  return {
    ...render(
      <LanguageProvider>
        <LoginView {...defaultProps} />
      </LanguageProvider>,
    ),
    ...defaultProps,
  };
}

describe('LoginView', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    mockLogin.mockReset();
    // El servidor responde PASSWORD_REQUIRED al sondeo con la contrasena vacia
    // que la pantalla hace para saber si esta cuenta entra sin ella. Sin este
    // comportamiento en el mock, el sondeo "entraria" y el campo de contrasena
    // no se renderizaria nunca: la suite estaria probando otra cosa.
    mockLogin.mockImplementation(async (_id: string, password: string) =>
      password ? { success: true } : { success: false, code: 'PASSWORD_REQUIRED' },
    );
    mockClearLogoutReason.mockReset();
    mockUser = null;
    mockLogoutReason = null;
  });

  it('should render the login form with the identifier input', () => {
    renderLoginView();
    expect(screen.getByPlaceholderText('Usuario, cédula, correo o teléfono')).toBeInTheDocument();
    expect(screen.getByText('Bienvenido')).toBeInTheDocument();
  });

  it('acepta correo y teléfono como identificador y deshabilita Continuar con basura', async () => {
    const user = userEvent.setup();
    renderLoginView();

    const input = screen.getByPlaceholderText('Usuario, cédula, correo o teléfono');
    const continueBtn = screen.getByText('Continuar').closest('button');

    // Basura: no clasifica en ninguna de las CUATRO formas y Continuar queda
    // deshabilitado. Ojo: 'hola' ya no sirve de ejemplo — desde que existe el
    // nombre de usuario, es un identificador valido.
    await user.type(input, 'no clasifica');
    expect(continueBtn).toBeDisabled();

    // Correo válido: habilita y muestra el tipo detectado
    await user.clear(input);
    await user.type(input, 'keilor@example.com');
    expect(continueBtn).not.toBeDisabled();
    expect(screen.getByText('Vas a entrar con tu correo')).toBeInTheDocument();

    // Teléfono de 8 dígitos: habilita
    await user.clear(input);
    await user.type(input, '88880001');
    expect(continueBtn).not.toBeDisabled();
    expect(screen.getByText('Vas a entrar con tu teléfono')).toBeInTheDocument();
  });

  it('should show password input after entering cédula', async () => {
    const user = userEvent.setup();
    renderLoginView();

    const input = screen.getByPlaceholderText('Usuario, cédula, correo o teléfono');
    await user.type(input, '702650930');

    const continueBtn = screen.getByText('Continuar');
    await user.click(continueBtn);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Contraseña')).toBeInTheDocument();
    });
  });

  it('should call auth store login on submit', async () => {
    // After login succeeds, getState returns user
    mockLogin.mockImplementation(async (_id: string, password: string) => {
      if (!password) return { success: false, code: 'PASSWORD_REQUIRED' };
      mockUser = { firstName: 'Keilor', lastName: 'Martinez', cedula: '702650930' };
      return { success: true };
    });

    const user = userEvent.setup();
    const { onLogin } = renderLoginView();

    // Enter cédula
    const cedulaInput = screen.getByPlaceholderText('Usuario, cédula, correo o teléfono');
    await user.type(cedulaInput, '702650930');
    await user.click(screen.getByText('Continuar'));

    // Wait for password stage
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Contraseña')).toBeInTheDocument();
    });

    // Enter password and submit
    const passwordInput = screen.getByPlaceholderText('Contraseña');
    await user.type(passwordInput, 'Kiramopay2024!');
    await user.click(screen.getByText('Ingresar'));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('702650930', 'Kiramopay2024!');
      expect(onLogin).toHaveBeenCalled();
    });
  });

  it('should show test users info', () => {
    renderLoginView();
    // El recuadro lista por NOMBRE DE USUARIO, que es lo que se dicta en una
    // demostracion; la cedula sigue sirviendo pero ya nadie la teclea.
    expect(screen.getByText(/keilor/)).toBeInTheDocument();
    expect(screen.getByText(/demo/)).toBeInTheDocument();
  });

  describe('cuenta bloqueada por un administrador', () => {
    it('muestra el aviso con role=alert cuando la sesion se cerro por bloqueo', async () => {
      mockLogoutReason = 'blocked';
      const user = userEvent.setup();
      renderLoginView();

      const aviso = screen.getByRole('alert');
      expect(aviso).toHaveTextContent('Cuenta bloqueada');
      expect(aviso).toHaveTextContent(
        'Un administrador bloqueó el acceso a esta cuenta. Si crees que es un error, escribe a soporte.',
      );

      // La X descarta el aviso.
      await user.click(screen.getByLabelText('Cerrar'));
      expect(mockClearLogoutReason).toHaveBeenCalledTimes(1);
    });

    it('no muestra el aviso cuando no hay motivo de expulsion', () => {
      renderLoginView();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText('Cuenta bloqueada')).not.toBeInTheDocument();
    });

    it('un login rechazado con ACCOUNT_BLOCKED muestra el mensaje especifico, no el generico', async () => {
      mockLogin.mockResolvedValue({ success: false, code: 'ACCOUNT_BLOCKED' });
      const user = userEvent.setup();
      const { onLogin } = renderLoginView();

      await user.type(screen.getByPlaceholderText('Usuario, cédula, correo o teléfono'), '702650930');
      await user.click(screen.getByText('Continuar'));
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Contraseña')).toBeInTheDocument();
      });
      await user.type(screen.getByPlaceholderText('Contraseña'), 'Kiramopay2024!');
      await user.click(screen.getByText('Ingresar'));

      await waitFor(() => {
        expect(screen.getByText('Esta cuenta está bloqueada. Escribe a soporte.')).toBeInTheDocument();
      });
      expect(screen.queryByText('Usuario o contraseña incorrecta')).not.toBeInTheDocument();
      expect(onLogin).not.toHaveBeenCalled();
    });
  });
});
