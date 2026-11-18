// La boveda de herencia contra vectores de Bitcoin Core.
//
// vectoresDeCore.json salio de Bitcoin Core 32.1 (binario oficial verificado):
// getdescriptorinfo confirmo cada checksum y deriveaddresses dio cada direccion,
// en la red principal y en regtest, para tres plazos. Las llaves son las de dos
// semillas de prueba publicas (BIP-39), nunca de una billetera real. Core
// tambien derivo las mismas direcciones partiendo de la llave maestra con la
// ruta completa, asi que la cadena entera (palabras, maestra, cuenta, rama,
// indice, script taproot, direccion) esta comparada con una implementacion
// independiente.
import { schnorr } from '@noble/curves/secp256k1';
import { Transaction } from '@scure/btc-signer';
import vectores from './vectoresDeCore.json';
import {
  checksumCorrecto,
  checksumDeDescriptor,
  descriptorDeLaBoveda,
  descriptoresPorRama,
  plazoValido,
  type DatosDeLaBoveda,
} from '../descriptor';
import { direccionDeLaBoveda, hojaDelHeredero } from '../direcciones';
import { leerLlave, llaveDeLaCuenta, LlaveInvalida, mismaLlave, textoDeLaLlave, type Red } from '../llaves';
import { MINIMO_A_MOVER_SATS, prepararMovimiento, RechazoMovimiento, SECUENCIA_DEL_TITULAR, type MonedaDeLaBoveda } from '../transacciones';

const TITULAR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const HEREDERO = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

function datosDe(red: Red, plazoBloques: number): DatosDeLaBoveda {
  return { red, titular: llaveDeLaCuenta(TITULAR, red), heredero: llaveDeLaCuenta(HEREDERO, red), plazoBloques };
}

