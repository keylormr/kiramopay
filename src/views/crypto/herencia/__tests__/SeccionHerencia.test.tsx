import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import es from '@/i18n/languages/es';
import type { BilleteraBitcoin } from '@/billetera/bitcoin';
import type { BovedaGuardada } from '@/billetera/herencia/almacen';
import type { FuenteDeLaRed } from '@/billetera/herencia/esplora';
import vectores from '@/billetera/herencia/__tests__/vectoresDeCore.json';

// La boveda de herencia vista por la persona: solo aparece si el servidor la
// ofrece, nunca acepta palabras secretas como llave del heredero, avisa segun
// el plazo y no deja pasar el tope de prueba.
const api = vi.hoisted(() => ({ getAvailability: vi.fn() }));
vi.mock('@/api', () => ({ getApiLayer: () => ({ crypto: { getAvailability: api.getAvailability } }) }));

const almacen = vi.hoisted(() => ({ leer: vi.fn(), guardar: vi.fn(), borrar: vi.fn(), anotar: vi.fn() }));
vi.mock('@/billetera/herencia/almacen', async importOriginal => ({
  ...(await importOriginal<typeof import('@/billetera/herencia/almacen')>()),
  leerBovedaGuardada: almacen.leer,
  guardarBoveda: almacen.guardar,
  borrarBovedaGuardada: almacen.borrar,
  anotarMovimiento: almacen.anotar,
}));

const red = vi.hoisted(() => ({ fuente: null as FuenteDeLaRed | null }));
vi.mock('@/billetera/herencia/esplora', async importOriginal => ({
  ...(await importOriginal<typeof import('@/billetera/herencia/esplora')>()),
  esplora: () => red.fuente,
}));

const huella = vi.hoisted(() => ({ confirmarConHuella: vi.fn() }));
vi.mock('@/billetera/boveda', () => ({ confirmarConHuella: huella.confirmarConHuella }));

const qr = vi.hoisted(() => ({ valor: '' }));
vi.mock('@/components/QrScannerPanel', () => ({
  QrScannerPanel: ({ onDecode, error }: { onDecode: (v: string) => boolean | void; error?: string }) => (
    <div>
      <button type="button" onClick={() => onDecode(qr.valor)}>leer</button>
      {error && <p>{error}</p>}
    </div>
  ),
}));

import { leerLlave, llaveDeLaCuenta, textoDeLaLlave } from '@/billetera/herencia/llaves';
import { direccionDeLaBoveda } from '@/billetera/herencia/direcciones';
import { SeccionHerencia } from '../SeccionHerencia';

const TITULAR = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const HEREDERO = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';
const OTRO = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const llaveDelHeredero = textoDeLaLlave(llaveDeLaCuenta(HEREDERO, 'bitcoin'));
const PRINCIPAL_52560 = vectores.find(v => v.red === 'bitcoin' && v.plazo === 52_560)!;

const bovedaDe = (titular: string): BovedaGuardada => ({
  red: 'bitcoin',
  titular: llaveDeLaCuenta(titular, 'bitcoin'),
  heredero: leerLlave(llaveDelHeredero, 'bitcoin'),
  plazoBloques: 52_560,
  creada: '2026-11-18T12:00:00.000Z',
  nombreDelHeredero: 'Ana',
});

/** Una red falsa: la primera direccion de recibir tiene una moneda confirmada a la altura 800.000. */
function redCon(alturaActual: number, sats = 500_000): FuenteDeLaRed & { emitir: ReturnType<typeof vi.fn> } {
  const primera = direccionDeLaBoveda(bovedaDe(TITULAR), 0, 0).direccion;
  return {
    usoDeDireccion: vi.fn(async (d: string) => d === primera
      ? { usada: true, monedas: [{ txid: 'ab'.repeat(32), vout: 0, sats, altura: 800_000 }] }
      : { usada: false, monedas: [] }),
    altura: vi.fn(async () => alturaActual),
    emitir: vi.fn(async () => undefined),
    tasas: vi.fn(async () => ({ rapida: 5, media: 2, lenta: 1 })),
    enlaceDeTransaccion: (txid: string) => `https://mempool.space/tx/${txid}`,
  };
}

