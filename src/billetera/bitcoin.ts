// Bitcoin en la billetera propia, con Breez SDK Spark: Lightning (llega al
// instante), la red de bitcoin de siempre y direcciones Spark. Las llaves salen
// de la misma semilla y se quedan en el telefono; Breez no las ve. Si los
// operadores de Spark desaparecieran, el bitcoin se puede sacar a la red
// principal por cuenta propia (salida unilateral).
//
// El SDK pesa (un WASM de unos 12 MB) y solo se carga al abrir la billetera.
// Exige una llave de API de Breez (gratis, la pide el dueno): sin
// VITE_BREEZ_API_KEY el resto de la billetera funciona y bitcoin dice que falta
// configurarlo.
import type {
  BreezSdk,
  DepositInfo,
  InputType,
  Payment,
  PrepareLnurlPayResponse,
  PrepareSendPaymentResponse,
  SendPaymentOptions,
} from '@breeztech/breez-sdk-spark/web';
import { direccionEvm } from './evm';

const LLAVE_DE_BREEZ: string | undefined = import.meta.env.VITE_BREEZ_API_KEY;
/** Dominio de las direcciones de cobro (nombre@dominio); sin el, el de Breez. */
const DOMINIO_DE_COBRO: string | undefined = import.meta.env.VITE_BREEZ_LNURL_DOMAIN;

/** Si esta compilacion trae la llave de Breez. */
export function bitcoinConfigurado(): boolean {
  return typeof LLAVE_DE_BREEZ === 'string' && LLAVE_DE_BREEZ.length > 0;
}

let inicio: Promise<typeof import('@breeztech/breez-sdk-spark/web')> | null = null;
function modulo() {
  if (!inicio) {
    inicio = import('@breeztech/breez-sdk-spark/web').then(async m => {
      await m.default();
      return m;
    });
    // Un fallo de red al bajar el WASM no puede quedar guardado para siempre.
    inicio.catch(() => { inicio = null; });
  }
  return inicio;
}

export interface MovimientoBitcoin {
  id: string;
  tipo: 'recibido' | 'enviado';
  estado: 'completado' | 'pendiente' | 'fallido';
  sats: number;
  comisionSats: number;
  /** Segundos desde 1970. */
  fecha: number;
  via: 'lightning' | 'bitcoin' | 'spark' | 'otro';
}

export type DestinoBitcoin =
  | { tipo: 'factura'; montoFijoSats?: number }
  | { tipo: 'direccion-lightning'; direccion: string; minimoSats: number; maximoSats: number }
  | { tipo: 'direccion-bitcoin' }
  | { tipo: 'direccion-spark' };

export type MotivoRechazoBitcoin = 'destino-desconocido' | 'monto-invalido' | 'fuera-de-rango' | 'saldo-insuficiente';

export class RechazoBitcoin extends Error {
  constructor(
    public readonly motivo: MotivoRechazoBitcoin,
    /** Con 'fuera-de-rango': lo que acepta el destino. */
    public readonly rango?: { minimoSats: number; maximoSats: number },
  ) {
    super(motivo);
  }
}

export interface EnvioBitcoinPreparado {
  destino: DestinoBitcoin;
  montoSats: number;
  comisionSats: number;
  /** Lo que el SDK necesita para mandar exactamente lo que se mostro. */
  interno:
    | { via: 'pago'; respuesta: PrepareSendPaymentResponse }
    | { via: 'lnurl'; respuesta: PrepareLnurlPayResponse };
}

/**
 * Bitcoin que llego por la red de bitcoin y todavia no esta en el saldo. El SDK
 * los suma solo cuando la comision de la red cabe en su maximo; si no, quedan
 * aqui hasta que la persona acepte pagarla.
 */
export interface DepositoSinSumar {
  txid: string;
  vout: number;
  sats: number;
  /** 'comision-alta': se suma pagando `comisionSats`. 'muy-chico': la comision se lo comeria. */
  motivo: 'comision-alta' | 'muy-chico' | 'esperando';
  comisionSats?: number;
}

