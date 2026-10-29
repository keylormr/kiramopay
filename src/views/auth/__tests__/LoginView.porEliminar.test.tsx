import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { LoginView } from '../LoginView';

// Durante los 30 dias del plazo el login es la puerta de vuelta: con la
// contrasena correcta el servidor responde ACCOUNT_PENDING_DELETION con la fecha
// del cierre, la pantalla lo dice y ofrece reactivar; reactivar repite el login
// con reactivate y entra. La cadena se prueba desde fetch: el cliente, el
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
const FECHA = '2026-11-17T18:00:00Z';

type Cuerpo = { password?: string; reactivate?: boolean };

const rechazo = (estado: number, error: Record<string, unknown>) => ({
  ok: false,
  status: estado,
  json: async () => ({ success: false, error }),
});

const entra = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    success: true,
    data: {
      user: {
        id: 'u1', cedula: '702650930', username: 'maria', phone: '+50688887777',
        first_name: 'Maria', last_name: 'Rojas', email: 'maria@ejemplo.test', kyc_level: 1, status: 'active',
      },
      tokens: { access_token: 'a', refresh_token: 'r', expires_at: 0 },
    },
  }),
});

// El servidor: sin contrasena pide la contrasena; con ella responde la
// eliminacion en curso, salvo que venga reactivate.
function servidor(reactivar: (c: Cuerpo) => unknown = () => entra()) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    const c = JSON.parse(String(init?.body ?? '{}')) as Cuerpo;
    if (!c.password) return rechazo(401, { code: 'PASSWORD_REQUIRED', message: 'password required' });
    if (c.reactivate) return reactivar(c);
    return rechazo(403, { code: 'ACCOUNT_PENDING_DELETION', message: 'x', details: { deletion_due_at: FECHA } });
  });
}

const cuerpos = (): Cuerpo[] =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit | undefined)?.body ?? '{}')) as Cuerpo);

async function entrar(onLogin = vi.fn()) {
  const user = userEvent.setup();
  render(
    <LanguageProvider>
      <LoginView onLogin={onLogin} onRegister={vi.fn()} />
    </LanguageProvider>,
  );
  await user.type(screen.getByPlaceholderText(CAMPO), '702650930');
  await user.click(screen.getByText('Continuar'));
  fireEvent.change(await screen.findByPlaceholderText('Contraseña'), { target: { value: 'Kiramopay2024!' } });
  await user.click(screen.getByRole('button', { name: 'Ingresar' }));
  return user;
}

beforeEach(() => {
  // Solo el reloj: la fecha del cierre es futura o ya paso segun el dia en que
  // corra la prueba, y eso cambia el texto. Los temporizadores siguen reales.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T12:00:00Z'));
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LoginView — cuenta con la eliminacion en curso', () => {
  it('dice cuando se elimina y ofrece reactivarla, sin presentarlo como contrasena equivocada', async () => {
    servidor();
    await entrar();

    expect(await screen.findByText('Tu cuenta se va a eliminar')).toBeInTheDocument();
    expect(screen.getByText(/se elimina el/)).toHaveTextContent('17 de noviembre de 2026');
    expect(screen.getByRole('button', { name: 'Reactivar mi cuenta' })).toBeInTheDocument();
    expect(screen.queryByText('Usuario o contraseña incorrecta')).toBeNull();
    // Todavia no se pidio reactivar.
    expect(cuerpos().some((c) => c.reactivate)).toBe(false);
  });

  it('repite la respuesta escrita debajo de las opciones, con hasta cuando se conserva', async () => {
    servidor();
    await entrar();

    await screen.findByText('Tu cuenta se va a eliminar');
    const respuesta = screen.getByRole('region', { name: 'Lo que pasa con tus datos' });
    expect(respuesta).toHaveTextContent(/Ley 7786/);
    expect(respuesta).toHaveTextContent('17 de noviembre de 2031');
    expect(respuesta).toHaveTextContent(/PRODHAB/);
    // Primero la decision, despues la referencia.
    const reactivar = screen.getByRole('button', { name: 'Reactivar mi cuenta' });
    expect(reactivar.compareDocumentPosition(respuesta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('reactivar repite el login con reactivate y entra', async () => {
    servidor();
    const onLogin = vi.fn();
    const user = await entrar(onLogin);

    await user.click(await screen.findByRole('button', { name: 'Reactivar mi cuenta' }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
    const ultimo = cuerpos().at(-1);
    expect(ultimo).toMatchObject({ password: 'Kiramopay2024!', reactivate: true });
  });

  it('mantener la eliminacion cierra el aviso sin reactivar', async () => {
    servidor();
    const user = await entrar();

    await user.click(await screen.findByRole('button', { name: 'Mantener la eliminación' }));
    expect(screen.queryByText('Tu cuenta se va a eliminar')).toBeNull();
    expect(cuerpos().some((c) => c.reactivate)).toBe(false);
  });

  it('vencido el plazo sin que se cerrara, lo dice sin inventar la causa y ofrece reactivar', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      const c = JSON.parse(String(init?.body ?? '{}')) as Cuerpo;
      if (!c.password) return rechazo(401, { code: 'PASSWORD_REQUIRED', message: 'password required' });
      if (c.reactivate) return entra();
      return rechazo(403, { code: 'ACCOUNT_PENDING_DELETION', message: 'x', details: { deletion_due_at: '2026-01-10T18:00:00Z' } });
    });
    await entrar();

    expect(await screen.findByText('Tu cuenta se va a eliminar')).toBeInTheDocument();
    expect(screen.getByText(/el plazo terminó, pero todavía no se cerró/)).toBeInTheDocument();
    expect(screen.queryByText(/se elimina el/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Reactivar mi cuenta' })).toBeInTheDocument();
  });

  it('si ya no se puede reactivar (la cuenta ya se cerro) lo dice como cuenta que no puede entrar', async () => {
    servidor(() => rechazo(403, { code: 'ACCOUNT_BLOCKED', message: 'account blocked' }));
    const onLogin = vi.fn();
    const user = await entrar(onLogin);

    await user.click(await screen.findByRole('button', { name: 'Reactivar mi cuenta' }));

    expect(
      await screen.findByText(
        (_contenido, el) => el?.tagName === 'P' && el.textContent === 'Esta cuenta está bloqueada. Escribe a soporte@kiramopay.com.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivar mi cuenta' })).toBeNull();
    expect(onLogin).not.toHaveBeenCalled();
  });
});