const btcFalso = (): BilleteraBitcoin => ({
  prepararEnvio: vi.fn(async (_d: string, sats?: number) => ({
    destino: { tipo: 'direccion-bitcoin' }, montoSats: sats ?? 0, comisionSats: 300,
    interno: { via: 'pago', respuesta: {} },
  })),
  enviar: vi.fn(async () => undefined),
  direccionBitcoin: vi.fn(async () => 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'),
} as unknown as BilleteraBitcoin);

/** Una red donde la boveda nunca recibio nada. */
function redVacia(): FuenteDeLaRed & { emitir: ReturnType<typeof vi.fn> } {
  return { ...redCon(800_100), usoDeDireccion: vi.fn(async () => ({ usada: false, monedas: [] })) };
}

const haceUnaHora = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();
const NO_OFRECIDA = { success: true, data: { purchasesActive: true, selfCustodyActive: true, inheritanceVaultActive: false } };

function montar(btc: BilleteraBitcoin | null = btcFalso(), extra: { onEnviando?: (e: boolean) => void } = {}) {
  render(
    <LanguageProvider>
      <SeccionHerencia semilla={TITULAR} btc={btc} userId="u1" onEnviando={extra.onEnviando} />
    </LanguageProvider>,
  );
  return btc;
}

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  api.getAvailability.mockReset().mockResolvedValue({ success: true, data: { purchasesActive: true, selfCustodyActive: true, inheritanceVaultActive: true } });
  almacen.leer.mockReset().mockResolvedValue({ estado: 'no-hay' });
  almacen.guardar.mockReset().mockResolvedValue(undefined);
  almacen.borrar.mockReset().mockResolvedValue(undefined);
  almacen.anotar.mockReset().mockResolvedValue(undefined);
  huella.confirmarConHuella.mockReset().mockResolvedValue(true);
  red.fuente = redCon(800_100);
  qr.valor = '';
});

afterEach(() => vi.restoreAllMocks());

