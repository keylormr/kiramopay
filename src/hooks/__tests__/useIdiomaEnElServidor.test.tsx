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
  refreshNotifications: vi.fn(),
  usuario: null as null | { id: string; language?: string | null },
  token: 'token' as string | null,
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ auth: { setLanguage: mocks.setLanguage } }),
}));

vi.mock('@/services/dataSync', () => ({ refreshNotifications: mocks.refreshNotifications }));

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
    mocks.refreshNotifications.mockResolvedValue(undefined);
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

  // El idioma de la cuenta es el de la persona; el del navegador es una
  // adivinanza. La pantalla de arranque (que corre ANTES de saber quien entra)
  // salia en el que adivino el navegador aunque la cuenta tuviera otro: Chrome
  // en ingles, cuenta en espanol, "The server is waking up". Con la cuenta ya
  // conocida, la pantalla pasa a su idioma y el dispositivo lo recuerda.
  describe('el idioma de la cuenta manda sobre el que adivino el navegador', () => {
    beforeEach(() => {
      localStorage.clear(); // nadie eligio: el navegador de la prueba esta en ingles
    });

    it('sin eleccion en este dispositivo, la pantalla pasa al idioma de la cuenta', async () => {
      mocks.usuario = { id: 'u1', language: 'fr' };
      const { result } = montar();
      await waitFor(() => expect(result.current.language).toBe('fr'));
      // Sigue sin ser una eleccion de la persona, y por eso no se manda de vuelta.
      expect(result.current.elegido).toBe(false);
      await esperar();
      expect(mocks.setLanguage).not.toHaveBeenCalled();
    });

    it('el arranque siguiente ya sale en ese idioma, antes de saber quien es', async () => {
      mocks.usuario = { id: 'u1', language: 'fr' };
      const primera = montar();
      await waitFor(() => expect(primera.result.current.language).toBe('fr'));
      primera.unmount();

      // Arranque en frio: el perfil todavia no se cargo.
      mocks.usuario = null;
      const segunda = montar();
      expect(segunda.result.current.language).toBe('fr');
      expect(segunda.result.current.elegido).toBe(false);
    });

    it('lo que la persona eligio en este dispositivo manda sobre el de la cuenta', async () => {
      localStorage.setItem('kiramopay_language', 'ja');
      mocks.usuario = { id: 'u1', language: 'fr' };
      const { result } = montar();
      await esperar();
      expect(result.current.language).toBe('ja');
    });

    it('una cuenta sin idioma deja la pantalla como esta', async () => {
      mocks.usuario = { id: 'u1', language: null };
      const { result } = montar();
      await esperar();
      expect(result.current.language).toBe('en');
    });

    it('un idioma de la cuenta que la app no tiene se ignora', async () => {
      mocks.usuario = { id: 'u1', language: 'de' };
      const { result } = montar();
      await esperar();
      expect(result.current.language).toBe('en');
    });

    it('si despues la persona elige otro, su eleccion queda por encima del recuerdo de la cuenta', async () => {
      mocks.usuario = { id: 'u1', language: 'fr' };
      const primera = montar();
      await waitFor(() => expect(primera.result.current.language).toBe('fr'));
      act(() => primera.result.current.setLanguage('ja'));
      await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('ja'));
      primera.unmount();

      mocks.usuario = null;
      const segunda = montar();
      expect(segunda.result.current.language).toBe('ja');
      expect(segunda.result.current.elegido).toBe(true);
    });
  });

  // Los avisos de la campana se piden en el idioma de la pantalla (?lang=): al
  // cambiar de idioma la lista que ya estaba cargada seguiria en el anterior.
  describe('los avisos de la campana siguen al idioma de la pantalla', () => {
    it('al cambiar de idioma con sesion, vuelve a pedirlos', async () => {
      mocks.usuario = { id: 'u1', language: 'en' };
      const { result } = montar();
      await esperar();
      expect(mocks.refreshNotifications).not.toHaveBeenCalled();

      act(() => result.current.setLanguage('ja'));
      await waitFor(() => expect(mocks.refreshNotifications).toHaveBeenCalledTimes(1));
    });

    it('al abrir la app no los pide de mas: ya los trajo la sincronizacion', async () => {
      mocks.usuario = { id: 'u1', language: 'en' };
      montar();
      await esperar();
      expect(mocks.refreshNotifications).not.toHaveBeenCalled();
    });

    it('sin sesion no los pide', async () => {
      const { result } = montar();
      act(() => result.current.setLanguage('ja'));
      await esperar();
      expect(mocks.refreshNotifications).not.toHaveBeenCalled();
    });

    it('volver a elegir el mismo idioma no los pide otra vez', async () => {
      mocks.usuario = { id: 'u1', language: 'en' };
      const { result } = montar();
      act(() => result.current.setLanguage('en'));
      await esperar();
      expect(mocks.refreshNotifications).not.toHaveBeenCalled();
    });

    it('si la cuenta pasa la pantalla a su idioma, tambien los pide en ese', async () => {
      localStorage.clear();
      mocks.usuario = { id: 'u1', language: 'fr' };
      montar();
      await waitFor(() => expect(mocks.refreshNotifications).toHaveBeenCalledTimes(1));
    });
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
