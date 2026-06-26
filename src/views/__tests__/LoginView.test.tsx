import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoginView } from '../auth/LoginView';

// Create a shared mock login function
const mockLogin = vi.fn();
let mockUser: Record<string, unknown> | null = null;

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

// Mock useAuthStore — needs to be a callable function (Zustand hook) AND have getState()
vi.mock('@/stores/auth.store', () => {
  const hook = () => ({
    isAuthenticated: false,
    user: null,
    passwordHash: '',
    login: mockLogin,
  });
  hook.getState = () => ({
    login: mockLogin,
    user: mockUser,
  });
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
    mockUser = null;
  });

  it('should render the login form with cédula input', () => {
    renderLoginView();
    expect(screen.getByPlaceholderText('Ej: 702650930')).toBeInTheDocument();
    expect(screen.getByText('Bienvenido')).toBeInTheDocument();
  });

  it('should show password input after entering cédula', async () => {
    const user = userEvent.setup();
    renderLoginView();

    const input = screen.getByPlaceholderText('Ej: 702650930');
    await user.type(input, '702650930');

    const continueBtn = screen.getByText('Continuar');
    await user.click(continueBtn);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Contrasena')).toBeInTheDocument();
    });
  });

  it('should call auth store login on submit', async () => {
    // After login succeeds, getState returns user
    mockLogin.mockImplementation(async () => {
      mockUser = { firstName: 'Keilor', lastName: 'Martinez', cedula: '702650930' };
      return { success: true };
    });

    const user = userEvent.setup();
    const { onLogin } = renderLoginView();

    // Enter cédula
    const cedulaInput = screen.getByPlaceholderText('Ej: 702650930');
    await user.type(cedulaInput, '702650930');
    await user.click(screen.getByText('Continuar'));

    // Wait for password stage
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Contrasena')).toBeInTheDocument();
    });

    // Enter password and submit
    const passwordInput = screen.getByPlaceholderText('Contrasena');
    await user.type(passwordInput, 'Kiramopay2024!');
    await user.click(screen.getByText('Ingresar'));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('702650930', 'Kiramopay2024!');
      expect(onLogin).toHaveBeenCalled();
    });
  });

  it('should show test users info', () => {
    renderLoginView();
    expect(screen.getByText(/702650930/)).toBeInTheDocument();
    expect(screen.getByText(/700000000/)).toBeInTheDocument();
  });
});
