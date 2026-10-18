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

const { esVersionMasNueva, plataformaNativa, useActualizacion } = await import('../useActualizacion');

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
    capApp.getInfo.mockReset().mockResolvedValue({ version: '2.7.0' });
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
});
