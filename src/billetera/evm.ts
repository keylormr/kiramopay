// Ethereum y las redes que comparten su formato de direccion (EVM): ETH, LINK y
// UNI en Ethereum, POL en Polygon y AVAX en la C-Chain de Avalanche. Las cinco
// salen de la misma llave (m/44'/60'/0'/0/0, la ruta de MetaMask y de casi
// todas las billeteras), asi que la persona tiene UNA direccion para todas.
//
// Todo se firma en el telefono con viem. A la red solo sale la transaccion ya
// firmada; la llave no sale nunca.
//
// Los nodos son los publicos que trae viem, o los de VITE_RPC_* si se
// configuran. Si el uso crece, hara falta un proveedor con contrato.
import {
  createPublicClient,
  createWalletClient,
  erc20Abi,
  formatUnits,
  getAddress,
  http,
  isAddress,
  parseUnits,
  type Address,
  type Chain,
  type Hash,
} from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { avalanche, mainnet, polygon } from 'viem/chains';

export type RedEvm = 'ethereum' | 'polygon' | 'avalanche';
export type SimboloEvm = 'ETH' | 'LINK' | 'UNI' | 'POL' | 'AVAX';

export interface ActivoEvm {
  simbolo: SimboloEvm;
  /** El simbolo con que lo lista el resto de la app (MATIC antes de la migracion a POL). */
  simboloDelCatalogo: string;
  nombre: string;
  red: RedEvm;
  /** Contrato ERC-20; sin contrato es la moneda propia de la red. */
  contrato?: Address;
  decimales: number;
}

