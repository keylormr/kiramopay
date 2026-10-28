import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { crearAvisoDeActividad, INTERVALO_AVISO_MS } from '../actividadDeSesion';

// El servidor cierra la sesion tras 30 minutos sin una ACCION de la persona. Lo
// unico que le dice que hubo una es este aviso, asi que de aqui depende que la
// sesion no se cierre con alguien usando la app, y tambien que no se mantenga
// viva sola: solo una accion real avisa, nunca un temporizador ni una
// peticion de fondo.

describe('crearAvisoDeActividad', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-28T10:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('la primera accion avisa de inmediato', () => {
    const enviar = vi.fn().mockResolvedValue(undefined);
    const aviso = crearAvisoDeActividad({ enviar });

    aviso.alActuar();

    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('varias acciones dentro del intervalo son un solo aviso', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);
    const aviso = crearAvisoDeActividad({ enviar });

    aviso.alActuar();
    for (let i = 0; i < 50; i++) {
      await vi.advanceTimersByTimeAsync(500);
      aviso.alActuar();
    }

    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('pasado el intervalo, la siguiente accion avisa otra vez', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);
    const aviso = crearAvisoDeActividad({ enviar });

    aviso.alActuar();
    await vi.advanceTimersByTimeAsync(INTERVALO_AVISO_MS);
    aviso.alActuar();

    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it('sin acciones no avisa nunca: no hay temporizador que lo haga por su cuenta', async () => {
    const enviar = vi.fn().mockResolvedValue(undefined);
    crearAvisoDeActividad({ enviar });

    // Dos horas con la app abierta y nadie tocandola.
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);

    expect(enviar).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('un aviso todavia en camino no se duplica aunque ya haya pasado el intervalo', async () => {
    let terminar: () => void = () => {};
    const enviar = vi.fn().mockImplementation(
      () => new Promise<void>((resolver) => {
        terminar = resolver;
      }),
    );
    const aviso = crearAvisoDeActividad({ enviar });

    aviso.alActuar();
    await vi.advanceTimersByTimeAsync(INTERVALO_AVISO_MS * 2);
    aviso.alActuar();
    expect(enviar).toHaveBeenCalledTimes(1);

    terminar();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVALO_AVISO_MS);
    aviso.alActuar();
    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it('un aviso que falla no rompe nada y se reintenta con la accion siguiente tras el intervalo', async () => {
    const enviar = vi.fn().mockRejectedValue(new Error('sin red'));
    const aviso = crearAvisoDeActividad({ enviar });

    expect(() => aviso.alActuar()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    // Sin red, cada toque NO reintenta: seria una rafaga de peticiones fallidas.
    aviso.alActuar();
    expect(enviar).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVALO_AVISO_MS);
    aviso.alActuar();
    expect(enviar).toHaveBeenCalledTimes(2);
  });

  it('reiniciar hace que la proxima accion avise de inmediato (otra sesion, otro aviso)', () => {
    const enviar = vi.fn().mockResolvedValue(undefined);
    const aviso = crearAvisoDeActividad({ enviar });

    aviso.alActuar();
    aviso.reiniciar();
    aviso.alActuar();

    expect(enviar).toHaveBeenCalledTimes(2);
  });
});
