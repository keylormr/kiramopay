import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '../../i18n/LanguageContext';

// Mock dataSync to avoid heavy imports
vi.mock('@/services/dataSync', () => ({
  syncAllData: vi.fn().mockResolvedValue(undefined),
}));

const mockRegister = vi.fn();

// El registro ahora habla con el backend de verdad en los pasos de telefono y
// codigo; las pruebas fijan ese contrato con la capa API simulada.
const mockSendOtp = vi.fn().mockResolvedValue({ success: true, data: { devCode: '123456' } });
const mockVerifyOtp = vi.fn().mockResolvedValue({ success: true, data: { verificationToken: 'tok-prueba' } });

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    auth: {
      sendRegistrationOtp: mockSendOtp,
      verifyRegistrationOtp: mockVerifyOtp,
    },
  }),
}));

// Mock useAuthStore
vi.mock('@/stores/auth.store', () => {
  const hook = (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      register: mockRegister,
    });
  hook.getState = () => ({ register: mockRegister });
  hook.setState = vi.fn();
  hook.subscribe = vi.fn();
  return { useAuthStore: hook };
});

// Mock useApp (needed by Icons / other indirect deps)
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

import { RegisterView } from '../auth/RegisterView';

function renderRegisterView(props?: Partial<{ onComplete: () => void; onBack: () => void }>) {
  const defaultProps = {
    onComplete: vi.fn(),
    onBack: vi.fn(),
    ...props,
  };
  return {
    ...render(
      <LanguageProvider>
        <RegisterView {...defaultProps} />
      </LanguageProvider>
    ),
    ...defaultProps,
  };
}

// Fill OTP inputs using fireEvent.change (avoids auto-focus issues with userEvent)
function fillOtp() {
  for (let i = 0; i < 6; i++) {
    const input = document.getElementById(`reg-otp-${i}`);
    if (input) {
      fireEvent.change(input, { target: { value: String(i + 1) } });
    }
  }
}

// Navigate to the password step through all preceding steps
async function navigateToPasswordStep(user: ReturnType<typeof userEvent.setup>) {
  // Step 1: Phone + email (el codigo viaja al correo)
  await user.type(screen.getByPlaceholderText('8888-0000'), '88881234');
  await user.type(screen.getByPlaceholderText(/Correo electrónico/i), 'persona@example.com');
  await user.click(screen.getByText(/Continuar/i));
  await waitFor(() => expect(screen.getByText(/Verifica tu correo/i)).toBeInTheDocument(), { timeout: 3000 });

  // Step 2: OTP
  fillOtp();
  await user.click(screen.getByText(/Verificar/i));
  await waitFor(() => expect(screen.getByText(/identificación/i)).toBeInTheDocument(), { timeout: 3000 });

  // Step 3: Cedula
  await user.type(screen.getByPlaceholderText('1'), '7');
  await user.type(screen.getByPlaceholderText('1234'), '0265');
  await user.type(screen.getByPlaceholderText('5678'), '0930');
  await user.click(screen.getByText(/Continuar/i));
  await waitFor(() => expect(screen.getByPlaceholderText(/Nombre/i)).toBeInTheDocument(), { timeout: 3000 });

  // Step 4: Name
  await user.type(screen.getByPlaceholderText(/^Nombre$/i), 'Test');
  await user.type(screen.getByPlaceholderText(/Apellido/i), 'User');
  await user.click(screen.getByText(/Continuar/i));
  await waitFor(() => expect(screen.getByText(/Crea tu contraseña/i)).toBeInTheDocument(), { timeout: 3000 });
}

