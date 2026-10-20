import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// El modulo lee Capacitor en tiempo de llamada, asi que el mock se define una
// vez y cada test cambia lo que devuelve.
const mockCapacitor = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: mockCapacitor }));
const capApp = vi.hoisted(() => ({ getInfo: vi.fn(), addListener: vi.fn() }));
vi.mock('@capacitor/app', () => ({ App: capApp }));
const capa = vi.hoisted(() => ({
  appVersion: undefined as undefined | { getLatest: ReturnType<typeof vi.fn> },
}));
vi.mock('@/api', () => ({ getApiLayer: vi.fn(() => capa) }));
// La version que corre es la de la capa web (la que trae el paquete), no la del
// APK: despues de una actualizacion interna el APK sigue diciendo la vieja.
vi.mock('@/config/version', () => ({ BUILD_VERSION: '2.7.0' }));
const live = vi.hoisted(() => ({
  ready: vi.fn(),
  getBundles: vi.fn(),
  downloadBundle: vi.fn(),
  setNextBundle: vi.fn(),
  reload: vi.fn(),
  addListener: vi.fn(),
}));
vi.mock('@capawesome/capacitor-live-update', () => ({ LiveUpdate: live }));
// La verificacion criptografica se prueba aparte (paqueteFirmado.test.ts); aca
// solo importa que hace la app con su resultado.
const firmado = vi.hoisted(() => ({ verificarManifiesto: vi.fn() }));
vi.mock('@/utils/paqueteFirmado', () => firmado);

const { esVersionMasNueva, plataformaNativa, useActualizacion, confirmarArranque, asegurarArranque, reintentos } =
  await import(
  '../useActualizacion'
);

describe('esVersionMasNueva', () => {
  it('detecta versiones mayores en cada posicion', () => {
    expect(esVersionMasNueva('2.2.1', '2.2.0')).toBe(true);
    expect(esVersionMasNueva('2.3.0', '2.2.9')).toBe(true);
    expect(esVersionMasNueva('3.0.0', '2.9.9')).toBe(true);
  });

  it('no ofrece la misma version ni una menor', () => {
    expect(esVersionMasNueva('2.2.0', '2.2.0')).toBe(false);
    expect(esVersionMasNueva('2.1.9', '2.2.0')).toBe(false);
    expect(esVersionMasNueva('1.9.9', '2.0.0')).toBe(false);
  });

  it('tolera versiones cortas y basura sin ofrecer de mas', () => {
    expect(esVersionMasNueva('2.3', '2.2.0')).toBe(true);
    expect(esVersionMasNueva('abc', '2.2.0')).toBe(false);
    expect(esVersionMasNueva('2.2.1', 'abc')).toBe(false);
  });
});

