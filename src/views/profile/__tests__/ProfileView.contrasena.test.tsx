import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { useAuthStore } from '@/stores/auth.store';
import { ProfileView } from '../ProfileView';

// Cambiar la contrasena decia "Contraseña incorrecta" ante CUALQUIER rechazo:
// el adaptador pisaba el codigo del servidor, el store lo reducia a verdadero o
// falso y la pantalla elegia siempre ese texto. Quien ponia como nueva la misma
// de siempre, estaba sin red o usaba una cuenta que entra sin contrasena volvia
// a probar una contrasena actual que si sabia. La cadena se prueba desde la API:
// el store y la pantalla son los de verdad.

const mocks = vi.hoisted(() => ({ changePassword: vi.fn() }));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => ({
    auth: { changePassword: mocks.changePassword },
    kyc: { getStatus: vi.fn().mockResolvedValue({ success: false }), verifyIdentity: vi.fn() },
    loyalty: { getReferralSummary: vi.fn().mockResolvedValue({ success: false }) },
    mfa: { totpStatus: vi.fn().mockResolvedValue({ success: false }) },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      user: { id: 'u1', firstName: 'Ana', lastName: 'Mora', kycLevel: 0, email: 'a@b.co' },
      settings: { biometricEnabled: false, notifications: true, language: 'es' },
      transactions: [],
      theme: 'light',
    },
    dispatch: vi.fn(),
  }),
}));

async function cambiarContrasena() {
  const user = userEvent.setup();
  render(
    <LanguageProvider>
      <ProfileView />
    </LanguageProvider>,
  );
  await user.click(screen.getByRole('button', { name: /Cambiar contraseña/ }));
  const hoja = await screen.findByRole('dialog');
  // Teclear letra por letra con userEvent se acercaba al limite de 5 s por
  // prueba; el cambio directo dispara el mismo onChange.
  for (const campo of within(hoja).getAllByPlaceholderText('--------')) {
    fireEvent.change(campo, { target: { value: 'Kiramopay2024!' } });
  }
  await user.click(within(hoja).getByRole('button', { name: 'Cambiar contraseña' }));
  return hoja;
}

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  mocks.changePassword.mockReset();
  useAuthStore.setState({
    user: {
      id: 'u1',
      cedula: '702650930',
      phone: '+50688880000',
      firstName: 'Ana',
      lastName: 'Mora',
      kycLevel: 0,
      createdAt: '2026-01-01T00:00:00Z',
    },
  });
});
afterEach(cleanup);

describe('ProfileView: cambiar la contrasena', () => {
  it.each([
    [
      'la nueva es igual a la actual',
      { code: 'PASSWORD_UNCHANGED', message: 'new password must differ from current' },
      'La contraseña nueva tiene que ser distinta de la actual.',
    ],
    [
      'una cuenta que entra sin contrasena',
      { code: 'DEMO_ACCOUNT', message: 'una cuenta de demostracion no puede cambiar su contrasena' },
      'Esta cuenta de demostración entra sin contraseña y no puede fijar una.',
    ],
    [
      'sin conexion',
      { code: 'NETWORK_ERROR', message: 'No pudimos conectar con KiramoPay. Revisa tu conexión e intenta de nuevo.' },
      'No pudimos conectar con KiramoPay. Revisa tu conexión e intenta de nuevo.',
    ],
    [
      'un error del servidor',
      { code: 'CHANGE_PASSWORD_FAILED', message: 'internal server error' },
      'No pudimos cambiar tu contraseña. Intenta de nuevo.',
    ],
  ])('%s no dice "Contraseña incorrecta"', async (_caso, error, esperado) => {
    mocks.changePassword.mockResolvedValue({ success: false, error });

    const hoja = await cambiarContrasena();

    expect(await within(hoja).findByText(esperado)).toBeInTheDocument();
    expect(within(hoja).queryByText('Contraseña incorrecta')).toBeNull();
  });

  it('la actual equivocada sigue diciendo "Contraseña incorrecta"', async () => {
    mocks.changePassword.mockResolvedValue({
      success: false,
      error: { code: 'CURRENT_PASSWORD_INVALID', message: 'invalid current password' },
    });

    const hoja = await cambiarContrasena();

    expect(await within(hoja).findByText('Contraseña incorrecta')).toBeInTheDocument();
  });
});

// Cada aviso va junto al campo al que se refiere. Con un solo lugar, bajo la
// contrasena actual, "la nueva tiene que ser distinta" pintaba de rojo justo la
// que la persona tenia bien, y no se borraba al corregir la nueva.
describe('ProfileView: cada aviso de la contrasena en su lugar', () => {
  it('la nueva igual a la actual se avisa en la contrasena nueva y se borra al cambiarla', async () => {
    mocks.changePassword.mockResolvedValue({
      success: false,
      error: { code: 'PASSWORD_UNCHANGED', message: 'new password must differ from current' },
    });
    const aviso = 'La contraseña nueva tiene que ser distinta de la actual.';

    const hoja = await cambiarContrasena();
    const [actual, nueva] = within(hoja).getAllByPlaceholderText('--------');

    await within(hoja).findByText(aviso);
    expect(nueva).toHaveAccessibleDescription(aviso);
    expect(actual).not.toHaveAccessibleDescription(aviso);

    fireEvent.change(nueva, { target: { value: 'OtraClave2024!' } });
    expect(within(hoja).queryByText(aviso)).toBeNull();
  });

  it('la actual equivocada se avisa en la contrasena actual', async () => {
    mocks.changePassword.mockResolvedValue({
      success: false,
      error: { code: 'CURRENT_PASSWORD_INVALID', message: 'invalid current password' },
    });

    const hoja = await cambiarContrasena();
    const [actual, nueva] = within(hoja).getAllByPlaceholderText('--------');

    await within(hoja).findByText('Contraseña incorrecta');
    expect(actual).toHaveAccessibleDescription('Contraseña incorrecta');
    expect(nueva).not.toHaveAccessibleDescription('Contraseña incorrecta');
  });

  it('un rechazo que no es de ningun campo se avisa aparte, no bajo la contrasena actual', async () => {
    mocks.changePassword.mockResolvedValue({
      success: false,
      error: { code: 'DEMO_ACCOUNT', message: 'una cuenta de demostracion no puede cambiar su contrasena' },
    });
    const aviso = 'Esta cuenta de demostración entra sin contraseña y no puede fijar una.';

    const hoja = await cambiarContrasena();
    const [actual] = within(hoja).getAllByPlaceholderText('--------');

    expect(await within(hoja).findByRole('alert')).toHaveTextContent(aviso);
    expect(actual).not.toHaveAccessibleDescription(aviso);
  });
});
