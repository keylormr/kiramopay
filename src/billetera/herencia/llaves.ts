// Las llaves de la boveda de herencia.
//
// Cada parte aporta una llave publica extendida (xpub) con su origen, en el
// formato que usan Liana, Bitcoin Core y las billeteras de hardware:
//
//   [huella/48'/0'/0'/2']xpub6...
//
// - El titular la saca de sus 12 palabras (las de la billetera propia).
// - El heredero la saca de las suyas en su propio KiramoPay, o la exporta desde
//   Liana o desde una billetera de hardware. Nunca entrega sus palabras: con la
//   xpub nadie puede gastar.
//
// La ruta 48'/coin'/0'/2' es la que usa Liana para sus billeteras; asi el
// heredero que restaura en Liana encuentra las mismas direcciones.
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { NETWORK, TEST_NETWORK } from '@scure/btc-signer';
import { normalizarSemilla, semillaValida } from '../semilla';

/** 'bitcoin' es la red principal; 'regtest' es la red de prueba local de las pruebas. */
export type Red = 'bitcoin' | 'regtest';

interface ParametrosDeRed {
  versiones: { private: number; public: number };
  /** Lo que btc-signer necesita para codificar direcciones. */
  direcciones: typeof NETWORK;
  /** 0 en la red principal, 1 en las de prueba (BIP-44). */
  moneda: 0 | 1;
}

const REGTEST: typeof NETWORK = { ...TEST_NETWORK, bech32: 'bcrt' };

export const PARAMETROS: Record<Red, ParametrosDeRed> = {
  bitcoin: { versiones: { private: 0x0488ade4, public: 0x0488b21e }, direcciones: NETWORK, moneda: 0 },
  regtest: { versiones: { private: 0x04358394, public: 0x043587cf }, direcciones: REGTEST, moneda: 1 },
};

/** La ruta de la cuenta de la boveda, sin la "m/": 48'/0'/0'/2' en la red principal. */
export function rutaDeLaCuenta(red: Red): string {
  return `48'/${PARAMETROS[red].moneda}'/0'/2'`;
}

/** Una llave publica extendida con su origen: de que semilla y por que ruta sale. */
export interface LlaveConOrigen {
  /** Huella de la llave maestra: 8 caracteres hexadecimales en minuscula. */
  huella: string;
  /** La ruta desde la maestra, con ' para las derivaciones endurecidas. */
  ruta: string;
  xpub: string;
}

/** `[huella/ruta]xpub`: como se escribe dentro de un descriptor. */
export function textoDeLaLlave(llave: LlaveConOrigen): string {
  return `[${llave.huella}/${llave.ruta}]${llave.xpub}`;
}

function huellaEnTexto(huella: number): string {
  return huella.toString(16).padStart(8, '0');
}

function maestraDe(semilla: string, red: Red): HDKey {
  const limpia = normalizarSemilla(semilla);
  if (!semillaValida(limpia)) throw new Error('semilla invalida');
  return HDKey.fromMasterSeed(mnemonicToSeedSync(limpia), PARAMETROS[red].versiones);
}

/** La llave de la cuenta de la boveda que sale de estas 12 (o 24) palabras. */
export function llaveDeLaCuenta(semilla: string, red: Red): LlaveConOrigen {
  const maestra = maestraDe(semilla, red);
  const ruta = rutaDeLaCuenta(red);
  const cuenta = maestra.derive(`m/${ruta}`);
  return { huella: huellaEnTexto(maestra.fingerprint), ruta, xpub: cuenta.publicExtendedKey };
}

/**
 * La llave privada de una direccion de la boveda (rama 0 = recibir, 1 = cambio).
 * Solo existe mientras se firma: nadie la guarda.
 */
export function llavePrivadaDe(semilla: string, red: Red, rama: 0 | 1, indice: number): Uint8Array {
  const llave = maestraDe(semilla, red).derive(`m/${rutaDeLaCuenta(red)}/${rama}/${indice}`);
  if (!llave.privateKey) throw new Error('sin llave privada');
  return llave.privateKey;
}

