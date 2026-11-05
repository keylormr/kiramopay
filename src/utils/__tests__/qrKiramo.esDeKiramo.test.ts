import { afterEach, describe, expect, it, vi } from 'vitest';
import { esCodigoDeKiramoPay } from '../qrKiramo';

// Antes de abrir "Pago detectado" se mira si el texto leido PUEDE ser un codigo
// de KiramoPay. Que exista, siga vigente y a quien pague lo sabe el servidor;
// aqui solo se descarta lo que no tiene la forma (una URL, un QR de otra app).

describe('esCodigoDeKiramoPay', () => {
  it('acepta un codigo permanente y un cobro', () => {
    expect(esCodigoDeKiramoPay('KP:merchant_dynamic:abcd1234:550000:CRC:i0123456789abcdef01234567')).toBe(true);
    expect(esCodigoDeKiramoPay('KP:p2p_request:chg12345:500000:CRC:xbbbbbbbbbbbbbbbbbbbbbbbb')).toBe(true);
  });

  it('descarta el QR de otra cosa', () => {
    expect(esCodigoDeKiramoPay('https://example.com/promo?ref=chat-2026')).toBe(false);
    expect(esCodigoDeKiramoPay('WIFI:T:WPA;S:casa;P:clave;;')).toBe(false);
    expect(esCodigoDeKiramoPay('000201010211...SINPE')).toBe(false);
    expect(esCodigoDeKiramoPay('')).toBe(false);
    expect(esCodigoDeKiramoPay('   ')).toBe(false);
  });

  it('descarta lo que empieza como KiramoPay pero no llega a serlo', () => {
    expect(esCodigoDeKiramoPay('KP:solo:cuatro:campos')).toBe(false);
    expect(esCodigoDeKiramoPay('kp:merchant_dynamic:abcd1234:0:CRC:iffffffffffffffffffffffff')).toBe(false);
    expect(esCodigoDeKiramoPay('XX:merchant_dynamic:abcd1234:0:CRC:iffffffffffffffffffffffff')).toBe(false);
  });

  it('tolera espacios alrededor, como el campo manual', () => {
    expect(esCodigoDeKiramoPay('  KP:merchant_dynamic:abcd1234:0:CRC:iffffffffffffffffffffffff \n')).toBe(true);
  });

  describe('modo demostracion (sin servidor)', () => {
    // Sin servidor la app usa un adaptador local cuyos codigos son JSON
    // ({"id": ...}). En produccion esos NO son de KiramoPay.
    const demo = '{"type":"p2p_receive","id":"code-1"}';

    it('en demostracion acepta el JSON con un id', () => {
      expect(esCodigoDeKiramoPay(demo, { demostracion: true })).toBe(true);
      expect(esCodigoDeKiramoPay('{"chargeId":"c1","id":"code-1"}', { demostracion: true })).toBe(true);
    });

    it('en demostracion tampoco acepta un JSON cualquiera ni un texto suelto', () => {
      expect(esCodigoDeKiramoPay('{"hola":"mundo"}', { demostracion: true })).toBe(false);
      expect(esCodigoDeKiramoPay('[1,2,3]', { demostracion: true })).toBe(false);
      expect(esCodigoDeKiramoPay('https://example.com', { demostracion: true })).toBe(false);
    });

    it('con servidor el JSON de demostracion se descarta', () => {
      expect(esCodigoDeKiramoPay(demo, { demostracion: false })).toBe(false);
    });

    // Sin pasar la bandera a mano: el valor por defecto sale de VITE_API_URL, la
    // misma variable con la que la app elige entre el adaptador local y el
    // servidor. Invertirlo dejaria inservible el escaner en demostracion o
    // abierto en produccion.
    afterEach(() => { vi.unstubAllEnvs(); });

    it('por defecto, sin VITE_API_URL (demostracion) acepta el JSON con id', () => {
      vi.stubEnv('VITE_API_URL', '');
      expect(esCodigoDeKiramoPay(demo)).toBe(true);
    });

    it('por defecto, con VITE_API_URL (servidor) descarta el JSON con id', () => {
      vi.stubEnv('VITE_API_URL', 'https://api.example.test');
      expect(esCodigoDeKiramoPay(demo)).toBe(false);
      // Y un codigo real sigue valiendo en los dos modos.
      expect(esCodigoDeKiramoPay('KP:merchant_dynamic:abcd1234:0:CRC:iffffffffffffffffffffffff')).toBe(true);
    });
  });
});
