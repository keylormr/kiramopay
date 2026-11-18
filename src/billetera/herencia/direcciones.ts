// Las direcciones de la boveda de herencia.
//
// Cada direccion sale de una rama (0 = recibir, 1 = cambio) y un indice, igual
// que en Liana: la llave del titular y la del heredero se derivan en el mismo
// punto, y con ellas se arma la salida taproot:
//
// - llave interna: la del titular (key path);
// - una sola hoja: <heredero> OP_CHECKSIGVERIFY <N> OP_CHECKSEQUENCEVERIFY,
//   que es and_v(v:pk(heredero),older(N)) compilado para tapscript.
import { p2tr, Script } from '@scure/btc-signer';
import type { DatosDeLaBoveda } from './descriptor';
import { PARAMETROS, publicaDe } from './llaves';

export type Rama = 0 | 1;

/** La hoja del heredero para una llave de 32 bytes (x-only) y un plazo en bloques. */
export function hojaDelHeredero(herederoXOnly: Uint8Array, plazoBloques: number): Uint8Array {
  if (herederoXOnly.length !== 32) throw new Error('la llave de la hoja debe tener 32 bytes');
  return Script.encode([herederoXOnly, 'CHECKSIGVERIFY', plazoBloques, 'CHECKSEQUENCEVERIFY']);
}

export type SalidaTaproot = ReturnType<typeof salidaTaproot>;

function salidaTaproot(d: DatosDeLaBoveda, rama: Rama, indice: number) {
  const titular = publicaDe(d.titular, d.red, rama, indice).slice(1);
  const heredero = publicaDe(d.heredero, d.red, rama, indice).slice(1);
  // allowUnknownOutputs: la hoja no es una de las plantillas que btc-signer
  // reconoce; el script lo armamos nosotros (y lo comprueban las pruebas).
  return p2tr(titular, { script: hojaDelHeredero(heredero, d.plazoBloques) }, PARAMETROS[d.red].direcciones, true);
}

export interface DireccionDeLaBoveda {
  rama: Rama;
  indice: number;
  direccion: string;
  /** El scriptPubKey de la salida. */
  script: Uint8Array;
  /** Lo que hace falta para firmar por la ruta del titular. */
  taproot: SalidaTaproot;
}

export function direccionDeLaBoveda(d: DatosDeLaBoveda, rama: Rama, indice: number): DireccionDeLaBoveda {
  if (!Number.isInteger(indice) || indice < 0 || indice >= 0x80000000) throw new Error('indice fuera de rango');
  const taproot = salidaTaproot(d, rama, indice);
  if (!taproot.address) throw new Error('sin direccion');
  return { rama, indice, direccion: taproot.address, script: taproot.script, taproot };
}
