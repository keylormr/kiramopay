import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// El modulo lee Capacitor en tiempo de llamada, asi que el mock se define una
// vez y cada test cambia lo que devuelve.
const mockCapacitor = {
  isNativePlatform: vi.fn(() => false),
  getPlatform: vi.fn(() => 'web'),
};
vi.mock('@capacitor/core', () => ({ Capacitor: mockCapacitor }));
vi.mock('@capacitor/app', () => ({ App: { getInfo: vi.fn() } }));
vi.mock('@/api', () => ({ getApiLayer: vi.fn(() => ({})) }));

const { esVersionMasNueva, plataformaNativa } = await import('../useActualizacion');

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
