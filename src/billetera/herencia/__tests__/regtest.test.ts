// La boveda de herencia contra un Bitcoin Core real en regtest (red local).
//
// Se salta salvo que exista KP_REGTEST_RPC, por ejemplo:
//   KP_REGTEST_RPC=http://prueba:prueba@127.0.0.1:18443 npx vitest run src/billetera/herencia/__tests__/regtest.test.ts
// con un bitcoind 26 o posterior arrancado con -regtest -txindex=1 -fallbackfee=0.0002.
//
// Comprueba lo que una prueba unitaria no puede: que la red acepta lo que firma
// la app, que el heredero no puede gastar ni un bloque antes del plazo y si
// justo al cumplirse, y que Bitcoin Core con el descriptor del kit encuentra la
// boveda y cobra por la ruta del heredero.
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { TaprootControlBlock, Transaction, utils } from '@scure/btc-signer';
import { nuevaSemilla } from '../../semilla';
import { conChecksum, descriptoresPorRama, type DatosDeLaBoveda } from '../descriptor';
import { direccionDeLaBoveda } from '../direcciones';
import type { FuenteDeLaRed } from '../esplora';
import { leerEstado, plazoDe } from '../estado';
import { llaveDeLaCuenta, llavePrivadaDe, PARAMETROS, rutaDeLaCuenta, textoDeLaLlave } from '../llaves';
import { prepararMovimiento, type MonedaDeLaBoveda } from '../transacciones';

const RPC = process.env.KP_REGTEST_RPC;
const PLAZO = 10;

async function rpc<T = unknown>(method: string, params: unknown[] = [], billetera?: string): Promise<T> {
  const url = new URL(RPC as string);
  const auth = 'Basic ' + btoa(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`);
  const base = `${url.protocol}//${url.host}`;
  const r = await fetch(billetera ? `${base}/wallet/${billetera}` : base, {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '1.0', id: 'kp', method, params }),
  });
  const j = (await r.json()) as { result: T; error: { message: string } | null };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

const sats = (btc: number) => Math.round(btc * 1e8);

/** Una fuente de la red hecha con una billetera de Core que solo mira la boveda. */
function fuenteDeCore(vigia: string): FuenteDeLaRed {
  return {
    async usoDeDireccion(direccion) {
      // Las billeteras de Core se enteran de lo nuevo en otro hilo: se espera a que lleguen.
      await rpc('syncwithvalidationinterfacequeue');
      // Usada = alguna vez recibio algo (aunque ya se haya gastado).
      const usada = (await rpc<number>('getreceivedbyaddress', [direccion, 0], vigia)) > 0;
      if (!usada) return { usada, monedas: [] };
      const altura = await rpc<number>('getblockcount');
      const lista = await rpc<{ txid: string; vout: number; amount: number; confirmations: number }[]>(
        'listunspent', [0, 9_999_999, [direccion]], vigia);
      return {
        usada,
        monedas: lista.map(u => ({
          txid: u.txid,
          vout: u.vout,
          sats: sats(u.amount),
          altura: u.confirmations > 0 ? altura - u.confirmations + 1 : null,
        })),
      };
    },
    altura: () => rpc<number>('getblockcount'),
    async emitir(hex) {
      await rpc('sendrawtransaction', [hex]);
    },
    tasas: async () => ({ rapida: 3, media: 2, lenta: 1 }),
    enlaceDeTransaccion: txid => txid,
  };
}

