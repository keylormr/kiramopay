// La intro de Ergane al abrir la web: solo en la web, una vez por navegador, con
// los datos de KiramoPay tomados del propio codigo, y sin dejar nunca a la app
// esperando. El modulo de Ergane (ergane-intro.js) se prueba aparte, en su
// fuente; aca se prueba cuando y con que se le llama.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const falso = vi.hoisted(() => ({
  nativa: false,
  mostrar: vi.fn(),
  // Mientras no se abra, el import() del modulo no resuelve (un trozo lento).
  puerta: null as Promise<void> | null,
}));

type Envoltorio = typeof import('../introDeErgane');

/** Un modulo nuevo en cada prueba: el import() y el estado de la pagina no se heredan. */
async function cargar(): Promise<Envoltorio> {
  vi.resetModules();
  vi.doMock('@capacitor/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@capacitor/core')>()),
    Capacitor: { isNativePlatform: () => falso.nativa, getPlatform: () => (falso.nativa ? 'android' : 'web') },
  }));
  vi.doMock('../ergane-intro.js', async () => {
    if (falso.puerta) await falso.puerta;
    return { mostrarIntroErgane: falso.mostrar };
  });
  return import('../introDeErgane');
}

beforeEach(() => {
  falso.nativa = false;
  falso.puerta = null;
  falso.mostrar.mockReset();
  falso.mostrar.mockResolvedValue('mostrada');
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

describe('cuando sale la intro de Ergane', () => {
  it('en la web, a quien no la ha visto, la arma con los datos de KiramoPay', async () => {
    const { armarIntroDeErgane, DESTINO_KIRAMOPAY, CLAVE_INTRO_ERGANE } = await cargar();

    await armarIntroDeErgane();

    expect(falso.mostrar).toHaveBeenCalledTimes(1);
    const opciones = falso.mostrar.mock.calls[0][0];
    expect(opciones.destino).toBe(DESTINO_KIRAMOPAY);
    expect(opciones.clave).toBe(CLAVE_INTRO_ERGANE);
    // La Trama sale como archivo del mismo origen, que es lo que el CSP deja pedir.
    expect(typeof opciones.marcaErgane).toBe('string');
    expect(opciones.marcaErgane).not.toMatch(/^data:/);
    // Una ruta de archivo (en la build lleva el hash; en las pruebas, el query de Vite).
    expect(opciones.marcaErgane).toMatch(/^\/.*trama[^/?]*\.svg(\?.*)?$/);
  });

  it('en Android e iOS no sale: esas apps ya tienen su intro de la K', async () => {
    falso.nativa = true;
    const { armarIntroDeErgane, laIntroDeErganeAplica } = await cargar();

    expect(laIntroDeErganeAplica()).toBe(false);
    await armarIntroDeErgane();

    expect(falso.mostrar).not.toHaveBeenCalled();
  });

  it('a quien ya la vio no se la muestra', async () => {
    localStorage.setItem('ergane-intro-vista', '1');
    const { armarIntroDeErgane, laIntroDeErganeAplica } = await cargar();

    expect(laIntroDeErganeAplica()).toBe(false);
    await armarIntroDeErgane();

    expect(falso.mostrar).not.toHaveBeenCalled();
  });

  it('con ?intro-ergane=1 sale siempre, aunque ya la haya visto', async () => {
    localStorage.setItem('ergane-intro-vista', '1');
    window.history.replaceState({}, '', '/?intro-ergane=1');
    const { armarIntroDeErgane } = await cargar();

    await armarIntroDeErgane();

    expect(falso.mostrar).toHaveBeenCalledTimes(1);
  });

  it('con ?intro-ergane=1 no sale en la app instalada', async () => {
    falso.nativa = true;
    window.history.replaceState({}, '', '/?intro-ergane=1');
    const { armarIntroDeErgane } = await cargar();

    await armarIntroDeErgane();

    expect(falso.mostrar).not.toHaveBeenCalled();
  });

  it('sin almacenamiento disponible igual sale', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('almacenamiento bloqueado');
    });
    const { armarIntroDeErgane } = await cargar();

    await armarIntroDeErgane();

    expect(falso.mostrar).toHaveBeenCalledTimes(1);
  });
});

