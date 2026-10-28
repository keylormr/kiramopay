import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const registrarActividad = vi.fn();
vi.mock('@/api', () => ({
  getApiLayer: () => ({ auth: { registrarActividad } }),
}));

import { useActividadDeSesion } from '../useActividadDeSesion';
import { INTERVALO_AVISO_MS } from '@/services/actividadDeSesion';

// Lo que cuenta como accion es lo que hace la PERSONA: tocar, teclear, girar la
// rueda. Una peticion de fondo (precios, sondeo de un pedido, el socket de
// avisos), un scroll programatico o volver a mostrar la pestana no son una
// accion: si avisaran, la sesion no se cerraria nunca con una pantalla de
// precios abierta.

const tocar = () => document.dispatchEvent(new Event('pointerdown', { bubbles: true }));

describe('useActividadDeSesion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
    registrarActividad.mockReset();
    registrarActividad.mockResolvedValue({ success: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('avisa al abrir la sesion: entrar o restaurarla es una accion', () => {
    renderHook(() => useActividadDeSesion(true));

    expect(registrarActividad).toHaveBeenCalledTimes(1);
  });

  it('sin sesion no avisa, aunque la persona toque la pantalla', () => {
    renderHook(() => useActividadDeSesion(false));

    tocar();

    expect(registrarActividad).not.toHaveBeenCalled();
  });

  it('un toque despues del intervalo avisa; dentro del intervalo no', async () => {
    renderHook(() => useActividadDeSesion(true));
    expect(registrarActividad).toHaveBeenCalledTimes(1);

    tocar();
    expect(registrarActividad).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVALO_AVISO_MS);
    tocar();
    expect(registrarActividad).toHaveBeenCalledTimes(2);
  });

  it.each(['keydown', 'touchstart', 'wheel'])('un %s de la persona tambien cuenta', async (tipo) => {
    renderHook(() => useActividadDeSesion(true));
    await vi.advanceTimersByTimeAsync(INTERVALO_AVISO_MS);

    document.dispatchEvent(new Event(tipo, { bubbles: true }));

    expect(registrarActividad).toHaveBeenCalledTimes(2);
  });

  it.each(['scroll', 'mousemove', 'visibilitychange', 'online', 'focus'])(
    'un %s no es una accion: no avisa',
    async (tipo) => {
      renderHook(() => useActividadDeSesion(true));
      await vi.advanceTimersByTimeAsync(INTERVALO_AVISO_MS);

      document.dispatchEvent(new Event(tipo, { bubbles: true }));
      window.dispatchEvent(new Event(tipo));

      expect(registrarActividad).toHaveBeenCalledTimes(1);
    },
  );

  it('horas con la app abierta y nadie tocandola: ni un aviso mas que el de entrada', async () => {
    renderHook(() => useActividadDeSesion(true));

    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000);

    expect(registrarActividad).toHaveBeenCalledTimes(1);
  });

  it('al cerrar la sesion deja de escuchar', async () => {
    const { rerender } = renderHook(({ conSesion }) => useActividadDeSesion(conSesion), {
      initialProps: { conSesion: true },
    });
    rerender({ conSesion: false });
    await vi.advanceTimersByTimeAsync(INTERVALO_AVISO_MS);

    tocar();

    expect(registrarActividad).toHaveBeenCalledTimes(1);
  });

  it('una sesion nueva avisa de inmediato, sin esperar el intervalo de la anterior', () => {
    const { rerender } = renderHook(({ conSesion }) => useActividadDeSesion(conSesion), {
      initialProps: { conSesion: true },
    });
    rerender({ conSesion: false });
    rerender({ conSesion: true });

    expect(registrarActividad).toHaveBeenCalledTimes(2);
  });

  it('un aviso que falla no lanza error', async () => {
    registrarActividad.mockRejectedValue(new Error('sin red'));

    expect(() => renderHook(() => useActividadDeSesion(true))).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
  });
});
