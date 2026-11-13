import { beforeEach, describe, expect, it, vi } from 'vitest';

// El almacen seguro del telefono, simulado. Un objeto comun: el Proxy real de
// Capacitor no existe fuera del telefono.
const almacen = vi.hoisted(() => ({ getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@aparajita/capacitor-secure-storage', () => ({ SecureStorage: almacen }));
vi.mock('@/services/biometric', () => ({
  biometricService: { checkAvailability: vi.fn().mockResolvedValue({ isAvailable: false }), authenticate: vi.fn() },
}));

import { abrirSemilla, BilleteraYaGuardada, estadoDeLaBilletera, guardarSemilla } from '../boveda';

const CERO = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const HARDHAT = 'test test test test test test test test test test test junk';

beforeEach(() => {
  almacen.getItem.mockReset();
  almacen.setItem.mockReset().mockResolvedValue(undefined);
});

describe('la semilla en el almacen seguro', () => {
  it('distingue no tener billetera de no poder leer el almacen', async () => {
    almacen.getItem.mockResolvedValueOnce(CERO);
    expect(await estadoDeLaBilletera('u1')).toBe('hay');
    almacen.getItem.mockResolvedValueOnce(null);
    expect(await estadoDeLaBilletera('u1')).toBe('no-hay');
    almacen.getItem.mockRejectedValueOnce(new Error('Keystore ocupado'));
    expect(await estadoDeLaBilletera('u1')).toBe('error');
  });

  it('nunca escribe una semilla encima de otra', async () => {
    almacen.getItem.mockResolvedValue(CERO);
    await expect(guardarSemilla('u1', HARDHAT)).rejects.toBeInstanceOf(BilleteraYaGuardada);
    expect(almacen.setItem).not.toHaveBeenCalled();
  });

  it('si no puede leer el almacen, tampoco escribe', async () => {
    almacen.getItem.mockRejectedValue(new Error('Keystore ocupado'));
    await expect(guardarSemilla('u1', HARDHAT)).rejects.toThrow('Keystore ocupado');
    expect(almacen.setItem).not.toHaveBeenCalled();
  });

  it('guarda la semilla limpia cuando no hay otra, y la misma no es un error', async () => {
    almacen.getItem.mockResolvedValueOnce(null);
    await guardarSemilla('u1', `  ${HARDHAT.toUpperCase()} `);
    expect(almacen.setItem).toHaveBeenCalledWith('kp_billetera_semilla:u1', HARDHAT);

    almacen.setItem.mockClear();
    almacen.getItem.mockResolvedValueOnce(HARDHAT);
    await expect(guardarSemilla('u1', HARDHAT)).resolves.toBeUndefined();
    expect(almacen.setItem).not.toHaveBeenCalled();
  });

  it('al abrir, un almacen que no contesta no se confunde con una billetera ausente', async () => {
    almacen.getItem.mockRejectedValueOnce(new Error('Keystore ocupado'));
    expect(await abrirSemilla('u1', 'Abrir')).toEqual({ estado: 'error' });
    almacen.getItem.mockResolvedValueOnce(null);
    expect(await abrirSemilla('u1', 'Abrir')).toEqual({ estado: 'sin-billetera' });
  });
});