describe('plataformaNativa', () => {
  beforeEach(() => {
    mockCapacitor.isNativePlatform.mockReset();
    mockCapacitor.getPlatform.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it('en web devuelve null: el deploy llega solo, no hay nada que ofrecer', () => {
    mockCapacitor.isNativePlatform.mockReturnValue(false);
    mockCapacitor.getPlatform.mockReturnValue('web');
    expect(plataformaNativa()).toBeNull();
  });

  it('reconoce iOS', () => {
    mockCapacitor.isNativePlatform.mockReturnValue(true);
    mockCapacitor.getPlatform.mockReturnValue('ios');
    expect(plataformaNativa()).toBe('ios');
  });

  it('reconoce Android', () => {
    mockCapacitor.isNativePlatform.mockReturnValue(true);
    mockCapacitor.getPlatform.mockReturnValue('android');
    expect(plataformaNativa()).toBe('android');
  });

  it('una plataforma nativa desconocida no se trata como Android', () => {
    // Si Capacitor suma una plataforma (electron, por ejemplo), devolver
    // 'android' le ofreceria un .apk que no puede instalar. Mejor no ofrecer.
    mockCapacitor.isNativePlatform.mockReturnValue(true);
    mockCapacitor.getPlatform.mockReturnValue('electron');
    expect(plataformaNativa()).toBeNull();
  });
});

// Toda version nueva es obligatoria. La hoja de antes tenia "Despues", que la
// cerraba por 24 horas y dejaba seguir con la version vieja.
describe('useActualizacion', () => {
  let alVolver: (() => void) | undefined;
  const getLatest = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    mockCapacitor.isNativePlatform.mockReturnValue(true);
    mockCapacitor.getPlatform.mockReturnValue('android');
    capApp.getInfo.mockReset().mockResolvedValue({ version: '2.7.0', build: '17' });
    alVolver = undefined;
    capApp.addListener.mockReset().mockImplementation((evento: string, cb: () => void) => {
      if (evento === 'resume') alVolver = cb;
      return Promise.resolve({ remove: vi.fn() });
    });
    getLatest.mockReset();
    capa.appVersion = { getLatest };
  });

  const publicada = (version: string, notes?: unknown) => ({
    success: true,
    data: { version, url: 'https://ejemplo/kiramopay.apk', ...(notes === undefined ? {} : { notes }) },
  });

  it('exige la version nueva aunque antes se hubiera pospuesto', async () => {
    localStorage.setItem('kiramopay-update-pospuesta', JSON.stringify({ v: '2.8.0', t: Date.now() }));
    getLatest.mockResolvedValue(publicada('2.8.0', ['Uno']));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion?.version).toBe('2.8.0'));
  });

  it('no ofrece posponer', () => {
    getLatest.mockResolvedValue(publicada('2.7.0'));
    const { result } = renderHook(() => useActualizacion());
    expect(result.current).not.toHaveProperty('posponer');
  });

  it('trae lo que cambia en la version nueva', async () => {
    getLatest.mockResolvedValue(publicada('2.8.0', ['Uno', 'Dos']));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion).not.toBeNull());
    expect(result.current.actualizacion?.notas).toEqual(['Uno', 'Dos']);
  });

  it('sin novedades, o con novedades que no son texto, la lista queda limpia', async () => {
    getLatest.mockResolvedValue(publicada('2.8.0', ['Uno', 3, null, '  ', 'Dos']));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion).not.toBeNull());
    expect(result.current.actualizacion?.notas).toEqual(['Uno', 'Dos']);
  });

  it('un servidor que todavia no manda novedades da una lista vacia', async () => {
    getLatest.mockResolvedValue(publicada('2.8.0'));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion).not.toBeNull());
    expect(result.current.actualizacion?.notas).toEqual([]);
  });

  it('con la misma version no exige nada', async () => {
    getLatest.mockResolvedValue(publicada('2.7.0', ['Uno']));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(getLatest).toHaveBeenCalledTimes(1));
    expect(result.current.actualizacion).toBeNull();
  });

  // La app puede quedar abierta dias. Una version publicada mientras tanto
  // tambien se exige, la proxima vez que la persona vuelva a ella.
  it('al volver a la app revisa de nuevo', async () => {
    getLatest.mockResolvedValueOnce(publicada('2.7.0')).mockResolvedValueOnce(publicada('2.8.0', ['Uno']));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(getLatest).toHaveBeenCalledTimes(1));
    expect(result.current.actualizacion).toBeNull();
    expect(alVolver).toBeDefined();

    await act(async () => {
      alVolver?.();
    });
    await waitFor(() => expect(result.current.actualizacion?.version).toBe('2.8.0'));
  });

  it('borra lo que se pospuso con la version anterior del aviso', async () => {
    localStorage.setItem('kiramopay-update-pospuesta', JSON.stringify({ v: '2.8.0', t: Date.now() }));
    getLatest.mockResolvedValue(publicada('2.8.0'));
    renderHook(() => useActualizacion());
    await waitFor(() => expect(getLatest).toHaveBeenCalled());
    expect(localStorage.getItem('kiramopay-update-pospuesta')).toBeNull();
  });

  // Si la instalacion falla, la persona tiene que poder decir que version
  // tiene para pedir ayuda.
  it('dice que version esta instalada', async () => {
    getLatest.mockResolvedValue(publicada('2.8.0'));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion).not.toBeNull());
    expect(result.current.actualizacion?.instalada).toBe('2.7.0');
  });

  // Sin red al abrir, la revision no esperaba a la proxima vuelta a la app:
  // se repite en cuanto vuelve la conexion.
  it('al volver la conexion revisa de nuevo', async () => {
    getLatest
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR' } })
      .mockResolvedValueOnce(publicada('2.8.0'));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(getLatest).toHaveBeenCalledTimes(1));
    expect(result.current.actualizacion).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(result.current.actualizacion?.version).toBe('2.8.0'));
  });

  it('actualizar deja la descarga en manos del sistema', async () => {
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    getLatest.mockResolvedValue(publicada('2.8.0'));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion).not.toBeNull());
    expect(result.current.actualizacion?.via).toBe('externa');
    act(() => result.current.actualizar());
    expect(abrir).toHaveBeenCalledWith('https://ejemplo/kiramopay.apk', '_system');
    abrir.mockRestore();
  });

  it('compara contra la version de la capa web, no contra la del APK', async () => {
    // El APK dice 2.6.0, pero la capa web ya es la 2.7.0 (actualizada por dentro).
    capApp.getInfo.mockResolvedValue({ version: '2.6.0', build: '16' });
    getLatest.mockResolvedValue(publicada('2.7.0'));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(getLatest).toHaveBeenCalledTimes(1));
    expect(result.current.actualizacion).toBeNull();
  });
});

