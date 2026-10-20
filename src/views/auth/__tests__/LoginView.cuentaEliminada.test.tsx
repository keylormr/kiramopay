import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { useAuthStore } from '@/stores/auth.store';
import { LoginView } from '../LoginView';

// Quien pide eliminar su cuenta vuelve al login: tiene que ver cuando se elimina
// y que puede reactivarla hasta ese dia (si no, parece que la app lo expulso sin
// motivo), y el login lleva a la politica de privacidad, que Google Play exige
// dentro de la app.

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

const abrirPublico = vi.hoisted(() => vi.fn());
vi.mock('@/utils/enlacesLegales', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  abrirPublico,
}));

const pintar = () =>
  render(
    <LanguageProvider>
      <LoginView onLogin={vi.fn()} onRegister={vi.fn()} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  abrirPublico.mockReset();
  useAuthStore.setState({ logoutReason: null, seEliminaEl: null });
});
afterEach(cleanup);

describe('LoginView — cuenta eliminada y politica de privacidad', () => {
  it('avisa cuando se elimina la cuenta y que se puede reactivar, y el aviso se puede cerrar', async () => {
    useAuthStore.setState({ logoutReason: 'deleted', seEliminaEl: '2026-11-17T18:00:00Z' });
    const user = userEvent.setup();
    pintar();

    expect(screen.getByText('Tu cuenta se eliminará')).toBeInTheDocument();
    const cuerpo = screen.getByText(/Se elimina el/);
    expect(cuerpo).toHaveTextContent('17 de noviembre de 2026');
    expect(cuerpo).toHaveTextContent(/reactivarla/);
    // No es el aviso de cuenta bloqueada.
    expect(screen.queryByText('Cuenta bloqueada')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByText('Tu cuenta se eliminará')).toBeNull();
  });

  it('trae la respuesta escrita: que se suprime el dia 30, que se conserva por ley y hasta cuando, y la PRODHAB', () => {
    useAuthStore.setState({ logoutReason: 'deleted', seEliminaEl: '2026-11-17T18:00:00Z' });
    pintar();

    const respuesta = screen.getByRole('region', { name: 'Lo que pasa con tus datos' });
    expect(respuesta).toHaveTextContent('17 de noviembre de 2026');
    expect(respuesta).toHaveTextContent(/contactos/);
    expect(respuesta).toHaveTextContent(/Ley 7786/);
    // Cinco anos desde el dia 30, nunca otro plazo.
    expect(respuesta).toHaveTextContent('17 de noviembre de 2031');
    expect(respuesta).toHaveTextContent(/PRODHAB/);
    expect(respuesta).toHaveTextContent(/por correo/);
    expect(respuesta.textContent ?? '').not.toMatch(/\bUIF\b|\bROS\b|sospechos|10 años|diez años/i);
  });

  it('la respuesta se puede copiar para guardarla', async () => {
    useAuthStore.setState({ logoutReason: 'deleted', seEliminaEl: '2026-11-17T18:00:00Z' });
    // userEvent instala su propio portapapeles: se espia despues de crearlo.
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    pintar();

    await user.click(screen.getByRole('button', { name: 'Copiar la respuesta' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('17 de noviembre de 2031'));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('PRODHAB'));
    expect(await screen.findByText('Respuesta copiada')).toBeInTheDocument();
  });

  it('sin la fecha (un servidor que no la mando) el aviso dice el plazo', () => {
    useAuthStore.setState({ logoutReason: 'deleted', seEliminaEl: null });
    pintar();
    expect(screen.getByText(/Se elimina en 30 días/)).toBeInTheDocument();
  });

  it('sin motivo de salida no hay aviso', () => {
    pintar();
    expect(screen.queryByText('Tu cuenta se eliminará')).toBeNull();
  });

  it('el login enlaza la politica de privacidad', async () => {
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Política de privacidad' }));
    expect(abrirPublico).toHaveBeenCalledWith('/privacidad');
  });
});