describe('RegisterView', () => {
  beforeEach(() => {
    localStorage.setItem('kiramopay_language', 'es');
    mockRegister.mockReset();
  });

  it('should render step 1 (phone input)', () => {
    renderRegisterView();
    expect(screen.getByPlaceholderText('8888-0000')).toBeInTheDocument();
    expect(screen.getByText(/número de teléfono/i)).toBeInTheDocument();
  });

  it('should call onBack when clicking back on step 1', async () => {
    const user = userEvent.setup();
    const { onBack } = renderRegisterView();

    const backButtons = screen.getAllByRole('button');
    await user.click(backButtons[0]);

    expect(onBack).toHaveBeenCalled();
  });

  it('should progress from phone to OTP step', async () => {
    const user = userEvent.setup();
    renderRegisterView();

    await user.type(screen.getByPlaceholderText('8888-0000'), '88881234');
    await user.type(screen.getByPlaceholderText(/Correo electrónico/i), 'persona@example.com');
    await user.click(screen.getByText(/Continuar/i));

    await waitFor(() => {
      expect(screen.getByText(/Verifica tu correo/i)).toBeInTheDocument();
    }, { timeout: 3000 });
    // El codigo se pidio DE VERDAD, con el telefono completo y el correo.
    expect(mockSendOtp).toHaveBeenCalledWith('+50688881234', 'persona@example.com');
  });

  it('no avanza si el backend rechaza el código', async () => {
    const user = userEvent.setup();
    mockVerifyOtp.mockResolvedValueOnce({ success: false, error: { code: 'OTP_INVALID' } });
    renderRegisterView();

    await user.type(screen.getByPlaceholderText('8888-0000'), '88881234');
    await user.type(screen.getByPlaceholderText(/Correo electrónico/i), 'persona@example.com');
    await user.click(screen.getByText(/Continuar/i));
    await waitFor(() => expect(screen.getByText(/Verifica tu correo/i)).toBeInTheDocument(), { timeout: 3000 });

    fillOtp();
    await user.click(screen.getByText(/Verificar/i));

    await waitFor(() => {
      expect(screen.getByText(/Código inválido o vencido/i)).toBeInTheDocument();
    }, { timeout: 3000 });
    // Sigue en el paso del codigo: sin token no hay avance.
    expect(screen.getByText(/Verifica tu correo/i)).toBeInTheDocument();
  });

  it('should progress through all steps to password', async () => {
    const user = userEvent.setup();
    renderRegisterView();
    await navigateToPasswordStep(user);
    expect(screen.getByPlaceholderText(/^Contraseña$/i)).toBeInTheDocument();
  }, 30000);

  it('should show password strength indicator', async () => {
    const user = userEvent.setup();
    renderRegisterView();
    await navigateToPasswordStep(user);

    const passwordInput = screen.getByPlaceholderText(/^Contraseña$/i);
    await user.type(passwordInput, 'ab');
    expect(screen.getByText(/Débil/i)).toBeInTheDocument();

    await user.clear(passwordInput);
    await user.type(passwordInput, 'StrongP@ss123');
    expect(screen.getByText(/Fuerte/i)).toBeInTheDocument();
  }, 30000);

  it('should show mismatch error when passwords do not match', async () => {
    const user = userEvent.setup();
    renderRegisterView();
    await navigateToPasswordStep(user);

    await user.type(screen.getByPlaceholderText(/^Contraseña$/i), 'Password123!');
    await user.type(screen.getByPlaceholderText(/Confirmar/i), 'Different456!');

    expect(screen.getByText(/no coinciden/i)).toBeInTheDocument();
  }, 30000);

  it('should call register on successful form submission', async () => {
    mockRegister.mockResolvedValue({ success: true });

    const user = userEvent.setup();
    const { onComplete } = renderRegisterView();
    await navigateToPasswordStep(user);

    await user.type(screen.getByPlaceholderText(/^Contraseña$/i), 'StrongP@ss1');
    await user.type(screen.getByPlaceholderText(/Confirmar/i), 'StrongP@ss1');

    await user.click(screen.getByRole('button', { name: /Crear cuenta/i }));

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith({
        cedula: '702650930',
        phone: '+50688881234',
        firstName: 'Test',
        lastName: 'User',
        password: 'StrongP@ss1',
        // La cuenta nace CON correo (sin el, ni la recuperacion funciona) y
        // con la prueba de que el codigo llego a ese correo.
        email: 'persona@example.com',
        verificationToken: 'tok-prueba',
      });
      expect(onComplete).toHaveBeenCalled();
    });
  }, 30000);

  it('should show error message on registration failure', async () => {
    mockRegister.mockResolvedValue({ success: false, error: 'Cedula ya registrada' });

    const user = userEvent.setup();
    renderRegisterView();
    await navigateToPasswordStep(user);

    await user.type(screen.getByPlaceholderText(/^Contraseña$/i), 'StrongP@ss1');
    await user.type(screen.getByPlaceholderText(/Confirmar/i), 'StrongP@ss1');

    await user.click(screen.getByRole('button', { name: /Crear cuenta/i }));

    await waitFor(() => {
      expect(screen.getByText('Cedula ya registrada')).toBeInTheDocument();
    });
  }, 30000);
});
