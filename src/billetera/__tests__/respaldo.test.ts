import { describe, expect, it } from 'vitest';
import {
  ContrasenaIncorrecta,
  FORMATO_DEL_RESPALDO,
  RespaldoInvalido,
  cifrarRespaldo,
  contrasenaSuficiente,
  descifrarRespaldo,
  leerRespaldo,
  nombreDelRespaldo,
} from '../respaldo';

// Vectores oficiales de BIP-39 (entropia en cero): 12 y 24 palabras.
const DOCE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const VEINTICUATRO = `${'abandon '.repeat(23)}art`;
const CLAVE = 'una clave larga de prueba';
// Menos vueltas que la app para que las pruebas no tarden; el minimo aceptado.
const RAPIDO = { vueltas: 100_000 };

describe('respaldo cifrado de las palabras', () => {
  it('ida y vuelta con 12 palabras', async () => {
    const archivo = await cifrarRespaldo(DOCE, CLAVE, RAPIDO);
    expect(await descifrarRespaldo(archivo, CLAVE)).toBe(DOCE);
  });

  it('ida y vuelta con 24 palabras', async () => {
    const archivo = await cifrarRespaldo(VEINTICUATRO, CLAVE, RAPIDO);
    expect(await descifrarRespaldo(archivo, CLAVE)).toBe(VEINTICUATRO);
  });

  it('guarda las palabras normalizadas', async () => {
    const archivo = await cifrarRespaldo(`  ${DOCE.toUpperCase().replace(/ /g, '   ')} `, CLAVE, RAPIDO);
    expect(await descifrarRespaldo(archivo, CLAVE)).toBe(DOCE);
  });

  it('el archivo no lleva las palabras a la vista', async () => {
    const archivo = await cifrarRespaldo(DOCE, CLAVE, RAPIDO);
    expect(archivo).not.toMatch(/abandon|about/);
    const r = leerRespaldo(archivo);
    expect(r.formato).toBe(FORMATO_DEL_RESPALDO);
    expect(r.kdf.vueltas).toBe(100_000);
  });

  it('por defecto usa 600.000 vueltas', async () => {
    const r = leerRespaldo(await cifrarRespaldo(DOCE, CLAVE));
    expect(r.kdf.vueltas).toBe(600_000);
  });

  it('cada archivo lleva su propia sal y su propio IV', async () => {
    const a = leerRespaldo(await cifrarRespaldo(DOCE, CLAVE, RAPIDO));
    const b = leerRespaldo(await cifrarRespaldo(DOCE, CLAVE, RAPIDO));
    expect(a.kdf.sal).not.toBe(b.kdf.sal);
    expect(a.cifrado.iv).not.toBe(b.cifrado.iv);
    expect(a.datos).not.toBe(b.datos);
  });

  it('una contrasena equivocada no lo abre', async () => {
    const archivo = await cifrarRespaldo(DOCE, CLAVE, RAPIDO);
    await expect(descifrarRespaldo(archivo, 'otra clave larga cualquiera')).rejects.toBeInstanceOf(ContrasenaIncorrecta);
  });

  it('la misma contrasena escrita con la tilde compuesta o precompuesta lo abre', async () => {
    const archivo = await cifrarRespaldo(DOCE, 'contraseña única 2026', RAPIDO);
    const descompuesta = 'contraseña única 2026';
    expect(descompuesta).not.toBe('contraseña única 2026');
    expect(await descifrarRespaldo(archivo, descompuesta)).toBe(DOCE);
  });

  it('un archivo con el texto cifrado tocado no se abre', async () => {
    const r = JSON.parse(await cifrarRespaldo(DOCE, CLAVE, RAPIDO));
    const bytes = Uint8Array.from(atob(r.datos), c => c.charCodeAt(0));
    bytes[0] ^= 1;
    r.datos = btoa(String.fromCharCode(...bytes));
    await expect(descifrarRespaldo(JSON.stringify(r), CLAVE)).rejects.toBeInstanceOf(ContrasenaIncorrecta);
  });

  it('cambiar las vueltas en el archivo tampoco lo abre', async () => {
    const r = JSON.parse(await cifrarRespaldo(DOCE, CLAVE, RAPIDO));
    r.kdf.vueltas = 100_001;
    await expect(descifrarRespaldo(JSON.stringify(r), CLAVE)).rejects.toBeInstanceOf(ContrasenaIncorrecta);
  });

  it('rechaza lo que no es un respaldo', async () => {
    const bueno = JSON.parse(await cifrarRespaldo(DOCE, CLAVE, RAPIDO));
    const malos = [
      'no es json',
      '{}',
      JSON.stringify({ ...bueno, formato: 'otra-app' }),
      JSON.stringify({ ...bueno, version: 2 }),
      JSON.stringify({ ...bueno, kdf: { ...bueno.kdf, vueltas: 1_000 } }),
      JSON.stringify({ ...bueno, kdf: { ...bueno.kdf, vueltas: 50_000_000 } }),
      JSON.stringify({ ...bueno, cifrado: { ...bueno.cifrado, iv: 'AAAA' } }),
      JSON.stringify({ ...bueno, datos: '' }),
      'x'.repeat(20_000),
    ];
    for (const m of malos) {
      await expect(descifrarRespaldo(m, CLAVE)).rejects.toBeInstanceOf(RespaldoInvalido);
    }
  });

  it('no cifra con una contrasena corta ni con palabras invalidas', async () => {
    expect(contrasenaSuficiente('corta')).toBe(false);
    expect(contrasenaSuficiente('once letras')).toBe(false);
    expect(contrasenaSuficiente('doce letras!')).toBe(true);
    await expect(cifrarRespaldo(DOCE, 'corta', RAPIDO)).rejects.toThrow();
    await expect(cifrarRespaldo('abandon abandon', CLAVE, RAPIDO)).rejects.toThrow();
  });

  it('nombre del archivo con la fecha', () => {
    expect(nombreDelRespaldo(new Date(2026, 10, 27, 15, 0))).toBe('kiramopay-respaldo-billetera-2026-11-27.json');
  });
});