// ── Actualizacion interna ────────────────────────────────────────────────────
// Cuando la version nueva solo cambia la capa web, la app la baja por dentro,
// verifica la firma y se reinicia sola, sin bajar otro APK. Cuando cambio lo
// nativo (el manifiesto lo dice con nativaMinima) sigue por el APK.

const MANIFIESTO = {
  formato: 1,
  plataforma: 'android',
  version: '2.8.0',
  versionCode: 18,
  nativaMinima: 17,
  huellaNativa: 'h1',
  paquete: 'kiramopay-web-android.zip',
  firmaPaquete: 'ZmlybWEgZGVsIHppcA==',
  bytes: 1_000_000,
};

const WEB = {
  manifest: 'bWFuaWZpZXN0bw==',
  signature: 'ZmlybWE=',
  url: 'https://github.com/keylormr/kiramopay/releases/download/v2.8.0/kiramopay-web-android.zip',
};

const WEB_IOS = { ...WEB, url: 'https://github.com/keylormr/kiramopay/releases/download/v2.8.0/kiramopay-web-ios.zip' };

type Avance = { bundleId: string; downloadedBytes: number; totalBytes: number; progress: number };

describe('useActualizacion por dentro', () => {
  let alVolver: (() => void) | undefined;
  let alAvanzar: ((e: Avance) => void) | undefined;
  const getLatest = vi.fn();
  const originales = { ...reintentos, esperasMs: [...reintentos.esperasMs] };

  const conPaquete = (extra: Record<string, unknown> = {}) => ({
    success: true,
    data: { version: '2.8.0', url: 'https://ejemplo/kiramopay.apk', notes: ['Uno'], web: WEB, ...extra },
  });

  beforeEach(() => {
    localStorage.clear();
    reintentos.esperasMs = [0, 0, 0];
    mockCapacitor.isNativePlatform.mockReturnValue(true);
    mockCapacitor.getPlatform.mockReturnValue('android');
    capApp.getInfo.mockReset().mockResolvedValue({ version: '2.7.0', build: '17' });
    alVolver = undefined;
    capApp.addListener.mockReset().mockImplementation((evento: string, cb: () => void) => {
      if (evento === 'resume') alVolver = cb;
      return Promise.resolve({ remove: vi.fn() });
    });
    alAvanzar = undefined;
    live.addListener.mockReset().mockImplementation((evento: string, cb: (e: Avance) => void) => {
      if (evento === 'downloadBundleProgress') alAvanzar = cb;
      return Promise.resolve({ remove: vi.fn() });
    });
    live.ready.mockReset().mockResolvedValue({ previousBundleId: null, currentBundleId: null, rollback: false });
    live.getBundles.mockReset().mockResolvedValue({ bundleIds: [] });
    live.downloadBundle.mockReset().mockResolvedValue(undefined);
    live.setNextBundle.mockReset().mockResolvedValue(undefined);
    // reload() reinicia el WebView: en la prueba no vuelve nunca.
    live.reload.mockReset().mockReturnValue(new Promise(() => undefined));
    firmado.verificarManifiesto.mockReset().mockResolvedValue({ ...MANIFIESTO });
    getLatest.mockReset();
    capa.appVersion = { getLatest };
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

  afterEach(() => {
    Object.assign(reintentos, originales, { esperasMs: [...originales.esperasMs] });
  });

  it('baja el paquete firmado, lo deja listo y reinicia la app sin abrir nada', async () => {
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());

    await waitFor(() => expect(live.reload).toHaveBeenCalledTimes(1));
    expect(firmado.verificarManifiesto).toHaveBeenCalledWith({ manifest: WEB.manifest, signature: WEB.signature });
    expect(live.downloadBundle).toHaveBeenCalledWith({
      url: WEB.url,
      bundleId: 'v2.8.0',
      signature: MANIFIESTO.firmaPaquete,
    });
    expect(live.setNextBundle).toHaveBeenCalledWith({ bundleId: 'v2.8.0' });
    expect(result.current.actualizacion).toMatchObject({ via: 'interna', version: '2.8.0', fase: 'aplicando' });
    expect(abrir).not.toHaveBeenCalled();
    abrir.mockRestore();
  });

  it('muestra el avance de la descarga', async () => {
    live.downloadBundle.mockImplementation(() => new Promise(() => undefined));
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(live.downloadBundle).toHaveBeenCalled());

    await act(async () => {
      alAvanzar?.({ bundleId: 'v2.8.0', downloadedBytes: 250_000, totalBytes: 1_000_000, progress: 0.25 });
    });
    await waitFor(() =>
      expect(result.current.actualizacion).toMatchObject({
        via: 'interna',
        fase: 'descargando',
        recibidos: 250_000,
        total: 1_000_000,
      }),
    );
  });

  // Sin Content-Length el plugin no sabe el total: se usa el del manifiesto.
  it('sin total del servidor usa el tamano del manifiesto', async () => {
    live.downloadBundle.mockImplementation(() => new Promise(() => undefined));
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(live.downloadBundle).toHaveBeenCalled());

    await act(async () => {
      alAvanzar?.({ bundleId: 'v2.8.0', downloadedBytes: 400_000, totalBytes: -1, progress: -400_000 });
    });
    await waitFor(() => expect(result.current.actualizacion).toMatchObject({ recibidos: 400_000, total: 1_000_000 }));
  });

  it('si el paquete ya estaba bajado no lo baja de nuevo', async () => {
    live.getBundles.mockResolvedValue({ bundleIds: ['v2.8.0'] });
    getLatest.mockResolvedValue(conPaquete());
    renderHook(() => useActualizacion());
    await waitFor(() => expect(live.reload).toHaveBeenCalled());
    expect(live.downloadBundle).not.toHaveBeenCalled();
    expect(live.setNextBundle).toHaveBeenCalledWith({ bundleId: 'v2.8.0' });
  });

  it('un manifiesto que no pasa la firma nunca llega al plugin: va por el APK', async () => {
    firmado.verificarManifiesto.mockResolvedValue(null);
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() =>
      expect(result.current.actualizacion).toMatchObject({ via: 'externa', url: 'https://ejemplo/kiramopay.apk' }),
    );
    expect(live.downloadBundle).not.toHaveBeenCalled();
    expect(live.setNextBundle).not.toHaveBeenCalled();
  });

  it('un manifiesto de otra version no se aplica', async () => {
    firmado.verificarManifiesto.mockResolvedValue({ ...MANIFIESTO, version: '2.7.5' });
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion?.via).toBe('externa'));
    expect(live.downloadBundle).not.toHaveBeenCalled();
  });

  it('un manifiesto de la otra plataforma no se aplica', async () => {
    firmado.verificarManifiesto.mockResolvedValue({ ...MANIFIESTO, plataforma: 'ios' });
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion?.via).toBe('externa'));
    expect(live.downloadBundle).not.toHaveBeenCalled();
  });

  // El paquete necesita una parte nativa mas nueva que la del telefono.
  it('si cambio lo nativo, la version se instala por APK', async () => {
    firmado.verificarManifiesto.mockResolvedValue({ ...MANIFIESTO, nativaMinima: 18 });
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() =>
      expect(result.current.actualizacion).toMatchObject({ via: 'externa', url: 'https://ejemplo/kiramopay.apk' }),
    );
    expect(live.downloadBundle).not.toHaveBeenCalled();
  });

  it('sin saber la version nativa del telefono no se arriesga: APK', async () => {
    capApp.getInfo.mockResolvedValue({ version: '2.7.0', build: 'raro' });
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion?.via).toBe('externa'));
    expect(live.downloadBundle).not.toHaveBeenCalled();
  });

  it('una falla de descarga se reintenta sola', async () => {
    live.downloadBundle.mockRejectedValueOnce(new Error('Request timed out.')).mockResolvedValue(undefined);
    getLatest.mockResolvedValue(conPaquete());
    renderHook(() => useActualizacion());
    await waitFor(() => expect(live.reload).toHaveBeenCalledTimes(1));
    expect(live.downloadBundle).toHaveBeenCalledTimes(2);
  });

  it('si los reintentos no alcanzan, la barrera ofrece reintentar y no deja pasar', async () => {
    live.downloadBundle.mockRejectedValue(new Error('Bundle could not be downloaded.'));
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion).toMatchObject({ via: 'interna', fase: 'error' }));
    expect(live.downloadBundle).toHaveBeenCalledTimes(1 + reintentos.esperasMs.length);
    expect(live.reload).not.toHaveBeenCalled();

    live.downloadBundle.mockReset().mockResolvedValue(undefined);
    await act(async () => {
      result.current.reintentar();
    });
    await waitFor(() => expect(live.reload).toHaveBeenCalledTimes(1));
  });

  it('sin conexion espera la red y sigue sola', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    live.downloadBundle.mockRejectedValueOnce(new Error('Request timed out.'));
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion).toMatchObject({ via: 'interna', fase: 'sin_red' }));
    expect(live.downloadBundle).toHaveBeenCalledTimes(1);

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(live.reload).toHaveBeenCalledTimes(1));
  });

  it('volver a la app durante la descarga no arranca otra', async () => {
    live.downloadBundle.mockImplementation(() => new Promise(() => undefined));
    getLatest.mockResolvedValue(conPaquete());
    renderHook(() => useActualizacion());
    await waitFor(() => expect(live.downloadBundle).toHaveBeenCalledTimes(1));
    await act(async () => {
      alVolver?.();
    });
    await waitFor(() => expect(getLatest).toHaveBeenCalledTimes(2));
    expect(live.downloadBundle).toHaveBeenCalledTimes(1);
  });

  // Un paquete que no arranco (el plugin volvio al del APK) se reintenta una vez
  // mas; si vuelve a fallar, la version se instala por APK y nadie queda en un
  // ciclo de reinicios.
  it('un paquete que se revirtio dos veces se deja y se ofrece el APK', async () => {
    live.ready.mockResolvedValue({ previousBundleId: 'v2.8.0', currentBundleId: null, rollback: true });
    await confirmarArranque();
    getLatest.mockResolvedValue(conPaquete());
    const primero = renderHook(() => useActualizacion());
    await waitFor(() => expect(live.reload).toHaveBeenCalledTimes(1));
    primero.unmount();

    await confirmarArranque();
    live.reload.mockClear();
    live.downloadBundle.mockClear();
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() =>
      expect(result.current.actualizacion).toMatchObject({ via: 'externa', url: 'https://ejemplo/kiramopay.apk' }),
    );
    expect(live.downloadBundle).not.toHaveBeenCalled();
  });

  it('las fallas de una version no frenan a la siguiente', async () => {
    live.ready.mockResolvedValue({ previousBundleId: 'v2.8.0', currentBundleId: null, rollback: true });
    await confirmarArranque();
    await confirmarArranque();
    firmado.verificarManifiesto.mockResolvedValue({ ...MANIFIESTO, version: '2.8.1' });
    getLatest.mockResolvedValue(
      conPaquete({
        version: '2.8.1',
        web: { ...WEB, url: 'https://github.com/keylormr/kiramopay/releases/download/v2.8.1/kiramopay-web-android.zip' },
      }),
    );
    renderHook(() => useActualizacion());
    await waitFor(() => expect(live.reload).toHaveBeenCalledTimes(1));
    expect(live.downloadBundle).toHaveBeenCalledWith(expect.objectContaining({ bundleId: 'v2.8.1' }));
  });

  // Se dejo lista y se reinicio, pero no quedo corriendo (el proceso murio antes
  // de que el plugin la tomara, por ejemplo): tambien cuenta.
  it('si la version que se dejo lista no quedo corriendo, cuenta como falla', async () => {
    for (let i = 0; i < 2; i++) {
      localStorage.setItem('kiramopay-actualizacion-pendiente', '2.8.0');
      await confirmarArranque();
    }
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion?.via).toBe('externa'));
    expect(live.downloadBundle).not.toHaveBeenCalled();
  });

  // El efecto del hook corre antes que el de AppConGuardia: si decidiera sin
  // esperar la confirmacion de arranque, ofreceria otra vez por dentro la
  // version que el plugin acaba de revertir por segunda vez. La prueba arranca
  // con el modulo recien cargado, como una pagina nueva, y monta el hook
  // primero.
  it('la revision espera la confirmacion de arranque antes de decidir', async () => {
    vi.resetModules();
    const fresco = await import('../useActualizacion');
    let soltar: (r: unknown) => void = () => undefined;
    live.ready.mockReturnValue(
      new Promise((r) => {
        soltar = r;
      }),
    );
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => fresco.useActualizacion());
    // Despues, el efecto de AppConGuardia.
    const confirmado = fresco.asegurarArranque();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(getLatest).not.toHaveBeenCalled();
    expect(live.ready).toHaveBeenCalledTimes(1);

    localStorage.setItem('kiramopay-actualizacion-fallos', JSON.stringify({ '2.8.0': 1 }));
    soltar({ previousBundleId: 'v2.8.0', currentBundleId: null, rollback: true });
    await confirmado;
    await waitFor(() => expect(result.current.actualizacion?.via).toBe('externa'));
    expect(live.downloadBundle).not.toHaveBeenCalled();
    expect(live.ready).toHaveBeenCalledTimes(1);
  });

  // Un pendiente de otra version (se instalo un APK entre el reinicio y el
  // arranque, por ejemplo) se cuenta sin borrar lo que llevaba la version en
  // curso.
  it('una falla de otra version no borra la cuenta de la version en curso', async () => {
    localStorage.setItem('kiramopay-actualizacion-fallos', JSON.stringify({ '2.8.0': 1 }));
    localStorage.setItem('kiramopay-actualizacion-pendiente', '2.7.9');
    await confirmarArranque();
    live.ready.mockResolvedValue({ previousBundleId: 'v2.8.0', currentBundleId: null, rollback: true });
    await confirmarArranque();
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion?.via).toBe('externa'));
    expect(live.downloadBundle).not.toHaveBeenCalled();
  });

  // Si el plugin revierte sin decir que paquete fallo, el que se dejo listo es
  // el que fallo.
  it('una reversion sin id del paquete cuenta la version que se dejo lista', async () => {
    live.ready.mockResolvedValue({ previousBundleId: null, currentBundleId: null, rollback: true });
    for (let i = 0; i < 2; i++) {
      localStorage.setItem('kiramopay-actualizacion-pendiente', '2.8.0');
      await confirmarArranque();
    }
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion?.via).toBe('externa'));
    expect(live.downloadBundle).not.toHaveBeenCalled();
  });

  // El paquete solo se baja del release de esa version: un servidor que apunta
  // a otro lado no recibe el pedido del telefono (ni su identificador).
  it.each([
    ['otro host', 'https://otro.ejemplo/kiramopay-web-android.zip'],
    ['sin https', 'http://github.com/keylormr/kiramopay/releases/download/v2.8.0/kiramopay-web-android.zip'],
    ['otro repositorio', 'https://github.com/otro/kiramopay/releases/download/v2.8.0/kiramopay-web-android.zip'],
    ['otra version', 'https://github.com/keylormr/kiramopay/releases/download/v2.7.9/kiramopay-web-android.zip'],
    ['otra plataforma', 'https://github.com/keylormr/kiramopay/releases/download/v2.8.0/kiramopay-web-ios.zip'],
  ])('un paquete fuera del release de la version (%s) no se baja: va por el APK', async (_caso, url) => {
    getLatest.mockResolvedValue(conPaquete({ web: { ...WEB, url } }));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion?.via).toBe('externa'));
    expect(live.downloadBundle).not.toHaveBeenCalled();
  });

  // Si el backend respondio sin paquete por una falla pasajera, la barrera del
  // APK no queda para siempre: revisa de nuevo y pasa a la interna.
  it('con la barrera del APK revisa de nuevo y pasa a la interna cuando aparece el paquete', async () => {
    reintentos.revisarExternaMs = 30;
    getLatest.mockResolvedValue(conPaquete({ web: undefined }));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion?.via).toBe('externa'));
    getLatest.mockResolvedValue(conPaquete());
    await waitFor(() => expect(live.reload).toHaveBeenCalledTimes(1));
    expect(result.current.actualizacion?.via).toBe('interna');
  });

  // reload() del plugin resuelve enseguida y recien despues se recarga el
  // WebView. Si la pagina sigue viva, no se reinicio: se ofrece reintentar.
  it('si despues de reiniciar la app sigue aca, ofrece reintentar', async () => {
    reintentos.esperaReinicioMs = 30;
    live.reload.mockResolvedValue(undefined);
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion).toMatchObject({ via: 'interna', fase: 'error' }));
    expect(live.reload).toHaveBeenCalledTimes(1);

    live.getBundles.mockResolvedValue({ bundleIds: ['v2.8.0'] });
    await act(async () => {
      result.current.reintentar();
    });
    await waitFor(() => expect(live.reload).toHaveBeenCalledTimes(2));
    expect(live.downloadBundle).toHaveBeenCalledTimes(1);
  });

  it('dos ciclos de descarga fallidos ofrecen el APK', async () => {
    live.downloadBundle.mockRejectedValue(new Error('Bundle could not be downloaded.'));
    getLatest.mockResolvedValue(conPaquete());
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion).toMatchObject({ via: 'interna', fase: 'error' }));
    await act(async () => {
      result.current.reintentar();
    });
    await waitFor(() =>
      expect(result.current.actualizacion).toMatchObject({ via: 'externa', url: 'https://ejemplo/kiramopay.apk' }),
    );
  });

  // Sin canal de iOS no hay APK al que mandar: la barrera se queda con el
  // reintento a mano (decision pendiente del dueno: ver docs/IOS_IPA.md).
  it('iOS sin canal con las fallas agotadas ofrece reintentar a mano, sin ciclos solos', async () => {
    mockCapacitor.getPlatform.mockReturnValue('ios');
    firmado.verificarManifiesto.mockResolvedValue({ ...MANIFIESTO, plataforma: 'ios', paquete: 'kiramopay-web-ios.zip' });
    localStorage.setItem('kiramopay-actualizacion-fallos', JSON.stringify({ '2.8.0': 2 }));
    getLatest.mockResolvedValue(conPaquete({ url: '', web: WEB_IOS }));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(result.current.actualizacion).toMatchObject({ via: 'interna', fase: 'error' }));
    expect(live.downloadBundle).not.toHaveBeenCalled();
    await act(async () => {
      result.current.reintentar();
    });
    await waitFor(() => expect(live.reload).toHaveBeenCalledTimes(1));
  });

  it('iOS sin canal tambien se actualiza por dentro', async () => {
    mockCapacitor.getPlatform.mockReturnValue('ios');
    firmado.verificarManifiesto.mockResolvedValue({ ...MANIFIESTO, plataforma: 'ios', paquete: 'kiramopay-web-ios.zip' });
    getLatest.mockResolvedValue(conPaquete({ url: '', web: WEB_IOS }));
    renderHook(() => useActualizacion());
    await waitFor(() => expect(live.reload).toHaveBeenCalledTimes(1));
    expect(getLatest).toHaveBeenCalledWith('ios');
  });

  it('iOS sin canal y con un paquete que no le sirve no ofrece nada', async () => {
    mockCapacitor.getPlatform.mockReturnValue('ios');
    firmado.verificarManifiesto.mockResolvedValue({ ...MANIFIESTO, plataforma: 'ios', nativaMinima: 99 });
    getLatest.mockResolvedValue(conPaquete({ url: '' }));
    const { result } = renderHook(() => useActualizacion());
    await waitFor(() => expect(firmado.verificarManifiesto).toHaveBeenCalled());
    expect(result.current.actualizacion).toBeNull();
    expect(live.downloadBundle).not.toHaveBeenCalled();
  });
});

