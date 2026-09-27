import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoginView } from '../LoginView';

// El login decia "Usuario o contraseña incorrecta" ante cualquier rechazo que
// no conocia: sin red, o con la cuenta en pausa por demasiados intentos, la
// persona volvia a teclear una contraseña que si sabia (y la pantalla se la
// borraba cada vez). La cadena se prueba desde fetch: el cliente, el
// adaptador, el store y la vista son los de verdad.

vi.mock('@/services/dataSync', () => ({ syncAllData: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { isAuthenticated: false, user: null, passwordHash: '', settings: { biometricEnabled: false } },
    dispatch: vi.fn(),
  }),
}));

vi.mock('@/stores/settings.store', () => {
  const state = () => ({ biometricEnabled: false });
  const hook = ((sel?: (s: ReturnType<typeof state>) => unknown) => (sel ? sel(state()) : state())) as unknown as {
    (sel?: unknown): unknown;
    getState: () => ReturnType<typeof state>;
  };
  hook.getState = state;
  return { useSettingsStore: hook };
});

const fetchMock = vi.fn();

const CAMPO = 'Usuario, cédula, correo o teléfono';
const INCORRECTA = 'Usuario o contraseña incorrecta';
const EN_PAUSA = 'Demasiados intentos fallidos. Por seguridad, espera 15 minutos e intenta de nuevo.';
const SIN_RED = 'No pudimos conectar con KiramoPay. Revisa tu conexión e intenta de nuevo.';

function rechazo(estado: number, code: string, message: string) {
  return { ok: false, status: estado, json: async () => ({ success: false, error: { code, message } }) };
}

type Respuesta = () => Promise<unknown>;

const RESPUESTAS: Record<string, Respuesta> = {
  // El middleware responde 423 antes de mirar la contrasena.
  enPausa: async () => rechazo(423, 'ACCOUNT_LOCKED', 'account temporarily locked due to too many failed attempts'),
  sinRed: async () => {
    throw new TypeError('Failed to fetch');
  },
  errorDelServidor: async () => rechazo(500, 'INTERNAL_ERROR', 'internal server error'),
  incorrecta: async () => rechazo(401, 'AUTH_FAILED', 'invalid credentials'),
};

// El servidor contesta el sondeo (contrasena vacia) con `alSondeo` y el intento
// con contrasena con `conContrasena`.
function servidor(alSondeo: Respuesta, conContrasena: Respuesta) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    const cuerpo = JSON.parse(String(init?.body ?? '{}')) as { password?: string };
    return cuerpo.password ? conContrasena() : alSondeo();
  });
}

const pideContrasena: Respuesta = async () => rechazo(401, 'PASSWORD_REQUIRED', 'password required');

async function continuar() {
  const user = userEvent.setup();
  render(
    <LanguageProvider>
      <LoginView onLogin={vi.fn()} onRegister={vi.fn()} />
    </LanguageProvider>,
  );
  await user.type(screen.getByPlaceholderText(CAMPO), '702650930');
  await user.click(screen.getByText('Continuar'));
  return user;
}

async function entrar() {
  const user = await continuar();
  fireEvent.change(await screen.findByPlaceholderText('Contraseña'), { target: { value: 'Kiramopay2024!' } });
  await user.click(screen.getByRole('button', { name: 'Ingresar' }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginView: cada rechazo con su motivo', () => {
  it.each([
    ['la cuenta en pausa por intentos', RESPUESTAS.enPausa, EN_PAUSA],
    ['sin conexion', RESPUESTAS.sinRed, SIN_RED],
    ['un error del servidor', RESPUESTAS.errorDelServidor, 'No pudimos iniciar sesión. Intenta de nuevo en un momento.'],
  ])('%s no dice "Usuario o contraseña incorrecta"', async (_caso, respuesta, esperado) => {
    servidor(pideContrasena, respuesta);

    await entrar();

    expect(await screen.findByText(esperado)).toBeInTheDocument();
    expect(screen.queryByText(INCORRECTA)).toBeNull();
  });

  it('la contrasena equivocada sigue diciendo "Usuario o contraseña incorrecta"', async () => {
    servidor(pideContrasena, RESPUESTAS.incorrecta);

    await entrar();

    expect(await screen.findByText(INCORRECTA)).toBeInTheDocument();
  });
});

// En el paso del identificador ya se sabe que el intento con contrasena va a
// fallar igual: como con el limitador, se avisa ahi y no se pide la contrasena.
describe('LoginView: el sondeo avisa lo que no se arregla con la contrasena', () => {
  it.each([
    ['la cuenta en pausa por intentos', RESPUESTAS.enPausa, EN_PAUSA],
    ['sin conexion', RESPUESTAS.sinRed, SIN_RED],
  ])('%s se avisa sin pedir la contrasena', async (_caso, respuesta, esperado) => {
    servidor(respuesta, respuesta);

    await continuar();

    expect(await screen.findByText(esperado)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Contraseña')).toBeNull();
  });
});
