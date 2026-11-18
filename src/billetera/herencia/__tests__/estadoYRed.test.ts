// Leer la boveda en la red: el plazo, el recorrido de direcciones, la API
// Esplora con respaldo, y lo que se guarda en el telefono y va en el kit.
import es from '@/i18n/languages/es';
import { aTexto, deTexto, type BovedaGuardada } from '../almacen';
import { direccionDeLaBoveda } from '../direcciones';
import { esplora, FallaDeLaRed, TransaccionRechazada, type FuenteDeLaRed, type UsoDeDireccion } from '../esplora';
import { diasAproximados, HUECO, leerEstado, plazoDe } from '../estado';
import { contenidoDelKit, nombreDelKit, textoDelKit } from '../kit';
import { leerLlave, llaveDeLaCuenta, textoDeLaLlave } from '../llaves';
import { cabeEnLaBoveda, TOPE_POR_BOVEDA_SATS } from '../reglas';
import vectores from './vectoresDeCore.json';

const TITULAR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const HEREDERO = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const boveda: BovedaGuardada = {
  red: 'bitcoin',
  titular: llaveDeLaCuenta(TITULAR, 'bitcoin'),
  heredero: llaveDeLaCuenta(HEREDERO, 'bitcoin'),
  plazoBloques: 52_560,
  creada: '2026-11-18T12:00:00.000Z',
  nombreDelHeredero: 'Ana',
};
const TXID = (n: number) => n.toString(16).padStart(64, '0');

describe('plazo', () => {
  it('sigue BIP-68: el heredero entra en el bloque altura + N', () => {
    expect(plazoDe(100, 100, 10)).toMatchObject({ bloquesTranscurridos: 1, bloquesQueFaltan: 9, nivel: 'tranquilo' });
    expect(plazoDe(100, 104, 10)).toMatchObject({ bloquesTranscurridos: 5, nivel: 'renovar-pronto' });
    expect(plazoDe(100, 107, 10)).toMatchObject({ bloquesTranscurridos: 8, nivel: 'urgente' });
    expect(plazoDe(100, 108, 10)).toMatchObject({ bloquesQueFaltan: 1, nivel: 'urgente' });
    expect(plazoDe(100, 109, 10)).toMatchObject({ bloquesQueFaltan: 0, nivel: 'vencido' });
    expect(plazoDe(100, 500, 10).nivel).toBe('vencido');
  });

  it('los dias se redondean hacia arriba: nunca se promete mas tiempo del que hay', () => {
    expect(diasAproximados(144)).toBe(1);
    expect(diasAproximados(145)).toBe(2);
    expect(diasAproximados(0)).toBe(0);
    expect(diasAproximados(-3)).toBe(0);
    expect(diasAproximados(65_535)).toBe(456);
  });
});

