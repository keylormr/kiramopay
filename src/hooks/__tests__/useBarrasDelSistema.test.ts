// Las barras del sistema siguen a lo que muestra la app. Lo que mas importa:
// en oscuro (el tema por defecto) los iconos son claros siempre, y en claro
// solo se oscurecen si la pagina pasa por debajo de las barras; si no, detras
// queda la ventana nativa, que es oscura, y unos iconos oscuros no se verian.
import { renderHook, waitFor } from '@testing-library/react';

const falso = vi.hoisted(() => ({
  s: { nativa: true, plataforma: 'android' },
  SystemBars: { setStyle: vi.fn(async () => undefined) },
  StatusBar: { setStyle: vi.fn(async () => undefined) },
}));

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  Capacitor: {
    isNativePlatform: () => falso.s.nativa,
    getPlatform: () => falso.s.plataforma,
  },
  SystemBars: falso.SystemBars,
}));
vi.mock('@capacitor/status-bar', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/status-bar')>()),
  StatusBar: falso.StatusBar,
}));

const {
  tintaDeLasBarras,
  aplicarColoresDelSistema,
  useBarrasDelSistema,
  useSuperficieOscura,
  reiniciarBarrasParaPruebas,
  FONDO_OSCURO,
  FONDO_CLARO,
} = await import('../useBarrasDelSistema');

const raiz = document.documentElement;
const LADOS = ['top', 'right', 'bottom', 'left'];

function meta(): HTMLMetaElement {
  let m = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!m) {
    m = document.createElement('meta');
    m.name = 'theme-color';
    document.head.appendChild(m);
  }
  return m;
}

/** Lo ultimo que se le pidio a cada plugin. */
function ultimaTinta() {
  const sb = falso.SystemBars.setStyle.mock.calls.at(-1) as unknown[] | undefined;
  const st = falso.StatusBar.setStyle.mock.calls.at(-1) as unknown[] | undefined;
  return { systemBars: sb?.[0], statusBar: st?.[0] };
}

beforeEach(() => {
  falso.s.nativa = true;
  falso.s.plataforma = 'android';
  falso.SystemBars.setStyle.mockClear();
  falso.SystemBars.setStyle.mockImplementation(async () => undefined);
  falso.StatusBar.setStyle.mockClear();
  for (const l of LADOS) raiz.style.removeProperty(`--safe-area-inset-${l}`);
  meta().setAttribute('content', FONDO_OSCURO);
  reiniciarBarrasParaPruebas();
});

describe('tintaDeLasBarras', () => {
  it('en oscuro, iconos claros pase lo que pase', () => {
    for (const plataforma of ['android', 'ios']) {
      for (const bajo of [true, false]) expect(tintaDeLasBarras(true, plataforma, bajo)).toBe('DARK');
    }
  });

  it('en claro en iOS, iconos oscuros (la pagina siempre pasa por debajo)', () => {
    expect(tintaDeLasBarras(false, 'ios', false)).toBe('LIGHT');
  });

  it('en claro en Android, iconos oscuros solo si la pagina pasa por debajo de las barras', () => {
    expect(tintaDeLasBarras(false, 'android', false)).toBe('DARK');
    expect(tintaDeLasBarras(false, 'android', true)).toBe('LIGHT');
  });
});

