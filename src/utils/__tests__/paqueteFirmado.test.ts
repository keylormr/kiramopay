import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import path from 'node:path';
import { armarManifiesto, firmar, llavePublicaDeConfig } from '../../../scripts/paquete-web.mjs';
import { verificarManifiesto, LLAVE_PUBLICA_PAQUETES } from '../paqueteFirmado';

// El plugin verifica la firma del .zip en nativo antes de descomprimirlo, pero
// esa firma no dice de que version es el paquete: un .zip viejo con su firma
// valida pasaria por uno nuevo. El manifiesto firmado ata la firma del .zip a la
// version y a la version nativa minima, y la app lo verifica antes de bajar nada.

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

const llaves = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const CAMPOS = {
  plataforma: 'android',
  version: '2.9.0',
  versionCode: 19,
  nativaMinima: 19,
  huellaNativa: 'h1',
  paquete: 'kiramopay-web-android.zip',
  firmaPaquete: 'ZmlybWEgZGVsIHppcA==',
  bytes: 812345,
};

function publicado(privada: string, campos: Record<string, unknown> = CAMPOS) {
  const texto: string = armarManifiesto(campos as Parameters<typeof armarManifiesto>[0]);
  return {
    manifest: Buffer.from(texto).toString('base64'),
    signature: firmar(Buffer.from(texto), privada),
  };
}

describe('verificarManifiesto', () => {
  it('acepta lo que firma el CI y devuelve lo que la app necesita', async () => {
    const { publicKey, privateKey } = llaves();
    const m = await verificarManifiesto(publicado(privateKey), publicKey, subtle);
    expect(m).toEqual({ formato: 1, ...CAMPOS });
  });

  it('rechaza un manifiesto tocado despues de firmar', async () => {
    const { publicKey, privateKey } = llaves();
    const web = publicado(privateKey);
    const tocado = Buffer.from(Buffer.from(web.manifest, 'base64').toString().replace('"nativaMinima":19', '"nativaMinima":1'));
    expect(await verificarManifiesto({ ...web, manifest: tocado.toString('base64') }, publicKey, subtle)).toBeNull();
  });

  it('rechaza la firma de otra llave', async () => {
    const una = llaves();
    const otra = llaves();
    expect(await verificarManifiesto(publicado(una.privateKey), otra.publicKey, subtle)).toBeNull();
  });

  it('rechaza basura sin romperse', async () => {
    const { publicKey } = llaves();
    expect(await verificarManifiesto({ manifest: 'no es base64 !!', signature: 'x' }, publicKey, subtle)).toBeNull();
    expect(await verificarManifiesto({ manifest: '', signature: '' }, publicKey, subtle)).toBeNull();
  });

  it('un manifiesto firmado pero con campos invalidos no sirve', async () => {
    const { publicKey, privateKey } = llaves();
    for (const malo of [
      { ...CAMPOS, version: '2.9' },
      { ...CAMPOS, version: '../../x' },
      { ...CAMPOS, plataforma: 'windows' },
      { ...CAMPOS, nativaMinima: '19' },
      { ...CAMPOS, nativaMinima: -1 },
      { ...CAMPOS, firmaPaquete: '' },
      { ...CAMPOS, bytes: 'mucho' },
    ]) {
      expect(await verificarManifiesto(publicado(privateKey, malo), publicKey, subtle)).toBeNull();
    }
  });

  it('un formato que esta version no conoce no se aplica', async () => {
    const { publicKey, privateKey } = llaves();
    const texto = JSON.stringify({ formato: 2, ...CAMPOS });
    const web = { manifest: Buffer.from(texto).toString('base64'), signature: firmar(Buffer.from(texto), privateKey) };
    expect(await verificarManifiesto(web, publicKey, subtle)).toBeNull();
  });

  // WebView viejos sin crypto.subtle: sin poder verificar no se aplica nada.
  it('sin WebCrypto no acepta nada', async () => {
    const { publicKey, privateKey } = llaves();
    expect(await verificarManifiesto(publicado(privateKey), publicKey, null)).toBeNull();
  });
});

describe('LLAVE_PUBLICA_PAQUETES', () => {
  // El plugin verifica el .zip con la llave de capacitor.config.ts (que viaja
  // en el binario) y la app verifica el manifiesto con esta. Tienen que ser la
  // misma, o todo paquete se rechazaria.
  it('es la misma llave que la de capacitor.config.ts', () => {
    const texto = readFileSync(path.resolve(__dirname, '../../../capacitor.config.ts'), 'utf8');
    const normal = (pem: string | null) => (pem ?? '').replace(/\s+/g, '');
    expect(normal(LLAVE_PUBLICA_PAQUETES)).toBe(normal(llavePublicaDeConfig(texto)));
    expect(normal(LLAVE_PUBLICA_PAQUETES)).toMatch(/^-----BEGINPUBLICKEY-----/);
  });
});