describe('leer el estado', () => {
  /** Una red falsa con monedas en ciertas direcciones (rama:indice) y otras usadas pero vacias. */
  function redFalsa(monedas: Record<string, UsoDeDireccion['monedas']>, usadasVacias: string[], altura: number): FuenteDeLaRed {
    const porDireccion = new Map<string, UsoDeDireccion>();
    for (const [donde, lista] of Object.entries(monedas)) {
      const [rama, indice] = donde.split(':').map(Number) as [0 | 1, number];
      porDireccion.set(direccionDeLaBoveda(boveda, rama, indice).direccion, { usada: true, monedas: lista });
    }
    for (const donde of usadasVacias) {
      const [rama, indice] = donde.split(':').map(Number) as [0 | 1, number];
      porDireccion.set(direccionDeLaBoveda(boveda, rama, indice).direccion, { usada: true, monedas: [] });
    }
    return {
      usoDeDireccion: vi.fn(async d => porDireccion.get(d) ?? { usada: false, monedas: [] }),
      altura: async () => altura,
      emitir: async () => undefined,
      tasas: async () => ({ rapida: 3, media: 2, lenta: 1 }),
      enlaceDeTransaccion: t => t,
    };
  }

  it('recorre las dos ramas con hueco, suma confirmado y en camino, y toma la moneda mas vieja', async () => {
    const red = redFalsa(
      {
        '0:0': [{ txid: TXID(1), vout: 0, sats: 100_000, altura: 800_000 }],
        // Despues de un hueco menor que HUECO: tambien se encuentra.
        [`0:${HUECO - 1 + 3}`]: [{ txid: TXID(2), vout: 1, sats: 50_000, altura: null }],
        '1:2': [{ txid: TXID(3), vout: 0, sats: 200_000, altura: 790_000 }],
      },
      ['0:1', '1:0', '1:1'],
      800_010,
    );
    const e = await leerEstado(boveda, red);
    expect(e.confirmadoSats).toBe(300_000);
    expect(e.pendienteSats).toBe(50_000);
    expect(e.siguienteRecibir).toBe(HUECO + 3);
    expect(e.siguienteCambio).toBe(3);
    expect(e.monedas.map(m => [m.rama, m.indice])).toEqual([[0, 0], [0, HUECO + 2], [1, 2]]);
    expect(e.plazo?.alturaDeLaMasVieja).toBe(790_000);
    expect(e.plazo?.bloquesTranscurridos).toBe(10_011);
  });

  it('sin monedas confirmadas no hay plazo corriendo', async () => {
    const e = await leerEstado(boveda, redFalsa({ '0:0': [{ txid: TXID(1), vout: 0, sats: 10_000, altura: null }] }, [], 800_000));
    expect(e.plazo).toBeNull();
    expect(e.siguienteRecibir).toBe(1);
  });

  it('si una consulta falla, falla entera (nunca un saldo a medias)', async () => {
    const red = redFalsa({}, [], 800_000);
    let llamadas = 0;
    red.usoDeDireccion = async () => {
      llamadas += 1;
      if (llamadas === 3) throw new FallaDeLaRed('sin red');
      return { usada: false, monedas: [] };
    };
    await expect(leerEstado(boveda, red)).rejects.toThrow('sin red');
  });
});

