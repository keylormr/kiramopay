// Verificacion del manifiesto de la actualizacion interna, en el telefono.
//
// El CI (scripts/paquete-web.mjs) publica por plataforma un .zip con la capa
// web y un manifiesto firmado que dice de que version es, que version nativa
// minima necesita y cual es la firma del .zip. Hay dos verificaciones, y las dos
// tienen que pasar:
//
//   1. Esta: la app verifica la firma del manifiesto con WebCrypto antes de
//      bajar nada. Sin ella, un .zip viejo con su firma valida podria hacerse
//      pasar por la version nueva, porque la firma del .zip no dice su version.
//   2. La del plugin: con la firma del .zip que trae el manifiesto, verifica en
//      nativo el archivo bajado antes de descomprimirlo, con la llave de
//      capacitor.config.ts. Esa llave viaja en el binario: aunque un JS ajeno
//      llamara al plugin, un .zip sin firma valida no se aplica.
//
// RSASSA-PKCS1-v1_5 con SHA-256 (el esquema del plugin). WebCrypto lo tiene
// desde Chrome 37; un WebView sin crypto.subtle no acepta nada y la version se
// instala por APK.

/**
 * La misma llave publica que plugins.LiveUpdate.publicKey en
 * capacitor.config.ts (una prueba lo exige).
 */
export const LLAVE_PUBLICA_PAQUETES =
  '-----BEGIN PUBLIC KEY-----MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAinaoOAWrdZndWTRl6kg8sD/fWUjNVXtbApeJAUR6V1c0gRMLlfQUFzQ5WkdNA2nODA3Rqq7Jw4j71caG+EsafRDZ96Y2T9jH9mgl17pFGGZmAjzQICnC04X2r3iQQzlC0vuBsEAeNCEN2ZClSds9YZUim9UakI1SviU0qhVYPrfjDydb7/64JSh5EJUNoJsZfNwC6oXa0QPhQ7HktYhOVpiZFQGEDVCQ5SvfgXoAUjEXDWAmaYirTqBRQBc/5bSNYEbelBWMoYTJV8f+8A4CcxfWCCTsSMhmnN7sLKV7GSnyl67GXclvfL9qj1HOLiUgh8DdD+7Jjo2ywT55N4lnTQIDAQAB-----END PUBLIC KEY-----';

/** El formato que esta version de la app sabe leer. */
const FORMATO = 1;

export interface ManifiestoPaquete {
  formato: 1;
  plataforma: 'android' | 'ios';
  version: string;
  /** El numero de build con el que se armo. */
  versionCode: number;
  /** El build nativo mas viejo en el que este paquete funciona. */
  nativaMinima: number;
  huellaNativa: string;
  paquete: string;
  /** Firma del .zip, en base64: se la pasa al plugin. */
  firmaPaquete: string;
  /** Tamano del .zip, por si el servidor no lo dice al bajarlo. */
  bytes: number;
}

export interface ManifiestoPublicado {
  manifest: string;
  signature: string;
}

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

function deBase64(texto: string): Uint8Array<ArrayBuffer> | null {
  if (!texto || !BASE64.test(texto)) return null;
  try {
    const binario = atob(texto);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function derDePem(pem: string): Uint8Array<ArrayBuffer> | null {
  return deBase64(pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, ''));
}

const enteroPositivo = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

function comoManifiesto(m: unknown): ManifiestoPaquete | null {
  if (!m || typeof m !== 'object') return null;
  const c = m as Record<string, unknown>;
  if (c.formato !== FORMATO) return null;
  if (c.plataforma !== 'android' && c.plataforma !== 'ios') return null;
  if (typeof c.version !== 'string' || !VERSION.test(c.version)) return null;
  if (!enteroPositivo(c.versionCode) || !enteroPositivo(c.nativaMinima)) return null;
  if (typeof c.huellaNativa !== 'string' || typeof c.paquete !== 'string') return null;
  if (typeof c.firmaPaquete !== 'string' || !BASE64.test(c.firmaPaquete)) return null;
  if (!Number.isInteger(c.bytes) || (c.bytes as number) < 0) return null;
  return {
    formato: FORMATO,
    plataforma: c.plataforma,
    version: c.version,
    versionCode: c.versionCode,
    nativaMinima: c.nativaMinima,
    huellaNativa: c.huellaNativa,
    paquete: c.paquete,
    firmaPaquete: c.firmaPaquete,
    bytes: c.bytes as number,
  };
}

/**
 * Devuelve el manifiesto si la firma es de la llave del CI y los campos tienen
 * sentido; si no, null. Nunca lanza.
 */
export async function verificarManifiesto(
  web: ManifiestoPublicado,
  llavePem: string = LLAVE_PUBLICA_PAQUETES,
  subtle: SubtleCrypto | null = globalThis.crypto?.subtle ?? null,
): Promise<ManifiestoPaquete | null> {
  if (!subtle) return null;
  const datos = deBase64(web.manifest);
  const firma = deBase64(web.signature);
  const der = derDePem(llavePem);
  if (!datos || !firma || !der) return null;
  try {
    const llave = await subtle.importKey('spki', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!(await subtle.verify('RSASSA-PKCS1-v1_5', llave, firma, datos))) return null;
    return comoManifiesto(JSON.parse(new TextDecoder().decode(datos)));
  } catch {
    return null;
  }
}