describe.skipIf(!RPC)('boveda de herencia en regtest', () => {
  const titular = nuevaSemilla();
  const heredero = nuevaSemilla();
  const datos: DatosDeLaBoveda = {
    red: 'regtest',
    titular: llaveDeLaCuenta(titular, 'regtest'),
    heredero: llaveDeLaCuenta(heredero, 'regtest'),
    plazoBloques: PLAZO,
  };
  const sufijo = Math.random().toString(36).slice(2, 8);
  const minero = `minero-${sufijo}`;
  const vigia = `vigia-${sufijo}`;
  let red: FuenteDeLaRed;
  let paraMinar: string;

  const minar = async (n: number) => { await rpc('generatetoaddress', [n, paraMinar]); };

  beforeAll(async () => {
    await rpc('createwallet', [minero]);
    paraMinar = await rpc<string>('getnewaddress', [], minero);
    await minar(101);
    // La billetera que mira: los dos descriptores publicos de la boveda, sin llaves.
    await rpc('createwallet', [vigia, true, true]);
    const { recibir, cambio } = descriptoresPorRama(datos);
    const importados = await rpc<{ success: boolean }[]>('importdescriptors', [[
      { desc: recibir, active: false, range: [0, 50], timestamp: 'now', internal: false },
      { desc: cambio, active: false, range: [0, 50], timestamp: 'now', internal: false },
    ]], vigia);
    expect(importados.every(i => i.success)).toBe(true);
    red = fuenteDeCore(vigia);
  }, 120_000);

  let monedaRenovada: MonedaDeLaBoveda;

  it('llena, renueva por la ruta del titular y el plazo vuelve a empezar', async () => {
    const vacia = await leerEstado(datos, red);
    expect(vacia.siguienteRecibir).toBe(0);
    expect(vacia.confirmadoSats).toBe(0);

    const destino = direccionDeLaBoveda(datos, 0, vacia.siguienteRecibir).direccion;
    await rpc('sendtoaddress', [destino, 0.01], minero);
    const enCamino = await leerEstado(datos, red);
    expect(enCamino.pendienteSats).toBe(1_000_000);
    expect(enCamino.plazo).toBeNull();

    await minar(1);
    const llena = await leerEstado(datos, red);
    expect(llena.confirmadoSats).toBe(1_000_000);
    expect(llena.siguienteRecibir).toBe(1);
    expect(llena.plazo?.bloquesQueFaltan).toBe(PLAZO - 1);
    expect(llena.plazo?.nivel).toBe('tranquilo');

    await minar(5);
    const mitad = await leerEstado(datos, red);
    expect(mitad.plazo?.nivel).toBe('renovar-pronto');

    const renovacion = prepararMovimiento({
      datos,
      semilla: titular,
      monedas: mitad.monedas,
      destino: direccionDeLaBoveda(datos, 1, mitad.siguienteCambio).direccion,
      tasaSatsVb: 2,
    });
    // Una entrada taproot por la ruta de la llave y una salida taproot.
    expect(renovacion.vsize).toBe(111);
    expect(renovacion.comisionSats).toBe(222);
    const aceptada = await rpc<{ allowed: boolean; vsize: number }[]>('testmempoolaccept', [[renovacion.hex]]);
    expect(aceptada[0].allowed).toBe(true);
    expect(aceptada[0].vsize).toBe(renovacion.vsize);
    await red.emitir(renovacion.hex);
    // Emitirla otra vez (respuesta perdida) no es un error.
    await red.emitir(renovacion.hex).catch(() => undefined);
    await minar(1);

    const renovada = await leerEstado(datos, red);
    expect(renovada.siguienteCambio).toBe(1);
    expect(renovada.confirmadoSats).toBe(1_000_000 - 222);
    expect(renovada.monedas).toHaveLength(1);
    expect(renovada.plazo?.bloquesQueFaltan).toBe(PLAZO - 1);
    expect(renovada.monedas[0].txid).toBe(renovacion.txid);
    monedaRenovada = renovada.monedas[0];
  }, 120_000);

  it('el heredero no gasta un bloque antes del plazo y si al cumplirse', async () => {
    const m = monedaRenovada;
    const salida = direccionDeLaBoveda(datos, m.rama, m.indice);
    const privada = llavePrivadaDe(heredero, 'regtest', m.rama, m.indice);
    const hoja = salida.taproot.tapLeafScript;
    if (!hoja) throw new Error('la salida no trae la hoja del heredero');
    const cobrar = () => {
      const tx = new Transaction();
      tx.addInput({
        txid: m.txid,
        index: m.vout,
        sequence: PLAZO,
        witnessUtxo: { script: salida.script, amount: BigInt(m.sats) },
        tapLeafScript: hoja,
      });
      tx.addOutputAddress(paraMinar, BigInt(m.sats - 500), PARAMETROS.regtest.direcciones);
      expect(tx.signIdx(privada, 0)).toBe(true);
      // btc-signer no sabe finalizar una hoja propia: el testigo va a mano
      // (firma, script de la hoja, bloque de control), como lo hace Liana.
      const [bloque, conVersion] = hoja[0];
      const firma = tx.getInput(0).tapScriptSig?.[0]?.[1];
      if (!firma) throw new Error('sin firma');
      tx.updateInput(0, {
        finalScriptWitness: [firma, conVersion.subarray(0, -1), TaprootControlBlock.encode(bloque)],
      });
      return tx.hex;
    };

    let estado = await leerEstado(datos, red);
    while ((estado.plazo?.bloquesQueFaltan ?? 0) > 1) {
      await minar(1);
      estado = await leerEstado(datos, red);
    }
    expect(estado.plazo?.nivel).toBe('urgente');
    const antes = await rpc<{ allowed: boolean; 'reject-reason'?: string }[]>('testmempoolaccept', [[cobrar()]]);
    expect(antes[0].allowed).toBe(false);
    expect(antes[0]['reject-reason']).toBe('non-BIP68-final');

    await minar(1);
    estado = await leerEstado(datos, red);
    expect(estado.plazo?.bloquesQueFaltan).toBe(0);
    expect(estado.plazo?.nivel).toBe('vencido');
    const ahora = await rpc<{ allowed: boolean }[]>('testmempoolaccept', [[cobrar()]]);
    expect(ahora[0].allowed).toBe(true);
    await rpc('sendrawtransaction', [cobrar()]);
    await minar(1);
    expect((await leerEstado(datos, red)).confirmadoSats).toBe(0);
  }, 120_000);

  it('Bitcoin Core, con el descriptor del kit y la llave del heredero, cobra al vencer el plazo', async () => {
    // El heredero restaura: el descriptor del kit, con SU llave privada
    // extendida en lugar de su llave publica.
    const maestra = HDKey.fromMasterSeed(mnemonicToSeedSync(heredero), PARAMETROS.regtest.versiones);
    const tprv = maestra.derive(`m/${rutaDeLaCuenta('regtest')}`).privateExtendedKey;
    const publicos = descriptoresPorRama(datos);
    const conPrivada = (d: string) => conChecksum(d.slice(0, d.lastIndexOf('#')).replace(datos.heredero.xpub, tprv));
    expect(textoDeLaLlave(datos.heredero)).toContain(datos.heredero.xpub);

    const cobrador = `heredero-${sufijo}`;
    await rpc('createwallet', [cobrador, false, true]);
    const importados = await rpc<{ success: boolean }[]>('importdescriptors', [[
      { desc: conPrivada(publicos.recibir), active: false, range: [0, 50], timestamp: 'now', internal: false },
      { desc: conPrivada(publicos.cambio), active: false, range: [0, 50], timestamp: 'now', internal: false },
    ]], cobrador);
    expect(importados.every(i => i.success)).toBe(true);

    const estado = await leerEstado(datos, red);
    const llenado = await rpc<string>('sendtoaddress', [direccionDeLaBoveda(datos, 0, estado.siguienteRecibir).direccion, 0.002], minero);
    await minar(1);
    await rpc('syncwithvalidationinterfacequeue');
    const lista = await rpc<{ txid: string; vout: number; amount: number }[]>('listunspent', [1], cobrador);
    const moneda = lista.find(u => u.txid === llenado);
    if (!moneda) throw new Error('la billetera del heredero no encontro la moneda');
    expect(moneda.amount).toBe(0.002);
    const destino = await rpc<string>('getnewaddress', [], minero);

    const intentar = async () => {
      const psbt = await rpc<{ psbt: string }>('walletcreatefundedpsbt', [
        [{ txid: moneda.txid, vout: moneda.vout, sequence: PLAZO }],
        [{ [destino]: moneda.amount }],
        0,
        { add_inputs: false, subtractFeeFromOutputs: [0], fee_rate: 2 },
      ], cobrador);
      const firmado = await rpc<{ psbt: string; complete: boolean }>('walletprocesspsbt', [psbt.psbt], cobrador);
      expect(firmado.complete).toBe(true);
      const final = await rpc<{ hex: string; complete: boolean }>('finalizepsbt', [firmado.psbt]);
      return final.hex;
    };

    await minar(PLAZO - 2);
    const temprano = await rpc<{ allowed: boolean; 'reject-reason'?: string }[]>('testmempoolaccept', [[await intentar()]]);
    expect(temprano[0]['reject-reason']).toBe('non-BIP68-final');

    await minar(1);
    const hex = await intentar();
    const aceptada = await rpc<{ allowed: boolean }[]>('testmempoolaccept', [[hex]]);
    expect(aceptada[0].allowed).toBe(true);
    // Lo firmo Core por la hoja del heredero: el testigo trae firma, script y bloque de control.
    const tx = Transaction.fromRaw(Uint8Array.from(Buffer.from(hex, 'hex')));
    expect(tx.getInput(0).finalScriptWitness).toHaveLength(3);
    expect(tx.getInput(0).sequence).toBe(PLAZO);
    expect(utils.isBytes(tx.getInput(0).finalScriptWitness?.[0])).toBe(true);
  }, 120_000);

  it('el plazo calculado coincide con el de la red en el borde', () => {
    // 100 + 10 - (109 + 1) = 0: a la altura 109 el heredero ya entra en el bloque 110.
    expect(plazoDe(100, 109, PLAZO).bloquesQueFaltan).toBe(0);
    expect(plazoDe(100, 108, PLAZO).bloquesQueFaltan).toBe(1);
  });
});