export type MotivoLlaveInvalida =
  /** Pego sus 12 palabras: eso NUNCA se comparte. */
  | 'son-palabras'
  /** Pego una llave privada extendida (xprv/tprv). */
  | 'es-privada'
  /** Falta el origen [huella/ruta]: sin el, Liana no puede firmar. */
  | 'sin-origen'
  /** Es de otra red (tpub en la principal o al reves). */
  | 'otra-red'
  | 'formato';

export class LlaveInvalida extends Error {
  constructor(public readonly motivo: MotivoLlaveInvalida) {
    super(motivo);
  }
}

// [huella/ruta]xpub, y opcionalmente /<0;1>/* (asi la exporta Liana).
const PATRON_DE_LLAVE = /^\[([0-9a-fA-F]{8})((?:\/\d+['hH]?)+)\]([1-9A-HJ-NP-Za-km-z]{100,120})(?:\/<0;1>\/\*)?$/;

/**
 * Lee la llave que entrega el heredero. Acepta lo que exportan KiramoPay,
 * Liana y Bitcoin Core: `[huella/ruta]xpub`, con o sin `/<0;1>/*` al final.
 * Rechaza con un motivo claro lo que no sirve, sobre todo lo que es secreto.
 */
export function leerLlave(texto: string, red: Red): LlaveConOrigen {
  const original = texto.trim();
  // Alguien que pega sus palabras (aunque tengan un error): se avisa sin
  // repetirlas ni guardarlas.
  if (/^[a-z]+(\s+[a-z]+){11,}$/i.test(original)) throw new LlaveInvalida('son-palabras');
  const limpio = original.replace(/\s+/g, '');
  if (/(^|\])[xtyzuv]prv/i.test(limpio)) throw new LlaveInvalida('es-privada');
  const m = PATRON_DE_LLAVE.exec(limpio);
  if (!m) {
    if (/^[xt]pub[1-9A-HJ-NP-Za-km-z]{100,120}$/.test(limpio)) throw new LlaveInvalida('sin-origen');
    throw new LlaveInvalida('formato');
  }
  const [, huella, rutaCruda, xpub] = m;
  const pasos = rutaCruda.slice(1).split('/');
  const ruta = pasos.map(p => p.replace(/[hH]$/, "'")).join('/');

  let llave: HDKey;
  try {
    llave = HDKey.fromExtendedKey(xpub, PARAMETROS[red].versiones);
  } catch {
    const otra: Red = red === 'bitcoin' ? 'regtest' : 'bitcoin';
    try {
      HDKey.fromExtendedKey(xpub, PARAMETROS[otra].versiones);
    } catch {
      throw new LlaveInvalida('formato');
    }
    throw new LlaveInvalida('otra-red');
  }
  if (llave.privateKey) throw new LlaveInvalida('es-privada');
  // La profundidad de la xpub tiene que ser el largo de la ruta que dice su origen.
  if (llave.depth !== pasos.length) throw new LlaveInvalida('formato');
  return { huella: huella.toLowerCase(), ruta, xpub };
}

/** Si dos llaves son la misma (el titular no puede nombrarse heredero de si mismo). */
export function mismaLlave(a: LlaveConOrigen, b: LlaveConOrigen): boolean {
  return a.xpub === b.xpub;
}

/** La llave publica (33 bytes, comprimida) de una direccion de la boveda. */
export function publicaDe(llave: LlaveConOrigen, red: Red, rama: 0 | 1, indice: number): Uint8Array {
  const hd = HDKey.fromExtendedKey(llave.xpub, PARAMETROS[red].versiones).deriveChild(rama).deriveChild(indice);
  if (!hd.publicKey) throw new Error('sin llave publica');
  return hd.publicKey;
}