describe('llaves', () => {
  it('saca la llave de la cuenta 48h/coin/0h/2h con su origen', () => {
    for (const v of vectores) {
      const red = v.red as Red;
      expect(textoDeLaLlave(llaveDeLaCuenta(TITULAR, red))).toBe(v.titular);
      expect(textoDeLaLlave(llaveDeLaCuenta(HEREDERO, red))).toBe(v.heredero);
    }
    // La huella de "abandon ... about" es la conocida 73c5da0a.
    expect(llaveDeLaCuenta(TITULAR, 'bitcoin').huella).toBe('73c5da0a');
  });

  it('lee la llave del heredero como la exportan KiramoPay, Liana y Core', () => {
    const llave = llaveDeLaCuenta(HEREDERO, 'bitcoin');
    const texto = textoDeLaLlave(llave);
    expect(leerLlave(texto, 'bitcoin')).toEqual(llave);
    expect(leerLlave(`${texto}/<0;1>/*`, 'bitcoin')).toEqual(llave);
    expect(leerLlave(`  ${texto}\n`, 'bitcoin')).toEqual(llave);
    // Con "h" en vez de comillas (como escribe Core) es la misma llave.
    expect(leerLlave(texto.replace(/'/g, 'h'), 'bitcoin')).toEqual(llave);
    // La huella en mayusculas se guarda en minusculas.
    expect(leerLlave(texto.replace(llave.huella, llave.huella.toUpperCase()), 'bitcoin')).toEqual(llave);
  });

  it('rechaza lo que no sirve y, sobre todo, lo que es secreto', () => {
    const motivo = (texto: string, red: Red = 'bitcoin') => {
      try {
        leerLlave(texto, red);
        return 'aceptada';
      } catch (e) {
        return e instanceof LlaveInvalida ? e.motivo : 'otro';
      }
    };
    const llave = llaveDeLaCuenta(HEREDERO, 'bitcoin');
    expect(motivo(HEREDERO)).toBe('son-palabras');
    // Doce palabras con un error tambien son palabras: nunca se aceptan ni se repiten.
    expect(motivo(HEREDERO.replace('wrong', 'right'))).toBe('son-palabras');
    expect(motivo('[73c5da0a/48h/0h/0h/2h]xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi')).toBe('es-privada');
    expect(motivo(llave.xpub)).toBe('sin-origen');
    expect(motivo(textoDeLaLlave(llave), 'regtest')).toBe('otra-red');
    // La ruta dice 4 pasos pero la llave es de profundidad 4: con 3 no cuadra.
    expect(motivo(`[${llave.huella}/48'/0'/0']${llave.xpub}`)).toBe('formato');
    expect(motivo('hola')).toBe('formato');
    expect(motivo(`[${llave.huella}/48'/0'/0'/2']${llave.xpub.slice(0, -1)}x`)).toBe('formato');
  });

  it('distingue al titular del heredero', () => {
    expect(mismaLlave(llaveDeLaCuenta(TITULAR, 'bitcoin'), llaveDeLaCuenta(TITULAR, 'bitcoin'))).toBe(true);
    expect(mismaLlave(llaveDeLaCuenta(TITULAR, 'bitcoin'), llaveDeLaCuenta(HEREDERO, 'bitcoin'))).toBe(false);
  });
});

describe('descriptor', () => {
  it('calcula el checksum de BIP-380', () => {
    expect(checksumDeDescriptor('raw(deadbeef)')).toBe('89f8spxm');
    expect(checksumDeDescriptor('addr(bc1prey6uj586mfj0ql9r8tnnrmhnn4lmvpaxexlwfhg6qchsek40v2qdeu2z0)')).toBe('wrlg2nz3');
    expect(checksumCorrecto('raw(deadbeef)#89f8spxm')).toBe(true);
    expect(checksumCorrecto('raw(deadbeef)#89f8spxn')).toBe(false);
    expect(checksumCorrecto('raw(deadbeee)#89f8spxm')).toBe(false);
    expect(checksumCorrecto('raw(deadbeef)')).toBe(false);
  });

  it('arma el mismo descriptor que valido Core, con y sin <0;1>', () => {
    for (const v of vectores) {
      const datos = datosDe(v.red as Red, v.plazo);
      expect(descriptorDeLaBoveda(datos)).toBe(v.descriptor);
      expect(descriptoresPorRama(datos)).toEqual({ recibir: v.recibir, cambio: v.cambio });
      expect(checksumCorrecto(v.descriptor)).toBe(true);
    }
  });

  it('el plazo es de 1 a 65.535 bloques (16 bits de BIP-68)', () => {
    expect(plazoValido(1)).toBe(true);
    expect(plazoValido(65_535)).toBe(true);
    expect(plazoValido(0)).toBe(false);
    expect(plazoValido(65_536)).toBe(false);
    expect(plazoValido(1.5)).toBe(false);
    expect(() => descriptorDeLaBoveda(datosDe('bitcoin', 70_000))).toThrow();
  });
});

describe('direcciones', () => {
  it('dan las mismas direcciones que Core en las dos ramas', () => {
    for (const v of vectores) {
      const datos = datosDe(v.red as Red, v.plazo);
      expect([0, 1, 2].map(i => direccionDeLaBoveda(datos, 0, i).direccion)).toEqual(v.direccionesRecibir);
      expect([0, 1].map(i => direccionDeLaBoveda(datos, 1, i).direccion)).toEqual(v.direccionesCambio);
    }
  });

  it('la hoja es and_v(v:pk(B),older(N)) compilada: <B> CHECKSIGVERIFY <N> CHECKSEQUENCEVERIFY', () => {
    const b = new Uint8Array(32).fill(7);
    const hex = (u: Uint8Array) => Array.from(u, x => x.toString(16).padStart(2, '0')).join('');
    // 52560 = 0xcd50: en ScriptNum va en little endian con un 00 por el bit de signo.
    expect(hex(hojaDelHeredero(b, 52_560))).toBe(`20${'07'.repeat(32)}ad0350cd00b2`);
    // Hasta 16 es un solo opcode (OP_10 = 0x5a).
    expect(hex(hojaDelHeredero(b, 10))).toBe(`20${'07'.repeat(32)}ad5ab2`);
    expect(() => hojaDelHeredero(new Uint8Array(33), 10)).toThrow();
  });
});

describe('mover la boveda por la ruta del titular', () => {
  const datos = datosDe('bitcoin', 52_560);
  const moneda = (sats: number, rama: 0 | 1 = 0, indice = 0, altura: number | null = 800_000): MonedaDeLaBoveda => ({
    txid: 'ab'.repeat(32), vout: 1, sats, rama, indice, altura,
  });
  const destino = () => direccionDeLaBoveda(datos, 1, 0).direccion;

  it('firma por key path una firma valida para la llave ajustada de cada direccion', () => {
    const monedas = [moneda(400_000, 0, 0), { ...moneda(300_000, 1, 3), txid: 'cd'.repeat(32) }];
    const p = prepararMovimiento({ datos, semilla: TITULAR, monedas, destino: destino(), tasaSatsVb: 3 });
    // 10,5 + 2 x 57,5 + 43 = 168,5 -> 169 vB.
    expect(p.vsize).toBe(169);
    expect(p.comisionSats).toBe(169 * 3);
    expect(p.llegaSats).toBe(700_000 - 169 * 3);

    const tx = Transaction.fromRaw(Uint8Array.from(p.hex.match(/../g)!.map(h => parseInt(h, 16))));
    expect(tx.id).toBe(p.txid);
    expect(tx.outputsLength).toBe(1);
    const salidas = monedas.map(m => direccionDeLaBoveda(datos, m.rama, m.indice));
    monedas.forEach((m, i) => {
      // Senala RBF y no pone plazo relativo (bit 31): el camino del titular no lo necesita.
      expect(tx.getInput(i).sequence).toBe(SECUENCIA_DEL_TITULAR);
      const testigo = tx.getInput(i).finalScriptWitness;
      // Key path: un solo elemento, la firma de 64 bytes (SIGHASH_DEFAULT). Nada revela la hoja.
      expect(testigo).toHaveLength(1);
      const firma = testigo![0];
      expect(firma).toHaveLength(64);
      const resumen = tx.preimageWitnessV1(i, salidas.map(s => s.script), 0, monedas.map(x => BigInt(x.sats)));
      expect(schnorr.verify(firma, resumen, salidas[i].taproot.tweakedPubkey)).toBe(true);
    });
  });

  it('no firma con otras palabras', () => {
    expect(() => prepararMovimiento({ datos, semilla: HEREDERO, monedas: [moneda(500_000)], destino: destino(), tasaSatsVb: 2 }))
      .toThrow(expect.objectContaining({ motivo: 'otras-palabras' }));
  });

  it('solo mueve monedas confirmadas', () => {
    const intento = () => prepararMovimiento({ datos, semilla: TITULAR, monedas: [moneda(500_000, 0, 0, null)], destino: destino(), tasaSatsVb: 2 });
    expect(intento).toThrow(RechazoMovimiento);
    expect(intento).toThrow(expect.objectContaining({ motivo: 'sin-monedas' }));
  });

  it('no deja una salida bajo el minimo ni una comision mayor que la mitad', () => {
    expect(() => prepararMovimiento({ datos, semilla: TITULAR, monedas: [moneda(MINIMO_A_MOVER_SATS + 50)], destino: destino(), tasaSatsVb: 1 }))
      .toThrow(expect.objectContaining({ motivo: 'no-alcanza' }));
    expect(() => prepararMovimiento({ datos, semilla: TITULAR, monedas: [moneda(4_000)], destino: destino(), tasaSatsVb: 20 }))
      .toThrow(expect.objectContaining({ motivo: 'comision-excesiva' }));
  });

  it('redondea la tasa hacia arriba y nunca baja de 1 sat/vB', () => {
    expect(prepararMovimiento({ datos, semilla: TITULAR, monedas: [moneda(500_000)], destino: destino(), tasaSatsVb: 0.2 }).comisionSats).toBe(111);
    expect(prepararMovimiento({ datos, semilla: TITULAR, monedas: [moneda(500_000)], destino: destino(), tasaSatsVb: 1.1 }).comisionSats).toBe(222);
  });
});
