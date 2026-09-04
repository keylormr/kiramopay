import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useGuardiaDeVersion, esErrorDeChunkViejo } from '../useGuardiaDeVersion';

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}));

// En las pruebas __BUILD_SHA__ vale 'test' (vitest.config.ts).
const SHA_QUE_CORRE = 'test';

function responder(cuerpo: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => cuerpo,
  });
}

describe('useGuardiaDeVersion', () => {
  const fetchOriginal = global.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', responder({ version: '2.3.5', sha: SHA_QUE_CORRE }));
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
