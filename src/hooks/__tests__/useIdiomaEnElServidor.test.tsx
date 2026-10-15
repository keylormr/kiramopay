import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { LanguageProvider, useLanguage } from '@/i18n/LanguageContext';
import { useIdiomaEnElServidor } from '../useIdiomaEnElServidor';

// El servidor escribe los avisos y los push en el idioma que la cuenta tiene
// guardado. La app se lo dice: al entrar, si el guardado no es el de la
// pantalla, y cada vez que la persona cambia de idioma.

const mocks = vi.hoisted(() => ({
  setLanguage: vi.fn(),
  usuario: null as null | { id: string; language?: string },
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ auth: { setLanguage: mocks.setLanguage } }),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: mocks.usuario }),
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

describe('useIdiomaEnElServidor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setLanguage.mockResolvedValue({ success: true });
    localStorage.setItem('kiramopay_language', 'en');
    mocks.usuario = null;
  });

  it('al entrar, guarda el idioma de la pantalla si el del servidor es otro', async () => {
    mocks.usuario = { id: 'u1', language: 'es' };
    montar();
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('en'));
    expect(mocks.setLanguage).toHaveBeenCalledTimes(1);
  });

  it('si el servidor ya tiene el mismo, no pide nada', async () => {
    mocks.usuario = { id: 'u1', language: 'en' };
    montar();
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.setLanguage).not.toHaveBeenCalled();
  });

  it('un perfil que no dice su idioma (servidor anterior) igual lo guarda', async () => {
    mocks.usuario = { id: 'u1' };
    montar();
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('en'));
  });

  it('sin sesion no pide nada', async () => {
    montar();
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.setLanguage).not.toHaveBeenCalled();
  });

  it('al cambiar de idioma lo guarda otra vez', async () => {
    mocks.usuario = { id: 'u1', language: 'en' };
    const { result } = montar();
    act(() => result.current.setLanguage('ja'));
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledWith('ja'));
    expect(mocks.setLanguage).toHaveBeenCalledTimes(1);
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

  // Un rechazo no se reintenta en bucle: el aviso es de mejor esfuerzo y la
  // pantalla no tiene que pagar una peticion por cada render.
  it('si el servidor lo rechaza, no insiste en cada render', async () => {
    mocks.usuario = { id: 'u1', language: 'es' };
    mocks.setLanguage.mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR' } });
    const { rerender } = montar();
    await waitFor(() => expect(mocks.setLanguage).toHaveBeenCalledTimes(1));
    rerender();
    rerender();
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.setLanguage).toHaveBeenCalledTimes(1);
  });
});
