import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  useGuardiaDeVersion,
  useRecargaAutomaticaDeVersion,
  esErrorDeChunkViejo,
  MAX_RECARGAS_AUTOMATICAS,
} from '../useGuardiaDeVersion';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

// En las pruebas __BUILD_SHA__ vale 'test' (vitest.config.ts).
const SHA_QUE_CORRE = 'test';

const CLAVE_INTENTOS = 'kiramopay-guardia-version-intentos';

function responder(cuerpo: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => cuerpo,
  });
}

// jsdom no deja espiar location.replace directamente; se reemplaza el objeto
// entero por uno equivalente con el replace espiado (mismo patron que
// lazyConRecarga.test.tsx).
function espiarReplace() {
  const replace = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...window.location, replace },
    writable: true,
  });
  return replace;
}

describe('useGuardiaDeVersion', () => {
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', responder({ version: '2.3.5', sha: SHA_QUE_CORRE }));
    sessionStorage.clear();
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
    vi.restoreAllMocks();
  });

  it('no marca nada cuando el commit servido es el que corre', async () => {
    const { result } = renderHook(() => useGuardiaDeVersion());
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.desactualizada).toBe(false);
  });

  it('limpia el contador de recargas automaticas cuando la version vuelve a coincidir', async () => {
    // Quedo de un despliegue anterior que esta pestana si logro alcanzar.
    sessionStorage.setItem(CLAVE_INTENTOS, String(MAX_RECARGAS_AUTOMATICAS));
    const { result } = renderHook(() => useGuardiaDeVersion());

    await waitFor(() => expect(result.current.desactualizada).toBe(false));
    // El proximo despliegue debe tener su cupo de intentos completo otra vez.
    expect(sessionStorage.getItem(CLAVE_INTENTOS)).toBeNull();
  });

  it('marca desactualizada cuando el commit servido es otro', async () => {
    vi.stubGlobal('fetch', responder({ version: '2.4.0', sha: 'otro123' }));
    const { result } = renderHook(() => useGuardiaDeVersion());

    await waitFor(() => expect(result.current.desactualizada).toBe(true));
    expect(result.current.versionDesplegada).toBe('2.4.0');
  });

  it('pregunta esquivando cualquier cache intermedia', async () => {
    renderHook(() => useGuardiaDeVersion());
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    const [url, opciones] = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    // Sin el parametro irrepetible, el CDN puede devolver la copia vieja y la
    // comprobacion no serviria de nada.
    expect(url).toMatch(/^\/version\.json\?t=/);
    expect(opciones.cache).toBe('no-store');
  });

  it('no marca nada si no se puede preguntar: no saber no es estar viejo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')));
    const { result } = renderHook(() => useGuardiaDeVersion());

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.desactualizada).toBe(false);
  });

  it('ignora una respuesta que no trae version ni commit', async () => {
    // Pasa cuando el servidor devuelve el index.html en vez del archivo.
    vi.stubGlobal('fetch', responder({ algo: 'otra cosa' }));
    const { result } = renderHook(() => useGuardiaDeVersion());

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.desactualizada).toBe(false);
  });
});

describe('useRecargaAutomaticaDeVersion', () => {
  const locationOriginal = window.location;

  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { value: locationOriginal, writable: true });
    vi.restoreAllMocks();
  });

  it('con la version al dia no hace nada', () => {
    const replace = espiarReplace();
    const { result } = renderHook(() => useRecargaAutomaticaDeVersion(false));

    expect(result.current).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('recarga sola, sin pedir nada, la primera vez que se detecta vieja', async () => {
    const replace = espiarReplace();
    const { result } = renderHook(() => useRecargaAutomaticaDeVersion(true));

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(result.current).toBe(false);
    expect(sessionStorage.getItem(CLAVE_INTENTOS)).toBe('1');
  });

  it(`se rinde despues de ${MAX_RECARGAS_AUTOMATICAS} intentos en la misma pestana`, async () => {
    sessionStorage.setItem(CLAVE_INTENTOS, String(MAX_RECARGAS_AUTOMATICAS));
    const replace = espiarReplace();
    const { result } = renderHook(() => useRecargaAutomaticaDeVersion(true));

    await waitFor(() => expect(result.current).toBe(true));
    expect(replace).not.toHaveBeenCalled();
  });

  it('sin sessionStorage se rinde de una vez, sin insistir en un bucle', async () => {
    const espia = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const replace = espiarReplace();
    const { result } = renderHook(() => useRecargaAutomaticaDeVersion(true));

    await waitFor(() => expect(result.current).toBe(true));
    expect(replace).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  it('si se puede leer pero no guardar el intento, se rinde en vez de recargar sin contar', async () => {
    // Cupo de storage agotado, por ejemplo: la lectura no revienta (sigue
    // devolviendo null porque nunca se guardo nada), asi que sin este caso
    // cada intento se verfa a si mismo como "el primero" y recargaria para
    // siempre sin que el tope lo note.
    const espia = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cupo agotado');
    });
    const replace = espiarReplace();
    const { result } = renderHook(() => useRecargaAutomaticaDeVersion(true));

    await waitFor(() => expect(result.current).toBe(true));
    expect(replace).not.toHaveBeenCalled();
    espia.mockRestore();
  });
});