export interface BilleteraBitcoin {
  saldoSats(): Promise<number>;
  depositosSinSumar(): Promise<DepositoSinSumar[]>;
  /** Suma un deposito pagando a lo sumo la comision que se le mostro a la persona. */
  sumarDeposito(d: DepositoSinSumar): Promise<void>;
  /** Factura Lightning; sin monto la llena quien paga. */
  facturaLightning(descripcion: string, sats?: number): Promise<string>;
  /** Direccion de la red de bitcoin para recibir desde un exchange o billetera fria. */
  direccionBitcoin(): Promise<string>;
  /** Que es lo que la persona pego o escaneo. */
  leerDestino(texto: string): Promise<DestinoBitcoin>;
  prepararEnvio(texto: string, sats?: number): Promise<EnvioBitcoinPreparado>;
  enviar(envio: EnvioBitcoinPreparado, llave: string): Promise<void>;
  movimientos(): Promise<MovimientoBitcoin[]>;
  /** La direccion tipo correo (usuario@dominio), si ya la registro. */
  direccionLightning(): Promise<string | null>;
  nombreLibre(usuario: string): Promise<boolean>;
  registrarDireccionLightning(usuario: string): Promise<string>;
  desconectar(): Promise<void>;
}

/**
 * Donde guarda el SDK sus datos locales (IndexedDB): uno por cuenta y por
 * semilla. Si la persona quita la billetera y restaura otras palabras, la
 * nueva no hereda los movimientos de la anterior. La marca de la semilla es el
 * comienzo de su direccion EVM, que ya es publica.
 */
export function carpetaDeDatos(userId: string, semilla: string): string {
  return `kiramopay-btc-${userId}-${direccionEvm(semilla).slice(2, 12).toLowerCase()}`;
}

/** Abre la billetera de bitcoin de esta cuenta. */
export async function abrirBitcoin(semilla: string, userId: string): Promise<BilleteraBitcoin> {
  if (!bitcoinConfigurado()) throw new Error('falta VITE_BREEZ_API_KEY');
  const m = await modulo();
  const config = m.defaultConfig('mainnet');
  config.apiKey = LLAVE_DE_BREEZ;
  if (DOMINIO_DE_COBRO) config.lnurlDomain = DOMINIO_DE_COBRO;
  const sdk = await m.connect({
    config,
    seed: { type: 'mnemonic', mnemonic: semilla },
    storageDir: carpetaDeDatos(userId, semilla),
  });
  return envolver(sdk);
}

export function depositoSinSumar(d: DepositInfo): DepositoSinSumar {
  const base = { txid: d.txid, vout: d.vout, sats: d.amountSats };
  if (d.claimError?.type === 'maxDepositClaimFeeExceeded') {
    return { ...base, motivo: 'comision-alta', comisionSats: d.claimError.requiredFeeSats };
  }
  if (d.claimError?.type === 'depositTooSmall') return { ...base, motivo: 'muy-chico' };
  return { ...base, motivo: 'esperando' };
}

function sinTipo<T extends { type: string }>(entrada: T): Omit<T, 'type'> {
  const copia: Partial<T> = { ...entrada };
  delete copia.type;
  return copia as Omit<T, 'type'>;
}

function comoNumero(v: bigint | number | undefined): number {
  return v === undefined ? 0 : Number(v);
}

