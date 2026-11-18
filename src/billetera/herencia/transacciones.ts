// Mover la boveda por la ruta del titular: renovar (mandarse las monedas a una
// direccion nueva de la misma boveda, lo que reinicia el plazo del heredero) o
// sacarlas al saldo bitcoin de la billetera propia.
//
// Las dos firman igual: un gasto taproot por la ruta de la llave (key path),
// que en la cadena se ve como cualquier pago y no revela al heredero.
import { Transaction, utils } from '@scure/btc-signer';
import type { DatosDeLaBoveda } from './descriptor';
import { direccionDeLaBoveda, type Rama } from './direcciones';
import { llavePrivadaDe, PARAMETROS } from './llaves';

/** Una moneda (UTXO) de la boveda y en que direccion de la boveda esta. */
export interface MonedaDeLaBoveda {
  txid: string;
  vout: number;
  sats: number;
  rama: Rama;
  indice: number;
  /** Altura del bloque que la confirmo; null si todavia no se confirmo. */
  altura: number | null;
}

export interface MovimientoPreparado {
  /** La transaccion firmada, lista para emitir. */
  hex: string;
  txid: string;
  vsize: number;
  comisionSats: number;
  /** Lo que llega al destino: la suma de las monedas menos la comision. */
  llegaSats: number;
  destino: string;
  monedas: MonedaDeLaBoveda[];
}

export type MotivoRechazoMovimiento =
  /** No hay monedas confirmadas para mover. */
  | 'sin-monedas'
  /** Despues de la comision no queda lo suficiente para una salida valida. */
  | 'no-alcanza'
  /** La comision se comeria mas de la mitad. */
  | 'comision-excesiva'
  /** Las 12 palabras abiertas no son las del titular de esta boveda. */
  | 'otras-palabras';

export class RechazoMovimiento extends Error {
  constructor(public readonly motivo: MotivoRechazoMovimiento) {
    super(motivo);
  }
}

/**
 * Lo minimo que se manda. El limite de "polvo" de la red es 330 sats para
 * taproot y 294 para segwit v0; se deja margen.
 */
export const MINIMO_A_MOVER_SATS = 1000;

const TXID = /^[0-9a-f]{64}$/;

/**
 * nSequence de las entradas del titular: senala que se puede reemplazar con
 * mas comision (BIP-125) y, con el bit 31 encendido, no impone plazo relativo
 * (BIP-68): el camino del titular no lo necesita. Una renovacion que se queda
 * atascada en la mempool se puede rehacer mientras corre el plazo.
 */
export const SECUENCIA_DEL_TITULAR = 0xfffffffd;

function construir(
  datos: DatosDeLaBoveda,
  llaves: Uint8Array[],
  monedas: MonedaDeLaBoveda[],
  destino: string,
  llegaSats: number,
): Transaction {
  const tx = new Transaction();
  monedas.forEach((m, i) => {
    const salida = direccionDeLaBoveda(datos, m.rama, m.indice);
    tx.addInput({
      txid: m.txid,
      index: m.vout,
      sequence: SECUENCIA_DEL_TITULAR,
      witnessUtxo: { script: salida.script, amount: BigInt(m.sats) },
      tapInternalKey: salida.taproot.tapInternalKey,
      tapMerkleRoot: salida.taproot.tapMerkleRoot,
    });
    // Antes de firmar: la llave privada tiene que ser la llave interna de esa
    // direccion. Si no, estas no son las palabras del titular. (compareBytes
    // devuelve 0 cuando son iguales.)
    if (utils.compareBytes(utils.pubSchnorr(llaves[i]), salida.taproot.tapInternalKey) !== 0) {
      throw new RechazoMovimiento('otras-palabras');
    }
  });
  tx.addOutputAddress(destino, BigInt(llegaSats), PARAMETROS[datos.red].direcciones);
  llaves.forEach((llave, i) => {
    if (!tx.signIdx(llave, i)) throw new Error(`no se pudo firmar la entrada ${i}`);
    tx.finalizeIdx(i);
  });
  return tx;
}

/**
 * Arma y firma el gasto de `monedas` hacia `destino`, pagando `tasaSatsVb`
 * (sats por byte virtual). Todas las monedas van a una sola salida: la boveda
 * nunca deja cambio suelto.
 */
export function prepararMovimiento(opciones: {
  datos: DatosDeLaBoveda;
  semilla: string;
  monedas: MonedaDeLaBoveda[];
  destino: string;
  tasaSatsVb: number;
}): MovimientoPreparado {
  const { datos, semilla, destino } = opciones;
  const monedas = opciones.monedas.filter(m => m.altura !== null);
  if (monedas.length === 0) throw new RechazoMovimiento('sin-monedas');
  for (const m of monedas) {
    if (!TXID.test(m.txid) || !Number.isInteger(m.vout) || m.vout < 0 || !Number.isSafeInteger(m.sats) || m.sats <= 0) {
      throw new Error('moneda invalida');
    }
  }
  const tasa = Math.max(1, Math.ceil(opciones.tasaSatsVb));
  const total = monedas.reduce((s, m) => s + m.sats, 0);
  const llaves = monedas.map(m => llavePrivadaDe(semilla, datos.red, m.rama, m.indice));

  // Primera pasada para medir: las firmas Schnorr miden siempre 64 bytes, asi
  // que el tamano no cambia al poner el monto definitivo.
  const borrador = construir(datos, llaves, monedas, destino, total);
  const vsize = borrador.vsize;
  const comisionSats = vsize * tasa;
  const llegaSats = total - comisionSats;
  if (llegaSats < MINIMO_A_MOVER_SATS) throw new RechazoMovimiento('no-alcanza');
  if (comisionSats * 2 > total) throw new RechazoMovimiento('comision-excesiva');

  const tx = construir(datos, llaves, monedas, destino, llegaSats);
  if (tx.vsize !== vsize) throw new Error('el tamano cambio al firmar');
  return { hex: tx.hex, txid: tx.id, vsize, comisionSats, llegaSats, destino, monedas };
}
