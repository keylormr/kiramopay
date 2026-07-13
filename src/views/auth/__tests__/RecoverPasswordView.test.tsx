import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { setApiLayer } from '@/api';
import type { ApiLayer } from '@/api';
import { RecoverPasswordView } from '../RecoverPasswordView';

const mockForgot = vi.fn();
const mockReset = vi.fn();

function renderView(props?: Partial<{ onClose: () => void; initialCedula: string }>) {
  const defaultProps = { onClose: vi.fn(), ...props };
  return {
    ...render(
      <LanguageProvider>
        <RecoverPasswordView {...defaultProps} />
      </LanguageProvider>,
    ),
    ...defaultProps,
  };
}

describe('RecoverPasswordView', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    mockForgot.mockReset();
    mockReset.mockReset();
    setApiLayer({
      auth: { forgotPassword: mockForgot, resetPassword: mockReset },
    } as unknown as ApiLayer);
  });

  it('renders the request step', () => {
    renderView();
    expect(screen.getByText('Recuperar contraseña')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ej: 702650930')).toBeInTheDocument();
  });

  it('requests a reset code and advances to the reset step', async () => {
    mockForgot.mockResolvedValue({ success: true, data: {} });
    const user = userEvent.setup();
    renderView({ initialCedula: '702650930' });

    await user.click(screen.getByText('Enviar instrucciones'));

    await waitFor(() => {
      expect(mockForgot).toHaveBeenCalledWith('702650930');
      expect(screen.getByText('Crea tu nueva contraseña')).toBeInTheDocument();
    });
  });

  it('resets the password and shows the success step', async () => {
    mockReset.mockResolvedValue({ success: true, data: { reset: true } });
    const user = userEvent.setup();
    renderView();

    // Skip straight to the reset step via "I already have a code".
    await user.click(screen.getByText('Ya tengo un código'));

    await user.type(screen.getByPlaceholderText('Pega el código aquí'), 'reset-token-123');
    await user.type(screen.getByPlaceholderText('Contrasena'), 'NewPass2024!');
    await user.type(screen.getByPlaceholderText('Confirmar contraseña'), 'NewPass2024!');
    await user.click(screen.getByText('Restablecer contraseña'));

    await waitFor(() => {
      expect(mockReset).toHaveBeenCalledWith('reset-token-123', 'NewPass2024!');
      expect(screen.getByText('¡Listo!')).toBeInTheDocument();
    });
  });

  it('keeps submit disabled while passwords do not match', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByText('Ya tengo un código'));

    await user.type(screen.getByPlaceholderText('Pega el código aquí'), 'tok');
    await user.type(screen.getByPlaceholderText('Contrasena'), 'NewPass2024!');
    await user.type(screen.getByPlaceholderText('Confirmar contraseña'), 'Different1!');

    expect(screen.getByText('Restablecer contraseña').closest('button')).toBeDisabled();
    expect(mockReset).not.toHaveBeenCalled();
  });

  it('closes on the back button', async () => {
    const user = userEvent.setup();
    const { onClose } = renderView();
    await user.click(screen.getByLabelText('Volver'));
    expect(onClose).toHaveBeenCalled();
  });
});