function destinoDe(entrada: InputType): DestinoBitcoin {
  switch (entrada.type) {
    case 'bolt11Invoice':
      return { tipo: 'factura', montoFijoSats: entrada.amountMsat ? Math.floor(entrada.amountMsat / 1000) : undefined };
    case 'lightningAddress':
      return {
        tipo: 'direccion-lightning',
        direccion: entrada.address,
        minimoSats: Math.ceil(entrada.payRequest.minSendable / 1000),
        maximoSats: Math.floor(entrada.payRequest.maxSendable / 1000),
      };
    case 'lnurlPay':
      return {
        tipo: 'direccion-lightning',
        direccion: entrada.address ?? entrada.domain,
        minimoSats: Math.ceil(entrada.minSendable / 1000),
        maximoSats: Math.floor(entrada.maxSendable / 1000),
      };
    case 'bitcoinAddress':
      return { tipo: 'direccion-bitcoin' };
    case 'sparkAddress':
      return { tipo: 'direccion-spark' };
    default:
      throw new RechazoBitcoin('destino-desconocido');
  }
}

function viaDe(p: Payment): MovimientoBitcoin['via'] {
  switch (p.method) {
    case 'lightning': return 'lightning';
    case 'deposit':
    case 'withdraw': return 'bitcoin';
    case 'spark': return 'spark';
    default: return 'otro';
  }
}

function envolver(sdk: BreezSdk): BilleteraBitcoin {
  return {
    // ensureSynced: recien abierta, la billetera todavia no tiene el saldo de
    // los operadores. Sin esperar, un saldo real se veria como cero.
    async saldoSats() {
      const info = await sdk.getInfo({ ensureSynced: true });
      return info.balanceSats;
    },

    async depositosSinSumar() {
      const r = await sdk.listUnclaimedDeposits({});
      return r.deposits.filter(d => !d.refundTx).map(depositoSinSumar);
    },

    async sumarDeposito(d) {
      if (d.motivo !== 'comision-alta' || d.comisionSats === undefined) throw new Error('este deposito no se puede sumar');
      await sdk.claimDeposit({ txid: d.txid, vout: d.vout, maxFee: { onchain: { type: 'fixed', amount: d.comisionSats } } });
    },

    async facturaLightning(descripcion, sats) {
      const r = await sdk.receivePayment({
        paymentMethod: { type: 'bolt11Invoice', description: descripcion, amountSats: sats },
      });
      return r.paymentRequest;
    },

    async direccionBitcoin() {
      const r = await sdk.receivePayment({ paymentMethod: { type: 'bitcoinAddress' } });
      return r.paymentRequest;
    },

    async leerDestino(texto) {
      let entrada: InputType;
      try {
        entrada = await sdk.parse(texto.trim());
      } catch {
        throw new RechazoBitcoin('destino-desconocido');
      }
      return destinoDe(entrada);
    },

    async prepararEnvio(texto, sats) {
      const limpio = texto.trim();
      let entrada: InputType;
      try {
        entrada = await sdk.parse(limpio);
      } catch {
        throw new RechazoBitcoin('destino-desconocido');
      }
      const destino = destinoDe(entrada);
      const saldo = (await sdk.getInfo({ ensureSynced: true })).balanceSats;

      if (destino.tipo === 'direccion-lightning') {
        if (!sats || !Number.isInteger(sats) || sats <= 0) throw new RechazoBitcoin('monto-invalido');
        if (sats < destino.minimoSats || sats > destino.maximoSats) {
          throw new RechazoBitcoin('fuera-de-rango', { minimoSats: destino.minimoSats, maximoSats: destino.maximoSats });
        }
        if (entrada.type !== 'lightningAddress' && entrada.type !== 'lnurlPay') throw new RechazoBitcoin('destino-desconocido');
        // El SDK espera solo los datos del cobro, sin la marca `type` del parse.
        const payRequest = entrada.type === 'lightningAddress' ? entrada.payRequest : sinTipo(entrada);
        const respuesta = await sdk.prepareLnurlPay({ amount: BigInt(sats), payRequest });
        if (respuesta.amountSats + respuesta.feeSats > saldo) throw new RechazoBitcoin('saldo-insuficiente');
        return { destino, montoSats: respuesta.amountSats, comisionSats: respuesta.feeSats, interno: { via: 'lnurl', respuesta } };
      }

      // Una factura con monto fijo manda ese monto; en lo demas lo pone la persona.
      const conMontoFijo = destino.tipo === 'factura' && destino.montoFijoSats !== undefined;
      const montoPedido = conMontoFijo ? undefined : sats;
      if (!conMontoFijo && (montoPedido === undefined || !Number.isInteger(montoPedido) || montoPedido <= 0)) {
        throw new RechazoBitcoin('monto-invalido');
      }
      const respuesta = await sdk.prepareSendPayment({
        paymentRequest: { type: 'input', input: limpio },
        amount: montoPedido === undefined ? undefined : BigInt(montoPedido),
      });
      const montoSats = comoNumero(respuesta.amount);
      const comisionSats = comisionDe(respuesta);
      if (montoSats + comisionSats > saldo) throw new RechazoBitcoin('saldo-insuficiente');
      return { destino, montoSats, comisionSats, interno: { via: 'pago', respuesta } };
    },

    async enviar(envio, llave) {
      if (envio.interno.via === 'lnurl') {
        await sdk.lnurlPay({ prepareResponse: envio.interno.respuesta, idempotencyKey: llave });
        return;
      }
      await sdk.sendPayment({
        prepareResponse: envio.interno.respuesta,
        idempotencyKey: llave,
        options: opcionesDeEnvio(envio.interno.respuesta),
      });
    },

    async movimientos() {
      const r = await sdk.listPayments({ limit: 50, sortAscending: false });
      // Los tokens de Spark no son bitcoin: sus montos no son sats.
      return r.payments.filter(p => p.method !== 'token').map(p => ({
        id: p.id,
        tipo: p.paymentType === 'receive' ? 'recibido' : 'enviado',
        estado: p.status === 'completed' ? 'completado' : p.status === 'pending' ? 'pendiente' : 'fallido',
        sats: comoNumero(p.amount),
        comisionSats: comoNumero(p.fees),
        fecha: p.timestamp,
        via: viaDe(p),
      }));
    },

    async direccionLightning() {
      const info = await sdk.getLightningAddress();
      return info?.lightningAddress ?? null;
    },

    async nombreLibre(usuario) {
      return sdk.checkLightningAddressAvailable({ username: usuario });
    },

    async registrarDireccionLightning(usuario) {
      const info = await sdk.registerLightningAddress({ username: usuario, description: 'KiramoPay' });
      return info.lightningAddress;
    },

    async desconectar() {
      await sdk.disconnect();
    },
  };
}

