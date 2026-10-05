import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { MfaChallengeSheet } from '../MfaChallengeSheet';

const mocks = vi.hoisted(() => ({ totpVerify: vi.fn() }));
vi.mock('@/api', () => ({ getApiLayer: () => ({ mfa: { totpVerify: mocks.totpVerify } }) }));

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LanguageProvider>{children}</LanguageProvider>
);

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  mocks.totpVerify.mockReset();
});

describe('MfaChallengeSheet', () => {
  // Cerrar la hoja con el código en vuelo no detenía la verificación: si el
  // servidor lo daba por bueno, onVerified llegaba igual, y quien había
  // cancelado veía salir el envío, con una llave nueva (cancelar la soltaba).
  it('con el código en vuelo la hoja no se cierra: el onClose no llega y el onVerified sí', async () => {
    let responder!: (valor: unknown) => void;
    mocks.totpVerify.mockReturnValue(
      new Promise((r) => {
        responder = r;
      }),
    );
    const onClose = vi.fn();
    const onVerified = vi.fn();
    const user = userEvent.setup();
    render(<MfaChallengeSheet isOpen onClose={onClose} onVerified={onVerified} confirmLabel="Verificar y enviar" />, {
      wrapper: Wrapper,
    });

    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verificar y enviar' }));
    await waitFor(() => expect(mocks.totpVerify).toHaveBeenCalledTimes(1));

    await user.click(screen.getByLabelText(/cerrar/i));
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    responder({ success: true, data: { verified: true } });
    await waitFor(() => expect(onVerified).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });

  // Lo que guarda la hoja abierta es solo el código en vuelo: sin él, o
  // cuando el código no sirvió, cerrar sigue cerrando.
  it('sin nada en vuelo, la X cierra', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MfaChallengeSheet isOpen onClose={onClose} onVerified={vi.fn()} />, { wrapper: Wrapper });

    await user.click(screen.getByLabelText(/cerrar/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('si el código no sirvió, la X vuelve a cerrar', async () => {
    mocks.totpVerify.mockResolvedValue({ success: false, error: { code: 'INVALID_CODE', message: 'Código inválido' } });
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<MfaChallengeSheet isOpen onClose={onClose} onVerified={vi.fn()} confirmLabel="Verificar y enviar" />, {
      wrapper: Wrapper,
    });

    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verificar y enviar' }));
    expect(await screen.findByText('Código inválido')).toBeInTheDocument();

    await user.click(screen.getByLabelText(/cerrar/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