describe('esplora', () => {
  const respuestas: Array<(url: string, init?: RequestInit) => Response> = [];
  beforeEach(() => {
    respuestas.length = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const r = respuestas.shift();
      if (!r) throw new Error(`sin respuesta para ${url}`);
      return r(url, init);
    }));
  });
  afterEach(() => vi.unstubAllGlobals());
  const json = (cuerpo: unknown, status = 200) => () => new Response(JSON.stringify(cuerpo), { status });
  const texto = (cuerpo: string, status = 200) => () => new Response(cuerpo, { status });

  it('si el primer servidor falla pregunta al segundo', async () => {
    respuestas.push(texto('caido', 503), texto('812345'));
    const red = esplora(['https://uno/api', 'https://dos/api']);
    expect(await red.altura()).toBe(812_345);
    const llamadas = vi.mocked(fetch).mock.calls.map(c => String(c[0]));
    expect(llamadas).toEqual(['https://uno/api/blocks/tip/height', 'https://dos/api/blocks/tip/height']);
  });

  it('lee el uso de una direccion y sus monedas', async () => {
    respuestas.push(
      json({ chain_stats: { tx_count: 2 }, mempool_stats: { tx_count: 0 } }),
      json([
        { txid: TXID(9), vout: 1, value: 1234, status: { confirmed: true, block_height: 800_001 } },
        { txid: TXID(8), vout: 0, value: 99, status: { confirmed: false } },
      ]),
    );
    const uso = await esplora(['https://uno/api']).usoDeDireccion('bc1pxyz');
    expect(uso).toEqual({
      usada: true,
      monedas: [
        { txid: TXID(9), vout: 1, sats: 1234, altura: 800_001 },
        { txid: TXID(8), vout: 0, sats: 99, altura: null },
      ],
    });
  });

  it('una direccion sin historia no pide sus monedas', async () => {
    respuestas.push(json({ chain_stats: { tx_count: 0 }, mempool_stats: { tx_count: 0 } }));
    expect(await esplora(['https://uno/api']).usoDeDireccion('bc1pxyz')).toEqual({ usada: false, monedas: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rechaza respuestas raras en vez de inventar un saldo', async () => {
    respuestas.push(
      json({ chain_stats: { tx_count: 1 }, mempool_stats: { tx_count: 0 } }),
      json([{ txid: 'no-es-un-txid', vout: 0, value: 5, status: { confirmed: true, block_height: 1 } }]),
    );
    await expect(esplora(['https://uno/api']).usoDeDireccion('bc1pxyz')).rejects.toThrow(FallaDeLaRed);
  });

  it('emitir: texto plano; una transaccion ya conocida no es un error y una rechazada si', async () => {
    respuestas.push(texto(TXID(7)));
    await esplora(['https://uno/api']).emitir('0200');
    const init = vi.mocked(fetch).mock.calls[0][1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('0200');
    expect((init?.headers as Record<string, string>)['content-type']).toBe('text/plain');

    respuestas.push(texto('sendrawtransaction RPC error: {"code":-27,"message":"Transaction already in block chain"}', 400));
    await expect(esplora(['https://uno/api']).emitir('0200')).resolves.toBeUndefined();

    // Rechazada por la red: no se reintenta en otro servidor.
    respuestas.push(texto('sendrawtransaction RPC error: {"code":-26,"message":"non-BIP68-final"}', 400));
    await expect(esplora(['https://uno/api', 'https://dos/api']).emitir('0200')).rejects.toThrow(TransaccionRechazada);
    expect(respuestas).toHaveLength(0);
  });

  it('tasas: mempool.space y el formato de Blockstream', async () => {
    respuestas.push(json({ fastestFee: 12, halfHourFee: 8, hourFee: 5, economyFee: 2, minimumFee: 1 }));
    expect(await esplora(['https://mempool.space/api']).tasas()).toEqual({ rapida: 12, media: 8, lenta: 5 });
    respuestas.push(json({ '1': 20.5, '2': 18, '3': 10.2, '6': 6.1, '144': 1 }));
    expect(await esplora(['https://blockstream.info/api']).tasas()).toEqual({ rapida: 20.5, media: 10.2, lenta: 6.1 });
  });
});

describe('lo que se guarda en el telefono', () => {
  it('va y vuelve igual, y solo trae llaves publicas', () => {
    const texto = aTexto(boveda);
    expect(deTexto(texto)).toEqual(boveda);
    expect(texto).not.toMatch(/prv|abandon|zoo/);
  });

  it('lo que no se entiende es un error, no una boveda', () => {
    expect(() => deTexto('{}')).toThrow();
    expect(() => deTexto(aTexto(boveda).replace('52560', '70000'))).toThrow();
    expect(() => deTexto(aTexto(boveda).replace(boveda.heredero.xpub, 'xpubFalsa'))).toThrow();
  });
});

describe('el kit del heredero', () => {
  const v = vectores.find(x => x.red === 'bitcoin' && x.plazo === 52_560)!;
  const t = (k: string) => (es as unknown as Record<string, string>)[k] ?? k;

  it('trae el descriptor y las direcciones que valido Core, y nada secreto', () => {
    const c = contenidoDelKit(boveda);
    expect(c.descriptor).toBe(v.descriptor);
    expect(c.recibir).toBe(v.recibir);
    expect(c.cambio).toBe(v.cambio);
    expect(c.primeraDireccion).toBe(v.direccionesRecibir[0]);
    const texto = textoDelKit(c, t, '18/11/2026');
    expect(texto).toContain(v.descriptor);
    expect(texto).toContain(v.direccionesRecibir[0]);
    expect(texto).toContain('sequence = 52560');
    expect(texto).toContain('365');
    // Ninguna llave privada extendida (las instrucciones de Core nombran "xprv", pero no traen ninguna).
    expect(texto).not.toMatch(/[xt]prv[1-9A-HJ-NP-Za-km-z]{100,}|abandon|zoo|\{(fecha|bloques|dias)\}/);
    // Sin el nombre del heredero: el archivo puede terminar en una nube.
    expect(texto).not.toContain('Ana');
    expect(nombreDelKit(boveda.creada)).toBe('kit-heredero-bitcoin-2026-11-18.txt');
  });

  it('la llave del heredero sale igual de KiramoPay y se vuelve a leer', () => {
    expect(leerLlave(textoDeLaLlave(boveda.heredero), 'bitcoin')).toEqual(boveda.heredero);
  });
});

describe('tope de prueba', () => {
  it('cuenta lo confirmado y lo que esta en camino', () => {
    expect(TOPE_POR_BOVEDA_SATS).toBe(1_000_000);
    expect(cabeEnLaBoveda(0, 0)).toBe(1_000_000);
    expect(cabeEnLaBoveda(600_000, 300_000)).toBe(100_000);
    expect(cabeEnLaBoveda(900_000, 300_000)).toBe(0);
  });
});