// Contratos verificados en la red el 13-11-2026 (symbol, decimals y name
// leidos del propio contrato).
export const ACTIVOS_EVM: readonly ActivoEvm[] = [
  { simbolo: 'ETH', simboloDelCatalogo: 'ETH', nombre: 'Ethereum', red: 'ethereum', decimales: 18 },
  { simbolo: 'LINK', simboloDelCatalogo: 'LINK', nombre: 'Chainlink', red: 'ethereum', contrato: '0x514910771AF9Ca656af840dff83E8264EcF986CA', decimales: 18 },
  { simbolo: 'UNI', simboloDelCatalogo: 'UNI', nombre: 'Uniswap', red: 'ethereum', contrato: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', decimales: 18 },
  { simbolo: 'POL', simboloDelCatalogo: 'MATIC', nombre: 'Polygon', red: 'polygon', decimales: 18 },
  { simbolo: 'AVAX', simboloDelCatalogo: 'AVAX', nombre: 'Avalanche', red: 'avalanche', decimales: 18 },
];

const CADENAS: Record<RedEvm, Chain> = { ethereum: mainnet, polygon, avalanche };

/** La moneda con que se paga la comision en cada red. */
export const MONEDA_DE_LA_RED: Record<RedEvm, SimboloEvm> = { ethereum: 'ETH', polygon: 'POL', avalanche: 'AVAX' };

/** El nombre de cada red tal como lo muestran las billeteras y los exchanges. */
export const NOMBRE_DE_LA_RED: Record<RedEvm, string> = { ethereum: 'Ethereum', polygon: 'Polygon', avalanche: 'Avalanche C-Chain' };

const NODO_CONFIGURADO: Record<RedEvm, string | undefined> = {
  ethereum: import.meta.env.VITE_RPC_ETHEREUM,
  polygon: import.meta.env.VITE_RPC_POLYGON,
  avalanche: import.meta.env.VITE_RPC_AVALANCHE,
};

function transporte(red: RedEvm) {
  return http(NODO_CONFIGURADO[red] || undefined, { timeout: 15_000, retryCount: 1 });
}

const clientes = new Map<RedEvm, ReturnType<typeof createPublicClient>>();
function lector(red: RedEvm) {
  let c = clientes.get(red);
  if (!c) {
    c = createPublicClient({ chain: CADENAS[red], transport: transporte(red) });
    clientes.set(red, c);
  }
  return c;
}

/** La direccion de la persona en las redes EVM (la misma en las tres). */
export function direccionEvm(semilla: string): Address {
  return mnemonicToAccount(semilla, { addressIndex: 0 }).address;
}

/** El enlace al explorador de la red para una transaccion. */
export function enlaceDeTransaccion(red: RedEvm, hash: string): string {
  return `${CADENAS[red].blockExplorers?.default.url}/tx/${hash}`;
}

/** El enlace al explorador de la red para una direccion (sus movimientos). */
export function enlaceDeDireccion(red: RedEvm, direccion: string): string {
  return `${CADENAS[red].blockExplorers?.default.url}/address/${direccion}`;
}

/** Saldo en la unidad minima (wei o equivalente). */
export async function saldoEvm(activo: ActivoEvm, direccion: Address): Promise<bigint> {
  const c = lector(activo.red);
  if (!activo.contrato) return c.getBalance({ address: direccion });
  return c.readContract({ address: activo.contrato, abi: erc20Abi, functionName: 'balanceOf', args: [direccion] });
}

/** El saldo como texto decimal exacto, sin pasar por float. */
export function saldoLegible(activo: ActivoEvm, minimo: bigint): string {
  return formatUnits(minimo, activo.decimales);
}

/** La comision maxima del envio en la moneda de la red (las tres usan 18 decimales). */
export function comisionLegible(envio: { comisionMaxima: bigint }): string {
  return formatUnits(envio.comisionMaxima, 18);
}

export type MotivoRechazoEvm =
  | 'direccion-invalida'
  | 'a-si-mismo'
  | 'monto-invalido'
  | 'saldo-insuficiente'
  | 'sin-saldo-para-comision';

export class RechazoEvm extends Error {
  constructor(public readonly motivo: MotivoRechazoEvm) {
    super(motivo);
  }
}

export interface EnvioEvmPreparado {
  activo: ActivoEvm;
  desde: Address;
  hacia: Address;
  monto: bigint;
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  /** Lo maximo que puede costar la comision, en la moneda de la red. */
  comisionMaxima: bigint;
  /**
   * El numero de la transaccion en la cuenta, fijado al preparar. Firmar dos
   * veces el mismo envio da la misma transaccion: la red acepta una sola.
   */
  nonce: number;
}

/**
 * Valida y calcula el envio sin mover nada. La comision es la maxima que la
 * red puede cobrar (gas x precio maximo): lo que se muestra antes de confirmar
 * nunca es menos de lo que se paga.
 *
 * `nonce` se pasa cuando un intento anterior de este mismo envio pudo haber
 * llegado a la red: con el mismo numero, la red no lo cobra dos veces.
 */
export async function prepararEnvioEvm(
  semilla: string,
  activo: ActivoEvm,
  destinoTexto: string,
  montoTexto: string,
  opciones: { nonce?: number } = {},
): Promise<EnvioEvmPreparado> {
  const destino = destinoTexto.trim();
  // Estricto: una direccion con mayusculas y minusculas mezcladas tiene que
  // cuadrar con su suma de verificacion (EIP-55). Asi un caracter mal copiado
  // se rechaza en vez de mandar el dinero a una direccion que nadie controla.
  if (!isAddress(destino)) throw new RechazoEvm('direccion-invalida');
  const hacia = getAddress(destino);
  const desde = direccionEvm(semilla);
  if (hacia === desde) throw new RechazoEvm('a-si-mismo');

  let monto: bigint;
  try {
    monto = parseUnits(montoTexto.trim().replace(',', '.'), activo.decimales);
  } catch {
    throw new RechazoEvm('monto-invalido');
  }
  if (monto <= 0n) throw new RechazoEvm('monto-invalido');

  const c = lector(activo.red);
  const [saldo, saldoDeLaRed, tarifas, nonce] = await Promise.all([
    saldoEvm(activo, desde),
    activo.contrato ? c.getBalance({ address: desde }) : Promise.resolve(0n),
    c.estimateFeesPerGas(),
    opciones.nonce ?? c.getTransactionCount({ address: desde, blockTag: 'pending' }),
  ]);
  if (saldo < monto) throw new RechazoEvm('saldo-insuficiente');

  const estimado = activo.contrato
    ? await c.estimateContractGas({ address: activo.contrato, abi: erc20Abi, functionName: 'transfer', args: [hacia, monto], account: desde })
    : await c.estimateGas({ account: desde, to: hacia, value: monto });
  // Un envio simple entre cuentas gasta siempre 21.000. Lo demas (contratos de
  // tokens, cuentas que son contratos) puede gastar algo mas al ejecutarse que
  // al estimarse: un 20 % de margen evita que la transaccion falle y cobre la
  // comision igual. El margen solo sube el maximo; la red cobra lo que se usa.
  const gas = estimado === GAS_DE_UN_ENVIO_SIMPLE ? estimado : (estimado * 12n) / 10n;
  const comisionMaxima = gas * tarifas.maxFeePerGas;

  const disponibleParaComision = activo.contrato ? saldoDeLaRed : saldo - monto;
  if (disponibleParaComision < comisionMaxima) throw new RechazoEvm('sin-saldo-para-comision');

  return {
    activo,
    desde,
    hacia,
    monto,
    gas,
    maxFeePerGas: tarifas.maxFeePerGas,
    maxPriorityFeePerGas: tarifas.maxPriorityFeePerGas,
    comisionMaxima,
    nonce,
  };
}

const GAS_DE_UN_ENVIO_SIMPLE = 21_000n;

/** Firma en el telefono y entrega la transaccion a la red. Devuelve su hash. */
export async function enviarEvm(semilla: string, envio: EnvioEvmPreparado): Promise<Hash> {
  const account = mnemonicToAccount(semilla, { addressIndex: 0 });
  if (account.address !== envio.desde) throw new Error('la semilla no corresponde al envio preparado');
  const firmante = createWalletClient({ account, chain: CADENAS[envio.activo.red], transport: transporte(envio.activo.red) });
  const tarifas = { gas: envio.gas, maxFeePerGas: envio.maxFeePerGas, maxPriorityFeePerGas: envio.maxPriorityFeePerGas, nonce: envio.nonce };
  if (envio.activo.contrato) {
    return firmante.writeContract({
      address: envio.activo.contrato,
      abi: erc20Abi,
      functionName: 'transfer',
      args: [envio.hacia, envio.monto],
      ...tarifas,
    });
  }
  return firmante.sendTransaction({ to: envio.hacia, value: envio.monto, ...tarifas });
}

/**
 * La direccion a la que pagar desde un codigo QR, o null si el codigo no sirve
 * para esta moneda. Acepta la direccion sola y los enlaces de pago EIP-681:
 * - `ethereum:0xDESTINO[@red]`: paga a esa direccion;
 * - `ethereum:0xCONTRATO[@red]/transfer?address=0xDESTINO`: pide un token. El
 *   0x del principio es el contrato, NO quien cobra: tomarlo mandaria el
 *   dinero al contrato y se perderia.
 * Se rechaza el codigo de otra red (`@137` es Polygon) y el que pide otro token.
 */
export function destinoDeUnQrEvm(crudo: string, activo: ActivoEvm): Address | null {
  const texto = crudo.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(texto)) return isAddress(texto) ? getAddress(texto) : null;

  const m = texto.match(/^ethereum:(?:pay-)?(0x[0-9a-fA-F]{40})(?:@(\d+))?(?:\/([A-Za-z0-9_]+))?(?:\?(.*))?$/i);
  if (!m) return null;
  const [, objetivo, red, funcion, consulta] = m;
  if (red !== undefined && Number(red) !== CADENAS[activo.red].id) return null;

  let destino: string | null;
  if (funcion === undefined) {
    destino = objetivo;
  } else if (funcion === 'transfer' && activo.contrato && objetivo.toLowerCase() === activo.contrato.toLowerCase()) {
    destino = new URLSearchParams(consulta ?? '').get('address');
  } else {
    return null;
  }
  return destino && isAddress(destino) ? getAddress(destino) : null;
}