describe('confirmarArranque', () => {
  beforeEach(() => {
    localStorage.clear();
    mockCapacitor.isNativePlatform.mockReturnValue(true);
    mockCapacitor.getPlatform.mockReturnValue('android');
    live.ready.mockReset().mockResolvedValue({ previousBundleId: null, currentBundleId: null, rollback: false });
  });

  // Sin ready() el plugin cree que el paquete no arranco y vuelve al del APK.
  it('le avisa al plugin que la app arranco', async () => {
    await confirmarArranque();
    expect(live.ready).toHaveBeenCalledTimes(1);
  });

  it('en web no hay plugin que avisar', async () => {
    mockCapacitor.isNativePlatform.mockReturnValue(false);
    mockCapacitor.getPlatform.mockReturnValue('web');
    await confirmarArranque();
    expect(live.ready).not.toHaveBeenCalled();
  });

  // AppConGuardia y la revision del hook la piden: el plugin recibe un solo
  // ready() por carga de pagina.
  it('asegurarArranque confirma una sola vez', async () => {
    await confirmarArranque();
    await asegurarArranque();
    await asegurarArranque();
    expect(live.ready).toHaveBeenCalledTimes(1);
  });

  it('sin el plugin (un APK viejo) no se rompe', async () => {
    live.ready.mockRejectedValue(new Error('not implemented'));
    await expect(confirmarArranque()).resolves.toBeUndefined();
  });
});
