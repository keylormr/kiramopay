// Cuando se muestra la intro y cual: solo en la app instalada, una distinta en
// cada apertura por turno, y con "reducir movimiento" solo un fundido.
import { useRef } from 'react';
import { act, render, screen } from '@testing-library/react';

const falso = vi.hoisted(() => ({ nativa: true }));
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  Capacitor: { isNativePlatform: () => falso.nativa, getPlatform: () => (falso.nativa ? 'android' : 'web') },
}));

const {
  TURNO,
  alTerminarLaIntro,
  decidirIntro,
  introEnCurso,
  reiniciarIntroParaPruebas,
  terminarIntro,
  tomarElControlDeLaIntro,
  tomarTurno,
  useEnfocarAlTerminarLaIntro,
} = await import('../arranqueDeLaIntro');

function almacenFalso(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
  };
}

let menosMovimiento = false;
beforeEach(() => {
  falso.nativa = true;
  menosMovimiento = false;
  localStorage.clear();
  // Con relojes falsos: la cota de 5 s de una prueba no puede caer en la siguiente.
  vi.useFakeTimers();
  reiniciarIntroParaPruebas();
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') && menosMovimiento, media: q }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('el turno', () => {
  it('va Ventana, Cierre, K en 3D y vuelve a empezar', () => {
    const almacen = almacenFalso();
    const vistas = Array.from({ length: 7 }, () => tomarTurno(almacen));
    expect(vistas).toEqual(['ventana', 'cierre', 'giro', 'ventana', 'cierre', 'giro', 'ventana']);
    expect(TURNO).toEqual(['ventana', 'cierre', 'giro']);
  });

  it('un valor roto o un almacenamiento que falla no la traban: empieza por la primera', () => {
    expect(tomarTurno(almacenFalso({ kiramopay_intro_turno: 'basura' }))).toBe('ventana');
    expect(tomarTurno(almacenFalso({ kiramopay_intro_turno: '-1' }))).toBe('ventana');
    expect(tomarTurno(almacenFalso({ kiramopay_intro_turno: '7' }))).toBe('cierre');
    const roto = { getItem: () => { throw new Error('sin acceso'); }, setItem: () => { throw new Error('lleno'); } };
    expect(tomarTurno(roto)).toBe('ventana');
    expect(tomarTurno(null)).toBe('ventana');
  });
});

describe('decidirIntro', () => {
  it('en la web no hay intro', () => {
    falso.nativa = false;
    expect(decidirIntro()).toBeNull();
    expect(introEnCurso()).toBe(false);
    expect(localStorage.getItem('kiramopay_intro_turno')).toBeNull();
  });

  it('en el telefono toma el turno una sola vez por arranque', () => {
    const primera = decidirIntro();
    expect(primera).toEqual({ concepto: 'ventana' });
    expect(introEnCurso()).toBe(true);
    // La app se vuelve a pintar: misma decision, el turno no avanza dos veces.
    expect(decidirIntro()).toBe(primera);
    expect(localStorage.getItem('kiramopay_intro_turno')).toBe('1');

    reiniciarIntroParaPruebas();
    expect(decidirIntro()).toEqual({ concepto: 'cierre' });
    reiniciarIntroParaPruebas();
    expect(decidirIntro()).toEqual({ concepto: 'giro' });
  });

  it('con "reducir movimiento" es el fundido, y el turno queda donde estaba', () => {
    menosMovimiento = true;
    expect(decidirIntro()).toEqual({ concepto: 'reducido' });
    expect(localStorage.getItem('kiramopay_intro_turno')).toBeNull();
  });

  it('si la intro nunca llega a irse, a los 5 s se da por terminada', () => {
    decidirIntro();
    const oyente = vi.fn();
    alTerminarLaIntro(oyente);
    vi.advanceTimersByTime(4999);
    expect(introEnCurso()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(introEnCurso()).toBe(false);
    expect(oyente).toHaveBeenCalledTimes(1);
  });

  it('una vez montada, la intro maneja sus tiempos y la cota no la corta', () => {
    decidirIntro();
    tomarElControlDeLaIntro();
    vi.advanceTimersByTime(6000);
    expect(introEnCurso()).toBe(true);
  });
});

describe('alTerminarLaIntro', () => {
  it('avisa una sola vez a cada uno, y ya mismo si no hay intro', () => {
    reiniciarIntroParaPruebas({ enCurso: true });
    const a = vi.fn();
    const b = vi.fn();
    alTerminarLaIntro(a);
    const quitarB = alTerminarLaIntro(b);
    quitarB();
    terminarIntro();
    terminarIntro();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    const c = vi.fn();
    alTerminarLaIntro(c);
    expect(c).toHaveBeenCalledTimes(1);
  });
});

function Campo({ otro = false }: { otro?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  useEnfocarAlTerminarLaIntro(ref);
  return (
    <>
      <input ref={ref} aria-label="usuario" autoFocus={!introEnCurso()} />
      {otro && <input aria-label="otro" />}
    </>
  );
}

describe('el foco del login', () => {
  it('sin intro, el campo toma el foco al aparecer, como siempre', () => {
    render(<Campo />);
    expect(screen.getByLabelText('usuario')).toHaveFocus();
  });

  it('con la intro encima, el teclado espera a que termine', () => {
    reiniciarIntroParaPruebas({ enCurso: true });
    render(<Campo />);
    expect(screen.getByLabelText('usuario')).not.toHaveFocus();
    act(() => terminarIntro());
    expect(screen.getByLabelText('usuario')).toHaveFocus();
  });

  it('si la persona ya toco otro campo, no le quita el foco', () => {
    reiniciarIntroParaPruebas({ enCurso: true });
    render(<Campo otro />);
    screen.getByLabelText('otro').focus();
    act(() => terminarIntro());
    expect(screen.getByLabelText('otro')).toHaveFocus();
  });
});