describe('aplicarColoresDelSistema', () => {
  it('en la web solo cambia el theme-color, sin tocar plugins', async () => {
    falso.s.nativa = false;
    await aplicarColoresDelSistema(false);
    expect(meta().getAttribute('content')).toBe(FONDO_CLARO);
    await aplicarColoresDelSistema(true);
    expect(meta().getAttribute('content')).toBe(FONDO_OSCURO);
    expect(falso.SystemBars.setStyle).not.toHaveBeenCalled();
    expect(falso.StatusBar.setStyle).not.toHaveBeenCalled();
  });

  it('Android en oscuro: iconos claros en las dos barras, con una sola llamada sin barra', async () => {
    await aplicarColoresDelSistema(true);
    expect(falso.SystemBars.setStyle.mock.calls).toEqual([[{ style: 'DARK' }]]);
    expect(falso.StatusBar.setStyle).toHaveBeenCalledWith({ style: 'DARK' });
  });

  it('Android en claro con un WebView rellenado (variables en 0): los iconos siguen claros', async () => {
    for (const l of LADOS) raiz.style.setProperty(`--safe-area-inset-${l}`, '0px');
    await aplicarColoresDelSistema(false);
    expect(ultimaTinta()).toEqual({ systemBars: { style: 'DARK' }, statusBar: { style: 'DARK' } });
  });

  it('Android en claro con la pagina bajo las barras: iconos oscuros, y el teclado no lo deshace', async () => {
    raiz.style.setProperty('--safe-area-inset-top', '24px');
    raiz.style.setProperty('--safe-area-inset-bottom', '48px');
    await aplicarColoresDelSistema(false);
    expect(ultimaTinta()).toEqual({ systemBars: { style: 'LIGHT' }, statusBar: { style: 'LIGHT' } });

    // Con el teclado abierto SystemBars pone la de abajo en 0.
    raiz.style.setProperty('--safe-area-inset-bottom', '0px');
    await aplicarColoresDelSistema(false);
    expect(ultimaTinta().systemBars).toEqual({ style: 'LIGHT' });
  });

  it('Android en horizontal con la barra de navegacion al costado: tambien cuenta como pagina por debajo', async () => {
    for (const l of LADOS) raiz.style.setProperty(`--safe-area-inset-${l}`, '0px');
    raiz.style.setProperty('--safe-area-inset-right', '48px');
    await aplicarColoresDelSistema(false);
    expect(ultimaTinta().systemBars).toEqual({ style: 'LIGHT' });
  });

  it('iOS en claro: iconos oscuros', async () => {
    falso.s.plataforma = 'ios';
    await aplicarColoresDelSistema(false);
    expect(ultimaTinta()).toEqual({ systemBars: { style: 'LIGHT' }, statusBar: { style: 'LIGHT' } });
  });

  it('si un plugin falla (binario viejo) no rompe nada', async () => {
    falso.SystemBars.setStyle.mockImplementation(async () => {
      throw new Error('not implemented');
    });
    await expect(aplicarColoresDelSistema(false)).resolves.toBeUndefined();
    expect(meta().getAttribute('content')).toBe(FONDO_CLARO);
  });
});

describe('useBarrasDelSistema', () => {
  it('en claro, cuando SystemBars inyecta los margenes despues, pasa a iconos oscuros', async () => {
    renderHook(() => useBarrasDelSistema(false));
    await waitFor(() => expect(falso.StatusBar.setStyle).toHaveBeenCalledWith({ style: 'DARK' }));

    raiz.style.setProperty('--safe-area-inset-top', '24px');
    await waitFor(() => expect(ultimaTinta()).toEqual({ systemBars: { style: 'LIGHT' }, statusBar: { style: 'LIGHT' } }));
  });

  it('con el tema claro, una pantalla oscura (login, bloqueo) pone las barras en oscuro mientras esta a la vista', async () => {
    raiz.style.setProperty('--safe-area-inset-top', '24px');
    renderHook(() => useBarrasDelSistema(false));
    await waitFor(() => expect(meta().getAttribute('content')).toBe(FONDO_CLARO));
    await waitFor(() => expect(ultimaTinta().systemBars).toEqual({ style: 'LIGHT' }));

    const login = renderHook(() => useSuperficieOscura());
    await waitFor(() => expect(meta().getAttribute('content')).toBe(FONDO_OSCURO));
    await waitFor(() => expect(ultimaTinta().systemBars).toEqual({ style: 'DARK' }));
    // Una segunda pantalla oscura encima y se va la primera: sigue oscuro.
    const bloqueo = renderHook(() => useSuperficieOscura());
    login.unmount();
    await waitFor(() => expect(meta().getAttribute('content')).toBe(FONDO_OSCURO));
    bloqueo.unmount();
    await waitFor(() => expect(meta().getAttribute('content')).toBe(FONDO_CLARO));
    await waitFor(() => expect(ultimaTinta().systemBars).toEqual({ style: 'LIGHT' }));

    // `activa` en false no cuenta (la pantalla de arranque cuando no arranca).
    renderHook(() => useSuperficieOscura(false));
    await new Promise((r) => setTimeout(r, 20));
    expect(meta().getAttribute('content')).toBe(FONDO_CLARO);
  });

  it('al pasar de claro a oscuro vuelve a iconos claros y al theme-color oscuro', async () => {
    raiz.style.setProperty('--safe-area-inset-top', '24px');
    const { rerender } = renderHook(({ oscuro }) => useBarrasDelSistema(oscuro), { initialProps: { oscuro: false } });
    await waitFor(() => expect(meta().getAttribute('content')).toBe(FONDO_CLARO));
    rerender({ oscuro: true });
    await waitFor(() => expect(meta().getAttribute('content')).toBe(FONDO_OSCURO));
    await waitFor(() => expect(ultimaTinta()).toEqual({ systemBars: { style: 'DARK' }, statusBar: { style: 'DARK' } }));
  });
});