describe('useGuardiaDeVersion + useRecargaAutomaticaDeVersion: dos despliegues en la misma pestana', () => {
  const fetchOriginal = global.fetch;
  const locationOriginal = window.location;

  function useGuardiaConRecargaAutomatica() {
    const { desactualizada, versionDesplegada } = useGuardiaDeVersion();
    const agotada = useRecargaAutomaticaDeVersion(desactualizada);
    return { desactualizada, versionDesplegada, agotada };
  }

  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    global.fetch = fetchOriginal;
    Object.defineProperty(window, 'location', { value: locationOriginal, writable: true });
    vi.restoreAllMocks();
  });

  it('el segundo despliegue tiene su cupo de intentos completo otra vez', async () => {
    const replace = espiarReplace();

    // Primer despliegue: esta pestana (vieja) queda atras y se recarga sola.
    vi.stubGlobal('fetch', responder({ version: '2.4.0', sha: 'otro123' }));
    const primera = renderHook(() => useGuardiaConRecargaAutomatica());
    await waitFor(() => expect(primera.result.current.desactualizada).toBe(true));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(primera.result.current.agotada).toBe(false);
    expect(sessionStorage.getItem(CLAVE_INTENTOS)).toBe('1');
    primera.unmount();

    // La recarga trae una pestana nueva que ya esta al dia (no se simula
    // __BUILD_SHA__ cambiando: se simula el resultado, que el servidor
    // coincide con lo que esta pestana de pruebas siempre corre).
    vi.stubGlobal('fetch', responder({ version: '2.4.0', sha: SHA_QUE_CORRE }));
    const alDia = renderHook(() => useGuardiaDeVersion());
    await waitFor(() => expect(alDia.result.current.desactualizada).toBe(false));
    expect(sessionStorage.getItem(CLAVE_INTENTOS)).toBeNull();
    alDia.unmount();

    // Mas tarde, un segundo despliegue en la misma pestana (sessionStorage no
    // se borro: solo se borra al cerrar la pestana, no al navegar).
    vi.stubGlobal('fetch', responder({ version: '2.5.0', sha: 'masnuevo456' }));
    const segunda = renderHook(() => useGuardiaConRecargaAutomatica());
    await waitFor(() => expect(segunda.result.current.desactualizada).toBe(true));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
    // Si el contador no se hubiera limpiado, este ya seria el segundo intento
    // y a dos despliegues de distancia de rendirse sin haber hecho nada malo.
    expect(sessionStorage.getItem(CLAVE_INTENTOS)).toBe('1');
    expect(segunda.result.current.agotada).toBe(false);
  });
});

describe('esErrorDeChunkViejo', () => {
  it('reconoce el fallo de import dinamico de cada navegador', () => {
    const reales = [
      new Error('Failed to fetch dynamically imported module: https://kiramopay.com/assets/HomeView-abc123.js'),
      new TypeError('error loading dynamically imported module'),
      new Error('Importing a module script failed.'),
    ];
    for (const e of reales) {
      expect(esErrorDeChunkViejo(e), e.message).toBe(true);
    }
  });

  it('no confunde un error cualquiera de la aplicacion', () => {
    const ajenos = [
      new TypeError("Cannot read properties of undefined (reading 'balance')"),
      new Error('Network request failed'),
      new Error('Unexpected token < in JSON at position 0'),
      null,
      undefined,
    ];
    for (const e of ajenos) {
      expect(esErrorDeChunkViejo(e)).toBe(false);
    }
  });
});