describe('la boveda de herencia', () => {
  it('no aparece si el servidor no la ofrece y no hay boveda', async () => {
    api.getAvailability.mockResolvedValue(NO_OFRECIDA);
    montar();
    await waitFor(() => expect(api.getAvailability).toHaveBeenCalled());
    await waitFor(() => expect(almacen.leer).toHaveBeenCalled());
    expect(screen.queryByText(es.hb_titulo)).not.toBeInTheDocument();
  });

  it('con la bandera cerrada, quien ya tiene una boveda puede renovar y sacar, pero no llenar', async () => {
    api.getAvailability.mockResolvedValue(NO_OFRECIDA);
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: bovedaDe(TITULAR) });
    montar();
    expect(await screen.findByText(es.hb_titulo)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(es.hb_renovar) })).toBeEnabled());
    expect(screen.getByRole('button', { name: new RegExp(es.hb_sacar) })).toBeEnabled();
    expect(screen.getByRole('button', { name: new RegExp(es.hb_kit) })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(es.hb_llenar) })).not.toBeInTheDocument();
  });

  it('el heredero ve su llave publica con su origen, nunca sus palabras', async () => {
    montar();
    await userEvent.click(await screen.findByRole('button', { name: es.hb_soy_heredero }));
    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText(textoDeLaLlave(llaveDeLaCuenta(TITULAR, 'bitcoin')))).toBeInTheDocument();
    expect(within(hoja).queryByText(/abandon/)).not.toBeInTheDocument();
  });

  it('crear: rechaza palabras secretas y la llave propia, y guarda la boveda con la del heredero', async () => {
    montar();
    await userEvent.click(await screen.findByRole('button', { name: es.hb_crear }));
    const hoja = await screen.findByRole('dialog');
    const continuar = within(hoja).getByRole('button', { name: es.continue });
    expect(continuar).toBeDisabled();
    await userEvent.click(within(hoja).getByRole('checkbox'));
    await userEvent.click(continuar);

    qr.valor = HEREDERO;
    await userEvent.click(within(hoja).getByRole('button', { name: 'leer' }));
    expect(within(hoja).getByText(es.hb_err_llave_palabras)).toBeInTheDocument();

    qr.valor = textoDeLaLlave(llaveDeLaCuenta(TITULAR, 'bitcoin'));
    await userEvent.click(within(hoja).getByRole('button', { name: 'leer' }));
    expect(within(hoja).getByText(es.hb_err_llave_tuya)).toBeInTheDocument();

    qr.valor = `${llaveDelHeredero}/<0;1>/*`;
    await userEvent.click(within(hoja).getByRole('button', { name: 'leer' }));
    await userEvent.type(within(hoja).getByRole('textbox'), 'Ana');
    await userEvent.click(within(hoja).getByRole('button', { name: es.continue }));
    // 12 meses por defecto.
    expect(within(hoja).getByRole('radio', { name: new RegExp(es.hb_plazo_12) })).toBeChecked();
    await userEvent.click(within(hoja).getByRole('button', { name: es.continue }));

    // La primera direccion es la que dio Bitcoin Core para esta boveda.
    expect(within(hoja).getByText(PRINCIPAL_52560.direccionesRecibir[0])).toBeInTheDocument();
    await userEvent.click(within(hoja).getByRole('button', { name: es.hb_crear_confirmar }));
    await waitFor(() => expect(almacen.guardar).toHaveBeenCalledTimes(1));
    expect(huella.confirmarConHuella).toHaveBeenCalledWith(es.hb_crear_razon);
    const [usuario, guardada] = almacen.guardar.mock.calls[0];
    expect(usuario).toBe('u1');
    expect(guardada).toMatchObject({ red: 'bitcoin', plazoBloques: 52_560, nombreDelHeredero: 'Ana' });
    expect(textoDeLaLlave(guardada.heredero)).toBe(llaveDelHeredero);
    expect(textoDeLaLlave(guardada.titular)).toBe(PRINCIPAL_52560.titular);
  });

  it('sin huella no se crea nada', async () => {
    huella.confirmarConHuella.mockResolvedValue(false);
    montar();
    await userEvent.click(await screen.findByRole('button', { name: es.hb_crear }));
    const hoja = await screen.findByRole('dialog');
    await userEvent.click(within(hoja).getByRole('checkbox'));
    await userEvent.click(within(hoja).getByRole('button', { name: es.continue }));
    qr.valor = llaveDelHeredero;
    await userEvent.click(within(hoja).getByRole('button', { name: 'leer' }));
    await userEvent.click(within(hoja).getByRole('button', { name: es.continue }));
    await userEvent.click(within(hoja).getByRole('button', { name: es.continue }));
    await userEvent.click(within(hoja).getByRole('button', { name: es.hb_crear_confirmar }));
    await waitFor(() => expect(huella.confirmarConHuella).toHaveBeenCalled());
    expect(almacen.guardar).not.toHaveBeenCalled();
  });

  it('con 85 % del plazo transcurrido avisa que hay que renovar ya', async () => {
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: bovedaDe(TITULAR) });
    red.fuente = redCon(800_000 + Math.round(52_560 * 0.85));
    montar();
    expect(await screen.findByText(/Renueva ya/)).toBeInTheDocument();
    expect(screen.getByText('0.005')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });

  it('una lectura fallida de la red no se pinta como boveda vacia', async () => {
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: bovedaDe(TITULAR) });
    const fuente = redCon(800_100);
    fuente.altura = vi.fn(async () => { throw new Error('sin red'); });
    red.fuente = fuente;
    montar();
    expect(await screen.findByText(es.hb_err_lectura)).toBeInTheDocument();
    expect(screen.queryByText(es.hb_vacia)).not.toBeInTheDocument();
  });

  it('una boveda de otras palabras no se puede mover desde aqui', async () => {
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: bovedaDe(OTRO) });
    montar();
    expect(await screen.findByText(es.hb_otras_palabras)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(es.hb_renovar) })).not.toBeInTheDocument();
  });

  it('llenar no deja pasar el tope de 0,01 BTC y anota el envio antes de mandarlo', async () => {
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: bovedaDe(TITULAR) });
    const onEnviando = vi.fn();
    const btc = montar(btcFalso(), { onEnviando });
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(es.hb_llenar) }));
    const hoja = await screen.findByRole('dialog');
    // Ya hay 500.000 sats: caben 500.000 mas.
    await userEvent.type(within(hoja).getByRole('textbox'), '500001');
    await userEvent.click(within(hoja).getByRole('button', { name: es.bp_revisar }));
    expect(within(hoja).getByText(/Supera el tope/)).toBeInTheDocument();
    expect(btc?.prepararEnvio).not.toHaveBeenCalled();

    await userEvent.clear(within(hoja).getByRole('textbox'));
    await userEvent.type(within(hoja).getByRole('textbox'), '500000');
    await userEvent.click(within(hoja).getByRole('button', { name: es.bp_revisar }));
    // Va a la siguiente direccion de recibir de la boveda, no a otra.
    const siguiente = direccionDeLaBoveda(bovedaDe(TITULAR), 0, 1).direccion;
    await waitFor(() => expect(btc?.prepararEnvio).toHaveBeenCalledWith(siguiente, 500_000));
    await userEvent.click(within(hoja).getByRole('button', { name: es.hb_llenar_confirmar }));
    await waitFor(() => expect(btc?.enviar).toHaveBeenCalledTimes(1));
    expect(await within(hoja).findByText(es.hb_llenar_hecho)).toBeInTheDocument();

    // Anotado ANTES de mandar, con la direccion y el monto: si la respuesta se
    // pierde, la boveda no se puede quitar y lo enviado cuenta para el tope.
    expect(almacen.anotar).toHaveBeenCalledTimes(1);
    expect(almacen.anotar.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(btc!.enviar).mock.invocationCallOrder[0]);
    const [usuario, nuevo] = almacen.anotar.mock.calls[0];
    expect(usuario).toBe('u1');
    expect(nuevo(undefined).llenado).toEqual({ indice: 1, sats: 500_000 });
    // Mientras se manda, la billetera no se cierra por pasar a segundo plano.
    expect(onEnviando.mock.calls).toEqual([[true], [false]]);
  });

  it('un llenado dudoso se reintenta con la misma llave y no se suma dos veces', async () => {
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: bovedaDe(TITULAR) });
    const btc = btcFalso();
    vi.mocked(btc.enviar).mockRejectedValueOnce(new Error('sin respuesta'));
    montar(btc);
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(es.hb_llenar) }));
    const hoja = await screen.findByRole('dialog');
    await userEvent.type(within(hoja).getByRole('textbox'), '1000');
    await userEvent.click(within(hoja).getByRole('button', { name: es.bp_revisar }));
    await userEvent.click(await within(hoja).findByRole('button', { name: es.hb_llenar_confirmar }));
    expect(await within(hoja).findByText(es.bp_err_envio)).toBeInTheDocument();
    await userEvent.click(within(hoja).getByRole('button', { name: es.hb_llenar_confirmar }));
    await waitFor(() => expect(btc.enviar).toHaveBeenCalledTimes(2));
    const llaves = vi.mocked(btc.enviar).mock.calls.map(c => c[1]);
    expect(llaves[0]).toBe(llaves[1]);
    // El segundo anota sin sumar: el primero ya estaba anotado.
    const previo = almacen.anotar.mock.calls[0][1](undefined);
    expect(almacen.anotar.mock.calls[1][1](previo).llenado).toEqual({ indice: 1, sats: 1000 });
  });

  it('el monto son solo digitos: "1e3" no son 1.000 sats', async () => {
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: bovedaDe(TITULAR) });
    const btc = montar();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(es.hb_llenar) }));
    const hoja = await screen.findByRole('dialog');
    await userEvent.type(within(hoja).getByRole('textbox'), '1e3');
    await userEvent.click(within(hoja).getByRole('button', { name: es.bp_revisar }));
    expect(within(hoja).getByText(es.bp_err_monto)).toBeInTheDocument();
    expect(btc?.prepararEnvio).not.toHaveBeenCalled();
  });

  it('lo enviado que la red todavia no muestra cuenta para el tope', async () => {
    const boveda = { ...bovedaDe(TITULAR), movimiento: { en: haceUnaHora(), llenado: { indice: 1, sats: 300_000 } } };
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda });
    const btc = montar();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(es.hb_llenar) }));
    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText(/todavía no aparece en la red/)).toBeInTheDocument();
    // 500.000 confirmados + 300.000 en camino: caben 200.000.
    await userEvent.type(within(hoja).getByRole('textbox'), '200001');
    await userEvent.click(within(hoja).getByRole('button', { name: es.bp_revisar }));
    expect(within(hoja).getByText(/Supera el tope/)).toBeInTheDocument();
    expect(btc?.prepararEnvio).not.toHaveBeenCalled();
  });

  it('una boveda vacia se puede quitar, salvo que se haya movido hace poco', async () => {
    red.fuente = redVacia();
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: bovedaDe(TITULAR) });
    montar();
    expect(await screen.findByText(es.hb_vacia)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: es.hb_quitar }));
    const hoja = await screen.findByRole('dialog');
    // Justo antes de borrar se mira lo guardado: un envio anotado recien manda.
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: { ...bovedaDe(TITULAR), movimiento: { en: haceUnaHora() } } });
    await userEvent.click(within(hoja).getByRole('button', { name: es.hb_quitar_confirmar }));
    expect(await within(hoja).findByText(es.hb_err_quitar_reciente)).toBeInTheDocument();
    expect(almacen.borrar).not.toHaveBeenCalled();
  });

  it('recien movida, la boveda vacia no ofrece quitarla', async () => {
    red.fuente = redVacia();
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: { ...bovedaDe(TITULAR), movimiento: { en: haceUnaHora() } } });
    montar();
    expect(await screen.findByText(es.hb_vacia)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: es.hb_quitar })).not.toBeInTheDocument();
  });

  it('una tasa absurda de la API no deja firmar: se dice y no se emite nada', async () => {
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: bovedaDe(TITULAR) });
    const fuente = redCon(800_100);
    fuente.tasas = vi.fn(async () => ({ rapida: 90_000, media: 50_000, lenta: 20_000 }));
    red.fuente = fuente;
    montar();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(es.hb_renovar) }));
    const hoja = await screen.findByRole('dialog');
    expect(await within(hoja).findByText(es.hb_err_tasa)).toBeInTheDocument();
    expect(within(hoja).queryByRole('button', { name: new RegExp(es.hb_mover_confirmar_renovar) })).not.toBeInTheDocument();
    expect(huella.confirmarConHuella).not.toHaveBeenCalled();
    expect(fuente.emitir).not.toHaveBeenCalled();
    expect(almacen.anotar).not.toHaveBeenCalled();
  });

  it('renovar firma hacia la siguiente direccion de cambio y emite con la huella', async () => {
    almacen.leer.mockResolvedValue({ estado: 'hay', boveda: bovedaDe(TITULAR) });
    const fuente = redCon(800_100);
    red.fuente = fuente;
    montar();
    await userEvent.click(await screen.findByRole('button', { name: new RegExp(es.hb_renovar) }));
    const hoja = await screen.findByRole('dialog');
    const cambio = direccionDeLaBoveda(bovedaDe(TITULAR), 1, 0).direccion;
    expect(await within(hoja).findByText(cambio)).toBeInTheDocument();
    // 111 vB a 2 sat/vB.
    expect(within(hoja).getByText('222 sats')).toBeInTheDocument();
    await userEvent.click(within(hoja).getByRole('button', { name: new RegExp(es.hb_mover_confirmar_renovar) }));
    await waitFor(() => expect(fuente.emitir).toHaveBeenCalledTimes(1));
    expect(huella.confirmarConHuella).toHaveBeenCalledWith(es.hb_mover_razon);
    expect(await within(hoja).findByText(es.hb_mover_hecho_renovar)).toBeInTheDocument();
    // Anotado antes de emitir; un llenado sin ver no se pierde por renovar.
    expect(almacen.anotar.mock.invocationCallOrder[0]).toBeLessThan(fuente.emitir.mock.invocationCallOrder[0]);
    const previo = { en: '2026-11-18T00:00:00.000Z', llenado: { indice: 1, sats: 7 } };
    expect(almacen.anotar.mock.calls[0][1](previo).llenado).toEqual(previo.llenado);
  });
});
