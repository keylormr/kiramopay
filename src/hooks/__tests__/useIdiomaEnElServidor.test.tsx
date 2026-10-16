import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LanguageProvider, useLanguage } from '@/i18n/LanguageContext';
import { useIdiomaEnElServidor } from '../useIdiomaEnElServidor';

// El servidor escribe los avisos y los push en el idioma que la cuenta tiene
// guardado. La app se lo dice cuando la persona ELIGE un idioma, y la primera
// vez, si la cuenta todavia no tiene ninguno, le da el de la pantalla.
//
// Un idioma que solo adivino el navegador no pisa el de la cuenta: con el
// telefono en espanol, entrar desde una PC con Chrome en ingles dejaba los push
// del telefono en ingles.

const mocks = vi.hoisted(() => ({
  setLanguage: vi.fn(),
  usuario: null as null | { id: string; language?: string | null },
  token: 'token' as string | null,
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ auth: { setLanguage: mocks.setLanguage } }),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: mocks.usuario, accessToken: mocks.token }),
}));

const envoltura = ({ children }: { children: ReactNode }) => <LanguageProvider>{children}</LanguageProvider>;

function montar() {
  return renderHook(
    () => {
      useIdiomaEnElServidor();
      return useLanguage();
    },
    { wrapper: envoltura },
  );
}

const esperar = () => new Promise((r) => setTimeout(r, 50));

describe('useIdiomaEnElServidor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setLanguage.mockResolvedValue({ success: true });
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'en'); // la persona eligio ingles
    mocks.usuario = null;
    mocks.token = 'token';
  });

  it('al entrar, guarda el idioma que la persona eligio si el de la cuenta es otro', async () => {
    mocks.usuario = { id: 'u1', language: 'es' };
    montar();
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('en'));
    expect(mocks.setLanguage).toHaveBeenCalledTimes(1);
  });

  it('si la cuenta ya tiene el mismo, no pide nada', async () => {
    mocks.usuario = { id: 'u1', language: 'en' };
    montar();
    await esperar();
    expect(mocks.setLanguage).not.toHaveBeenCalled();
  });

  it('una cuenta sin idioma recibe el de la pantalla, aunque sea el que adivino el navegador', async () => {
    localStorage.clear(); // nadie eligio: el navegador de la prueba esta en ingles
    mocks.usuario = { id: 'u1', language: null };
    montar();
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('en'));
  });

  it('un perfil que no dice su idioma (servidor anterior) igual lo guarda', async () => {
    mocks.usuario = { id: 'u1' };
    montar();
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('en'));
  });

  it('el idioma que adivino el navegador no pisa el que la cuenta ya tiene', async () => {
    localStorage.clear();
    mocks.usuario = { id: 'u1', language: 'es' };
    montar();
    await esperar();
    expect(mocks.setLanguage).not.toHaveBeenCalled();
  });

  it('sin sesion no pide nada', async () => {
    montar();
    await esperar();
    expect(mocks.setLanguage).not.toHaveBeenCalled();
  });

  // Sin servidor configurado la sesion se guarda sin sus llaves: tras recargar
  // hay persona pero no token. El pedido salia sin Authorization, el 401 pasaba
  // por el refresco sin llave de refresco y la sesion se cerraba en cada recarga.
  it('con la persona pero sin token no pide nada', async () => {
    mocks.usuario = { id: 'u1', language: 'es' };
    mocks.token = null;
    montar();
    await esperar();
    expect(mocks.setLanguage).not.toHaveBeenCalled();
  });

  it('al cambiar de idioma lo guarda otra vez', async () => {
    mocks.usuario = { id: 'u1', language: 'en' };
    const { result } = montar();
    act(() => result.current.setLanguage('ja'));
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('ja'));
    expect(mocks.setLanguage).toHaveBeenCalledTimes(1);
  });

  // Elegir un idioma es una eleccion aunque antes lo hubiera adivinado el
  // navegador: desde ahi manda sobre el de la cuenta.
  it('elegir un idioma lo guarda aunque el anterior fuera adivinado', async () => {
    localStorage.clear();
    mocks.usuario = { id: 'u1', language: 'es' };
    const { result } = montar();
    act(() => result.current.setLanguage('fr'));
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('fr'));
  });

  // El perfil dice el idioma de cuando se cargo: tras pasar a japones, volver al
  // ingles tambien hay que guardarlo, aunque el perfil siga diciendo ingles.
  it('volver al idioma de antes tambien lo guarda', async () => {
    mocks.usuario = { id: 'u1', language: 'en' };
    const { result } = montar();
    act(() => result.current.setLanguage('ja'));
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('ja'));
    act(() => result.current.setLanguage('en'));
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenLastCalledWith('en'));
    expect(mocks.setLanguage).toHaveBeenCalledTimes(2);
  });

  // Un rechazo no se reintenta en bucle: el aviso es de mejor esfuerzo. Un
  // `rerender` a secas no vuelve a correr el efecto, asi que la prueba cambia el
  // perfil (como cuando se refresca) para que el efecto corra de nuevo.
  it('si el servidor lo rechaza, no insiste cuando el perfil se refresca', async () => {
    mocks.usuario = { id: 'u1', language: 'es' };
    mocks.setLanguage.mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR' } });
    const { rerender } = montar();
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledTimes(1));
    mocks.usuario = { id: 'u1', language: 'pt' };
    rerender();
    await esperar();
    expect(mocks.setLanguage).toHaveBeenCalledTimes(1);
  });

  // Dos cambios seguidos mandaban dos pedidos a la vez, y el servidor podia
  // quedarse con el primero si llegaba despues. El segundo espera al primero.
  it('un cambio con otro pedido en vuelo espera, y la cuenta termina en el ultimo', async () => {
    mocks.usuario = { id: 'u1', language: 'en' };
    let terminar: (v: { success: boolean }) => void = () => {};
    mocks.setLanguage.mockImplementationOnce(() => new Promise((r) => { terminar = r; }));
    const { result } = montar();
    act(() => result.current.setLanguage('ja'));
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('ja'));
    act(() => result.current.setLanguage('fr'));
    await esperar();
    expect(mocks.setLanguage).toHaveBeenCalledTimes(1);
    await act(async () => terminar({ success: true }));
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenLastCalledWith('fr'));
    expect(mocks.setLanguage).toHaveBeenCalledTimes(2);
  });
});