/**
 * Por donde sale el pago, fijado al preparar para que la comision mostrada sea
 * la que se cobra (ver comisionDe):
 * - red de bitcoin: velocidad media;
 * - factura Lightning: si quien cobra tambien esta en Spark, por Spark (el SDK
 *   da `sparkTransferFeeSats` solo en ese caso); si no, por Lightning.
 */
export function opcionesDeEnvio(r: PrepareSendPaymentResponse): SendPaymentOptions | undefined {
  const m = r.paymentMethod;
  if (m.type === 'bitcoinAddress') return { type: 'bitcoinAddress', confirmationSpeed: 'medium' };
  if (m.type === 'bolt11Invoice') return { type: 'bolt11Invoice', preferSpark: m.sparkTransferFeeSats !== undefined };
  return undefined;
}

/** La comision que se mostrara y se cobrara, segun por donde sale el pago. */
export function comisionDe(r: PrepareSendPaymentResponse): number {
  const m = r.paymentMethod;
  switch (m.type) {
    case 'bitcoinAddress':
      return m.feeQuote.speedMedium.userFeeSat + m.feeQuote.speedMedium.l1BroadcastFeeSat;
    case 'bolt11Invoice':
      return m.sparkTransferFeeSats ?? m.lightningFeeSats;
    case 'sparkAddress':
    case 'sparkInvoice':
      return Number(m.fee);
    case 'crossChainAddress':
      return Number(m.feeAmount) + m.sourceTransferFeeSats;
  }
}
