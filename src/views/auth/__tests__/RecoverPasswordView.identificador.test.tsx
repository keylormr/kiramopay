import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { setApiLayer } from '@/api';
import type { ApiLayer } from '@/api';
import { RecoverPasswordView } from '../RecoverPasswordView';

// La recuperacion aceptaba SOLO cedula: filtraba a digitos y exigia nueve. Con
// el login por nombre de usuario eso se volvio una trampa —quien entra con su
// usuario no tenia forma de pedir la recuperacion— y encima el servidor
// respondia 202 "te enviamos instrucciones" sin consultar nada: un mensaje de
// exito para un correo que no iba a llegar nunca.
const mockForgot = vi.fn();

const CAMPO = 'Usuario, cédula, correo o teléfono';

function pintar() {
  render(
    <LanguageProvider>
      <RecoverPasswordView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

describe('RecoverPasswordView: acepta los mismos identificadores que el login', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    mockForgot.mockReset();
    mockForgot.mockResolvedValue({ success: true, data: {} });
    setApiLayer({ auth: { forgotPassword: mockForgot, resetPassword: vi.fn() } } as unknown as ApiLayer);
  });

  it.each([
    ['un nombre de usuario', 'keilor', 'keilor'],
    ['un nombre de usuario en mayusculas, canonicalizado', 'Keilor', 'keilor'],
    ['un correo', 'a@b.co', 'a@b.co'],
    ['un telefono', '88880001', '+50688880001'],
    ['una cedula con guiones', '1-2345-6789', '123456789'],
  ])('acepta %s', async (_caso, tecleado, esperado) => {
    const user = userEvent.setup();
    pintar();

    await user.type(screen.getByPlaceholderText(CAMPO), tecleado);
    await user.click(screen.getByText('Enviar instrucciones'));

    await waitFor(() => expect(mockForgot).toHaveBeenCalledWith(esperado));
  });

  it('no manda nada si lo tecleado no clasifica en ninguna forma', async () => {
    const user = userEvent.setup();
    pintar();

    await user.type(screen.getByPlaceholderText(CAMPO), 'no clasifica');
    expect(screen.getByText('Enviar instrucciones').closest('button')).toBeDisabled();
    expect(mockForgot).not.toHaveBeenCalled();
  });
});
