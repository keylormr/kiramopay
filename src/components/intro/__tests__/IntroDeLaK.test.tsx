// La intro en pantalla: toma el relevo del splash sin hueco, se va sola a
// tiempo, un toque la salta y nunca queda nada encima de la app.
import { act, fireEvent, render } from '@testing-library/react';

const falso = vi.hoisted(() => ({
  plataforma: 'android',
  hide: vi.fn(async (_o?: { fadeOutDuration?: number }) => undefined),
}));
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => true, getPlatform: () => falso.plataforma },
}));
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide: falso.hide } }));

const { default: IntroDeLaK } = await import('../IntroDeLaK');
const { introEnCurso, reiniciarIntroParaPruebas } = await import('../arranqueDeLaIntro');

interface AnimacionFalsa {
  capa: Element;
  cuadros: Keyframe[];
  opciones: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  onfinish: (() => void) | null;
  finished: Promise<unknown>;
}
let animaciones: AnimacionFalsa[] = [];
let primeraAnimacion = Infinity;
// El mismo contador que usan los vi.fn para ordenar sus llamadas.
const marca = vi.fn();
const orden = () => {
  marca();
  return marca.mock.invocationCallOrder.at(-1)!;
};
const animateOriginal = Element.prototype.animate;

beforeEach(() => {
  vi.useFakeTimers();
  falso.plataforma = 'android';
  falso.hide.mockClear();
  animaciones = [];
  primeraAnimacion = Infinity;
  reiniciarIntroParaPruebas({ enCurso: true });
  Element.prototype.animate = function (this: Element, cuadros: Keyframe[], opciones: KeyframeAnimationOptions) {
    // Como una animacion de verdad: termina al cumplir su duracion, salvo que la pausen.
    let pausada = false;
    const finished = new Promise((listo) => setTimeout(() => !pausada && listo(undefined), Number(opciones.duration)));
    const a: AnimacionFalsa = { capa: this, cuadros, opciones, cancel: vi.fn(), pause: vi.fn(() => { pausada = true; }), onfinish: null, finished };
    if (!animaciones.length) primeraAnimacion = orden();
    animaciones.push(a);
    return a as unknown as Animation;
  } as typeof Element.prototype.animate;
});
afterEach(() => {
  Element.prototype.animate = animateOriginal;
  vi.useRealTimers();
});

const capa = () => document.querySelector('[data-intro]');

describe('IntroDeLaK', () => {
  it('en Android quita el splash enseguida, con la K ya armada debajo, y anima despues', async () => {
    render(<IntroDeLaK concepto="ventana" />);
    expect(capa()).not.toBeNull();
    expect(capa()!.querySelector('.kpi-hueco')).not.toBeNull();
    expect(capa()!.getAttribute('aria-hidden')).toBe('true');
    expect(falso.hide).toHaveBeenCalledTimes(1);
    expect(falso.hide.mock.calls[0][0]).toBeUndefined();
    expect(animaciones).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(130);
    });
    expect(animaciones.length).toBeGreaterThan(0);
    expect(animaciones.every((a) => a.opciones.duration === 1050 && a.opciones.fill === 'both')).toBe(true);
  });

  it('se va sola al terminar y deja la app libre', async () => {
    render(<IntroDeLaK concepto="cierre" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(130);
    });
    expect(capa()).not.toBeNull();
    const enMarcha = [...animaciones];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1450 + 40);
    });
    expect(capa()).toBeNull();
    expect(introEnCurso()).toBe(false);
    // No deja animaciones vivas detras.
    enMarcha.forEach((a) => expect(a.cancel).toHaveBeenCalled());
  });

  it('espera a que las animaciones terminen de verdad, con una cota si nunca terminan', async () => {
    const original = Element.prototype.animate;
    // Un telefono que no logra pintar: las animaciones no terminan nunca.
    Element.prototype.animate = function () {
      return { cancel: vi.fn(), pause: vi.fn(), finished: new Promise(() => {}) } as unknown as Animation;
    } as typeof Element.prototype.animate;
    render(<IntroDeLaK concepto="ventana" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(130 + 1050 + 100);
    });
    // Con el reloj viejo ya se habria ido sin haberse visto.
    expect(capa()).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(capa()).toBeNull();
    Element.prototype.animate = original;
  });

  it('si el telefono tarda en dar sus primeros cuadros, la K se funde sin animarse', async () => {
    let ahora = 1000;
    const reloj = vi.spyOn(performance, 'now').mockImplementation(() => ahora);
    render(<IntroDeLaK concepto="giro" />);
    // Arranque muy cargado: los primeros cuadros llegan 3 s despues.
    ahora = 4000;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(130);
    });
    // Solo el fundido de la capa entera; la K no llego a moverse.
    expect(animaciones).toHaveLength(1);
    expect(animaciones[0].cuadros.at(-1)).toMatchObject({ opacity: 0 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(capa()).toBeNull();
    expect(introEnCurso()).toBe(false);
    reloj.mockRestore();
  });

  it('si la intro ya se habia dado por terminada, no tapa nada', async () => {
    reiniciarIntroParaPruebas({ enCurso: false });
    render(<IntroDeLaK concepto="ventana" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(capa()).toBeNull();
    expect(animaciones).toHaveLength(0);
  });

  it('en iOS espera el primer cuadro pintado y quita el splash sin fundido', async () => {
    falso.plataforma = 'ios';
    render(<IntroDeLaK concepto="giro" />);
    expect(falso.hide).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(130);
    });
    expect(falso.hide).toHaveBeenCalledWith({ fadeOutDuration: 0 });
    expect(animaciones.length).toBeGreaterThan(0);
    // Primero se fue el splash y recien despues empezo a moverse.
    const quitoElSplash = falso.hide.mock.invocationCallOrder[0];
    expect(quitoElSplash).toBeLessThan(primeraAnimacion);
  });

  it('un toque la funde y la quita', async () => {
    render(<IntroDeLaK concepto="ventana" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(130);
    });
    const enMarcha = animaciones.length;
    fireEvent.pointerDown(capa()!);
    const salida = animaciones.at(-1)!;
    expect(animaciones).toHaveLength(enMarcha + 1);
    expect(salida.capa).toBe(capa());
    expect(salida.cuadros.at(-1)).toMatchObject({ opacity: 0 });
    animaciones.slice(0, enMarcha).forEach((a) => expect(a.pause).toHaveBeenCalled());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(capa()).toBeNull();
    expect(introEnCurso()).toBe(false);
  });

  it('un toque antes de que empiece a moverse tambien la salta', async () => {
    render(<IntroDeLaK concepto="ventana" />);
    fireEvent.pointerDown(capa()!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(capa()).toBeNull();
  });

  it('si la app pasa a segundo plano, al volver no queda nada encima', async () => {
    render(<IntroDeLaK concepto="giro" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(130);
    });
    const estado = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    estado.mockRestore();
    expect(capa()).toBeNull();
  });

  it('sin animaciones en el navegador, se quita sin trabar el arranque', async () => {
    Element.prototype.animate = undefined as unknown as typeof Element.prototype.animate;
    render(<IntroDeLaK concepto="ventana" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(130);
    });
    expect(capa()).toBeNull();
    expect(falso.hide).toHaveBeenCalled();
  });
});