describe('la app nunca queda esperando a la intro', () => {
  it('si el modulo falla al armarse, la app pinta igual', async () => {
    falso.mostrar.mockImplementation(() => {
      throw new Error('no pudo armar la capa');
    });
    const { armarIntroDeErgane } = await cargar();

    await expect(armarIntroDeErgane()).resolves.toBeUndefined();
  });

  it('si el modulo rechaza despues, no queda un error sin atender', async () => {
    falso.mostrar.mockRejectedValue(new Error('three no cargo'));
    const { armarIntroDeErgane } = await cargar();

    await expect(armarIntroDeErgane()).resolves.toBeUndefined();
    // Deja correr la promesa rechazada: si nadie la atendiera, vitest falla la corrida.
    await new Promise((resolver) => setTimeout(resolver, 0));
  });

  it('si el modulo tarda mas de 2,5 s, la app pinta sin intro y la intro tardia no aparece encima', async () => {
    vi.useFakeTimers();
    let abrir!: () => void;
    falso.puerta = new Promise<void>((resolver) => {
      abrir = resolver;
    });
    const { armarIntroDeErgane } = await cargar();

    let lista = false;
    void armarIntroDeErgane().then(() => {
      lista = true;
    });
    await vi.advanceTimersByTimeAsync(2499);
    expect(lista).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(lista).toBe(true);

    abrir();
    await vi.advanceTimersByTimeAsync(10);
    expect(falso.mostrar).not.toHaveBeenCalled();
  });

  it('si el modulo llega a tiempo, la app espera solo a que la capa este puesta', async () => {
    vi.useFakeTimers();
    let abrir!: () => void;
    falso.puerta = new Promise<void>((resolver) => {
      abrir = resolver;
    });
    // La intro misma dura segundos: la promesa de mostrarIntroErgane no se espera.
    falso.mostrar.mockReturnValue(new Promise(() => {}));
    const { armarIntroDeErgane } = await cargar();

    let lista = false;
    void armarIntroDeErgane().then(() => {
      lista = true;
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(lista).toBe(false);

    abrir();
    await vi.advanceTimersByTimeAsync(10);
    expect(falso.mostrar).toHaveBeenCalledTimes(1);
    expect(lista).toBe(true);
  });
});

// Se leen los archivos porque jsdom no aplica el CSS ni sirve public/.
describe('los datos de KiramoPay salen del propio codigo', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'index.css'), 'utf8');
  const token = (nombre: string) => new RegExp(`--${nombre}:\\s*([^;\\s]+);`).exec(css)?.[1];

  it('fondo y tintas son los del tema oscuro de index.css', async () => {
    const { DESTINO_KIRAMOPAY } = await cargar();

    expect(DESTINO_KIRAMOPAY.fondo).toBe(token('color-background-dark'));
    expect(DESTINO_KIRAMOPAY.tinta).toBe(token('color-text-primary-dark'));
    expect(DESTINO_KIRAMOPAY.tintaSuave).toBe(token('color-text-secondary-dark'));
  });

  it('la letra es la de la app y la marca es el icono del sitio', async () => {
    const { DESTINO_KIRAMOPAY } = await cargar();

    expect(DESTINO_KIRAMOPAY.fuente).toBe('var(--font-sans)');
    expect(token('font-sans')).toBeUndefined(); // lleva comas y comillas: no es un solo valor
    expect(css).toMatch(/--font-sans:\s*"Geist"/);
    expect(DESTINO_KIRAMOPAY.marca).toEqual({ tipo: 'svg', url: '/icon.svg' });
    expect(existsSync(join(process.cwd(), 'public', 'icon.svg'))).toBe(true);
  });

  it('el nombre, el area y el dominio son los del producto', async () => {
    const { DESTINO_KIRAMOPAY } = await cargar();
    const manifiesto = JSON.parse(readFileSync(join(process.cwd(), 'public', 'manifest.json'), 'utf8')) as {
      name: string;
    };

    expect(DESTINO_KIRAMOPAY.nombre).toBe(manifiesto.name);
    expect(DESTINO_KIRAMOPAY.area).toBe('Pagos');
    expect(DESTINO_KIRAMOPAY.dominio).toBe('kiramopay.com');
  });
});
