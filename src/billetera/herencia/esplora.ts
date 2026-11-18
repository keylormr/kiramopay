// La boveda se lee y se mueve directo en la red de bitcoin, por la API publica
// Esplora (mempool.space y, si no contesta, blockstream.info). KiramoPay no
// interviene: su servidor no ve las direcciones ni las transacciones.
//
// Lo que si ven esos servicios es que alguien consulta estas direcciones, igual
// que cualquier billetera que no corre su propio nodo.

export interface MonedaEnLaRed {
  txid: string;
  vout: number;
  sats: number;
  /** Altura del bloque que la confirmo; null si esta en la mempool. */
  altura: number | null;
}

export interface UsoDeDireccion {
  /** Si alguna vez recibio o gasto algo (confirmado o en la mempool). */
  usada: boolean;
  monedas: MonedaEnLaRed[];
}

/** Sats por byte virtual para confirmar en ~10 min, ~30 min y ~1 h. */
export interface TasasDeComision {
  rapida: number;
  media: number;
  lenta: number;
}

/** Lo que la boveda necesita de la red. En las pruebas se reemplaza por una falsa. */
export interface FuenteDeLaRed {
  usoDeDireccion(direccion: string): Promise<UsoDeDireccion>;
  altura(): Promise<number>;
  /**
   * Emite una transaccion firmada. Si la red ya la conocia (un reintento
   * despues de una respuesta que no llego) tambien termina bien.
   */
  emitir(hex: string): Promise<void>;
  tasas(): Promise<TasasDeComision>;
  /** Enlace publico para ver una transaccion. */
  enlaceDeTransaccion(txid: string): string;
}

export const SERVIDORES_PRINCIPALES = ['https://mempool.space/api', 'https://blockstream.info/api'] as const;

const ESPERA_MS = 15_000;
const TXID = /^[0-9a-f]{64}$/;

export class FallaDeLaRed extends Error {}
/** La red rechazo la transaccion (no es un problema de conexion). */
export class TransaccionRechazada extends Error {}

async function pedir(url: string, init?: RequestInit): Promise<Response> {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), ESPERA_MS);
  try {
    return await fetch(url, { ...init, signal: control.signal });
  } finally {
    clearTimeout(reloj);
  }
}

function entero(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new FallaDeLaRed('respuesta invalida');
  return v;
}

function moneda(crudo: unknown): MonedaEnLaRed {
  const u = crudo as { txid?: unknown; vout?: unknown; value?: unknown; status?: { confirmed?: unknown; block_height?: unknown } };
  if (typeof u?.txid !== 'string' || !TXID.test(u.txid)) throw new FallaDeLaRed('respuesta invalida');
  const confirmada = u.status?.confirmed === true;
  return {
    txid: u.txid,
    vout: entero(u.vout),
    sats: entero(u.value),
    altura: confirmada ? entero(u.status?.block_height) : null,
  };
}

function tasa(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Una fuente Esplora con respaldo: si un servidor no contesta, pregunta al siguiente. */
export function esplora(servidores: readonly string[] = SERVIDORES_PRINCIPALES, explorador = 'https://mempool.space'): FuenteDeLaRed {
  async function conRespaldo<T>(uso: (base: string) => Promise<T>): Promise<T> {
    let ultimo: unknown;
    for (const base of servidores) {
      try {
        return await uso(base);
      } catch (e) {
        if (e instanceof TransaccionRechazada) throw e;
        ultimo = e;
      }
    }
    throw ultimo instanceof Error ? ultimo : new FallaDeLaRed('sin respuesta');
  }

  async function json(base: string, ruta: string): Promise<unknown> {
    const r = await pedir(base + ruta);
    if (!r.ok) throw new FallaDeLaRed(`HTTP ${r.status}`);
    return r.json();
  }

  return {
    usoDeDireccion: direccion => conRespaldo(async base => {
      const info = (await json(base, `/address/${direccion}`)) as {
        chain_stats?: { tx_count?: unknown };
        mempool_stats?: { tx_count?: unknown };
      };
      const usada = entero(info.chain_stats?.tx_count) + entero(info.mempool_stats?.tx_count) > 0;
      if (!usada) return { usada, monedas: [] };
      const lista = await json(base, `/address/${direccion}/utxo`);
      if (!Array.isArray(lista)) throw new FallaDeLaRed('respuesta invalida');
      return { usada, monedas: lista.map(moneda) };
    }),

    altura: () => conRespaldo(async base => {
      const r = await pedir(`${base}/blocks/tip/height`);
      if (!r.ok) throw new FallaDeLaRed(`HTTP ${r.status}`);
      const n = Number((await r.text()).trim());
      return entero(n);
    }),

    emitir: hex => conRespaldo(async base => {
      // text/plain: una peticion "simple" que no dispara la consulta previa de CORS.
      const r = await pedir(`${base}/tx`, { method: 'POST', body: hex, headers: { 'content-type': 'text/plain' } });
      const texto = (await r.text()).trim();
      if (r.ok && TXID.test(texto)) return;
      if (r.status >= 400 && r.status < 500 && r.status !== 429) {
        if (/already|txn-already-known|in block chain/i.test(texto)) return;
        throw new TransaccionRechazada(texto.slice(0, 200));
      }
      throw new FallaDeLaRed(`HTTP ${r.status}`);
    }),

    tasas: () => conRespaldo(async base => {
      if (base.includes('mempool.space')) {
        const f = (await json(base, '/v1/fees/recommended')) as Record<string, unknown>;
        const rapida = tasa(f.fastestFee);
        const media = tasa(f.halfHourFee);
        const lenta = tasa(f.hourFee);
        if (rapida && media && lenta) return { rapida, media, lenta };
        throw new FallaDeLaRed('respuesta invalida');
      }
      // Esplora de Blockstream: {"1": tasa, "3": tasa, "6": tasa, ...} por bloques objetivo.
      const e = (await json(base, '/fee-estimates')) as Record<string, unknown>;
      const rapida = tasa(e['1']) ?? tasa(e['2']);
      const media = tasa(e['3']);
      const lenta = tasa(e['6']);
      if (rapida && media && lenta) return { rapida, media, lenta };
      throw new FallaDeLaRed('respuesta invalida');
    }),

    enlaceDeTransaccion: txid => `${explorador}/tx/${txid}`,
  };
}
