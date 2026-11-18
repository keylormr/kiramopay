import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cada plataforma escucha su propio evento (ver segundoPlano.ts): en Android
// 'pause' tambien llega con los dialogos del sistema y en iOS appStateChange
// tambien llega con el dialogo del rostro, y ninguno de los dos es salir de la app.
const app = vi.hoisted(() => ({
  oyentes: new Map<string, (dato?: unknown) => void>(),
  remover: vi.fn(),
  plataforma: 'android',
  nativa: true,
}));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn((evento: string, f: (dato?: unknown) => void) => {
      app.oyentes.set(evento, f);
      return Promise.resolve({ remove: app.remover });
    }),
  },
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => app.nativa, getPlatform: () => app.plataforma },
}));

import { alPasarASegundoPlano } from '../segundoPlano';

function visibilidad(estado: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => estado });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  app.oyentes.clear();
  app.remover.mockReset().mockResolvedValue(undefined);
  app.plataforma = 'android';
  app.nativa = true;
  visibilidad('visible');
});

describe('pasar la app a segundo plano', () => {
  it('en Android solo cuenta que la app deje de estar activa, no una pausa', () => {
    const alIrse = vi.fn();
    const parar = alPasarASegundoPlano(alIrse);
    expect([...app.oyentes.keys()]).toEqual(['appStateChange']);

    app.oyentes.get('appStateChange')?.({ isActive: true });
    expect(alIrse).not.toHaveBeenCalled();
    app.oyentes.get('appStateChange')?.({ isActive: false });
    expect(alIrse).toHaveBeenCalledTimes(1);
    parar();
  });

  it('en iOS escucha pause (didEnterBackground), no appStateChange', () => {
    app.plataforma = 'ios';
    const alIrse = vi.fn();
    const parar = alPasarASegundoPlano(alIrse);
    expect([...app.oyentes.keys()]).toEqual(['pause']);

    app.oyentes.get('pause')?.();
    expect(alIrse).toHaveBeenCalledTimes(1);
    parar();
  });

  it('si la pagina deja de verse, tambien cuenta', () => {
    const alIrse = vi.fn();
    const parar = alPasarASegundoPlano(alIrse);
    visibilidad('visible');
    expect(alIrse).not.toHaveBeenCalled();
    visibilidad('hidden');
    expect(alIrse).toHaveBeenCalledTimes(1);
    parar();
  });

  it('al dejar de escuchar quita los oyentes y ya no avisa', async () => {
    const alIrse = vi.fn();
    const parar = alPasarASegundoPlano(alIrse);
    parar();
    await vi.waitFor(() => expect(app.remover).toHaveBeenCalledTimes(1));
    visibilidad('hidden');
    app.oyentes.get('appStateChange')?.({ isActive: false });
    expect(alIrse).not.toHaveBeenCalled();
  });

  it('en la web no escucha nada', () => {
    app.nativa = false;
    const alIrse = vi.fn();
    const parar = alPasarASegundoPlano(alIrse);
    visibilidad('hidden');
    expect(app.oyentes.size).toBe(0);
    expect(alIrse).not.toHaveBeenCalled();
    parar();
  });
});
