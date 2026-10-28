// Cripto: victor compra, vende y envia a keilor; keilor lo recibe. Los precios
// vienen del simulador de CoinGecko del workflow (precios fijos), asi que los
// numeros son deterministas; lo que se prueba es la logica del servidor.
import { CUENTAS, llave } from '../lib/entorno.mjs';
import { abrirSesion, ir, boton, ultimoDialogo, dialogo, sinDialogos, verTexto } from '../lib/ui.mjs';
import { clientes, centimos, qrPersonal, problemasDelLibro } from '../lib/comun.mjs';
import { txt } from '../lib/textos.mjs';
import * as bd from '../lib/bd.mjs';
import { peticion } from '../lib/api.mjs';

const SIMBOLOS = 'BTC,ETH,SOL,ADA,DOT,AVAX,LINK,MATIC,UNI,ATOM';
const COMPRA_USD = 60;
const VENTA_ETH = 0.005;
const ENVIO_ETH = 0.005;

const num = (v) => Number(v);

async function activo(api, simbolo) {
  const r = await api.exigir('GET', '/crypto/assets');
  return (r.data ?? []).find((a) => a.symbol === simbolo) ?? null;
}

async function movimientoCripto(api, tipo) {
  const r = await api.exigir('GET', '/crypto/transactions');
  return (r.data ?? []).find((t) => t.type === tipo) ?? null;
}

export default {
  id: 'cripto',
  nombre: 'Cripto: comprar, vender y enviar',
  async ejecutar(f, ctx) {
    const api = await clientes('victor', 'keilor');
    let victor;
    let precioEth;
    let qrKeilor;
    const antes = {};

    await f.paso('El servidor tiene precio para las 10 monedas y un tipo de cambio vigente', async (c) => {
      const r = await peticion('GET', `/crypto/prices?symbols=${SIMBOLOS}`);
      c.respuesta(r, 200, 'GET /crypto/prices');
      for (const s of SIMBOLOS.split(',')) {
        c.ok(r.data?.[s] && r.data[s].price > 0, `sin precio para ${s} (¿se cayó el simulador de CoinGecko?)`);
      }
      precioEth = r.data?.ETH?.price;
      const fx = await peticion('GET', '/exchange-rates');
      const usdCrc = (fx.data ?? []).find((t) => t.from_currency === 'USD' && t.to_currency === 'CRC');
      c.ok(usdCrc && usdCrc.rate > 0, 'no hay tipo de cambio USD a CRC (¿se cayó el simulador de Hacienda del workflow?)');
      // La venta que publica el simulador de Hacienda (recorrido/simulador/terceros.mjs): el servidor ya no trae
      // un tipo de cambio de reserva, asi que este es el que confirmo la fuente.
      c.cercano(usdCrc?.rate, 451.25, 1e-6, 'tipo de cambio USD a CRC (la venta del simulador de Hacienda)');
      ctx.estado.tasaUsdCrc = usdCrc?.rate;
      c.exigir(precioEth > 0, 'sin precio de ETH no se puede seguir');
    });

    await f.paso('Victor no tiene cripto al empezar y abre la pantalla de Cripto', async (c) => {
      c.igual((await api.victor.exigir('GET', '/crypto/assets')).data?.length ?? 0, 0, 'activos de victor al empezar');
      Object.assign(antes, { saldo: await api.victor.saldo() });
      victor = await abrirSesion(f, 'victor');
      await Promise.all([
        victor.page.waitForResponse((r) => r.url().includes('/crypto/prices') && r.status() === 200),
        ir(victor.page, txt('Cripto')),
      ]);
      await victor.page.locator(`[role=status][aria-label="${txt('Precios actualizados')}"]`).waitFor({ state: 'visible', timeout: 15000 });
      await verTexto(victor.page, txt('Mi portafolio'));
    });

    await f.paso(`Comprar US$${COMPRA_USD} de ETH desde la pantalla`, async () => {
      await boton(victor.page, txt('Comprar'), { exacto: true }).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByRole('combobox').selectOption('ETH');
      await hoja.getByPlaceholder('0.00').fill(String(COMPRA_USD));
      await boton(hoja, 'Comprar ETH', { exacto: true }).click();
      await sinDialogos(victor.page, 15000);
    });

    await f.paso('La compra bajó dólares, subió ETH y quedó en el libro', async (c) => {
      const despues = await api.victor.saldo();
      c.igual(despues.usd, antes.saldo.usd - centimos(COMPRA_USD), 'saldo USD de victor');
      c.igual(despues.crc, antes.saldo.crc, 'el saldo CRC no debe moverse');
      const eth = await activo(api.victor, 'ETH');
      c.exigir(eth, 'victor no tiene ETH después de comprar');
      c.cercano(eth.balance, COMPRA_USD / precioEth, 1e-9, 'cantidad de ETH comprada');
      c.cercano(eth.avg_cost, precioEth, 0.01, 'costo promedio (USD)');
      const mov = await movimientoCripto(api.victor, 'buy');
      c.exigir(mov, 'no hay movimiento de cripto tipo buy');
      c.igual(mov.asset, 'ETH', 'activo de la compra');
      c.igual(mov.currency, 'USD', 'moneda de la compra');
      c.cercano(mov.total, COMPRA_USD, 0.005, 'total pagado');
      const fila = (await api.victor.movimientos({ type: 'crypto_buy', limit: '5' }))[0];
      c.exigir(fila, 'no hay fila crypto_buy en el historial de movimientos');
      c.igual(fila.amount, centimos(COMPRA_USD), 'monto de la fila crypto_buy');
      c.igual(fila.currency, 'USD', 'moneda de la fila crypto_buy');
      const lineas = bd.asiento({ tx: fila.id });
      const deb = bd.lineaDe(lineas, bd.cuentaUsuario(CUENTAS.victor.id, 'USD'), 'debit');
      const cre = bd.lineaDe(lineas, 'SYSTEM:EXTERNAL:USD', 'credit');
      c.ok(deb && Number(deb.monto) === centimos(COMPRA_USD), 'falta el débito a la cuenta USD de victor en el libro');
      c.ok(cre && Number(cre.monto) === centimos(COMPRA_USD), 'falta el crédito a SYSTEM:EXTERNAL:USD en el libro');
      // Comprar cripto baja lo que se le debe a victor y la plata deja de respaldar a nadie: la reserva se la
      // entrega al capital propio en el mismo asiento, para seguir igual al pasivo.
      const aCapital = bd.lineaDe(lineas, 'SYSTEM:CAPITAL:USD', 'debit');
      const deLaReserva = bd.lineaDe(lineas, 'SYSTEM:RESERVE:USD', 'credit');
      c.ok(aCapital && Number(aCapital.monto) === centimos(COMPRA_USD), `falta el débito al capital propio (SYSTEM:CAPITAL:USD) en el asiento de la compra: ${JSON.stringify(lineas)}`);
      c.ok(deLaReserva && Number(deLaReserva.monto) === centimos(COMPRA_USD), `falta el crédito a la reserva (SYSTEM:RESERVE:USD) en el asiento de la compra: ${JSON.stringify(lineas)}`);
      c.ok(lineas.length === 4, `el asiento de la compra debería tener 4 líneas y tiene ${lineas.length}: ${JSON.stringify(lineas)}`);
      ctx.estado.cripto = { ethComprado: num(eth.balance) };
    });

    await f.paso('La pantalla muestra el ETH comprado en el portafolio', async () => {
      await boton(victor.page, /Ethereum/).first().waitFor({ state: 'visible', timeout: 15000 });
      await victor.page.getByText(/Compra\s+USD\s*→\s*ETH/).first().waitFor({ state: 'visible', timeout: 15000 });
    });

    await f.paso(`Vender ${VENTA_ETH} ETH y recibir colones`, async (c) => {
      antes.venta = { saldo: await api.victor.saldo(), eth: num((await activo(api.victor, 'ETH')).balance) };
      await boton(victor.page, /Ethereum/).first().click();
      const detalle = ultimoDialogo(victor.page);
      await boton(detalle, txt('Vender'), { exacto: true }).click();
      const hoja = dialogo(victor.page, 'Vender ETH');
      await hoja.waitFor({ state: 'visible' });
      await hoja.getByPlaceholder('0.00').fill(String(VENTA_ETH));
      await boton(hoja, /Vender y recibir CRC/).click();
      await sinDialogos(victor.page, 15000);
      c.ok(true, '');
    });

    await f.paso('La venta bajó ETH y acreditó colones, sin pasar por el tope diario', async (c) => {
      const mov = await movimientoCripto(api.victor, 'sell');
      c.exigir(mov, 'no hay movimiento de cripto tipo sell');
      c.igual(mov.currency, 'CRC', 'moneda de la venta');
      const despues = await api.victor.saldo();
      const acreditado = centimos(num(mov.total));
      c.igual(despues.crc - antes.venta.saldo.crc, acreditado, 'colones acreditados (según el total del movimiento)');
      c.cercano(num(mov.total), VENTA_ETH * precioEth * ctx.estado.tasaUsdCrc, 1, 'total en colones = cantidad × precio × tipo de cambio');
      c.igual(despues.usd, antes.venta.saldo.usd, 'el saldo USD no debe moverse');
      const eth = num((await activo(api.victor, 'ETH')).balance);
      c.cercano(eth, antes.venta.eth - VENTA_ETH, 1e-12, 'ETH restante');
      const fila = (await api.victor.movimientos({ type: 'crypto_sell', limit: '5' }))[0];
      c.exigir(fila, 'no hay fila crypto_sell en el historial');
      const lineas = bd.asiento({ tx: fila.id });
      const cre = bd.lineaDe(lineas, bd.cuentaUsuario(CUENTAS.victor.id, 'CRC'), 'credit');
      c.ok(cre && Number(cre.monto) === acreditado, 'falta el crédito a la cuenta CRC de victor en el libro');
      // Vender sube lo que se le debe a victor: el capital propio pone esos colones en la reserva en el mismo asiento.
      const alaReserva = bd.lineaDe(lineas, 'SYSTEM:RESERVE:CRC', 'debit');
      const delCapital = bd.lineaDe(lineas, 'SYSTEM:CAPITAL:CRC', 'credit');
      c.ok(alaReserva && Number(alaReserva.monto) === acreditado, `falta el débito a la reserva (SYSTEM:RESERVE:CRC) en el asiento de la venta: ${JSON.stringify(lineas)}`);
      c.ok(delCapital && Number(delCapital.monto) === acreditado, `falta el crédito al capital propio (SYSTEM:CAPITAL:CRC) en el asiento de la venta: ${JSON.stringify(lineas)}`);
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('Keilor obtiene su código QR personal (en lugar de escanearlo con la cámara)', async (c) => {
      qrKeilor = await qrPersonal(api.keilor, 'CRC');
      c.ok(/^KP:p2p_receive:[0-9a-f]{8}:0:(CRC|USD):i[0-9a-f]{24}$/.test(qrKeilor), `código QR con forma inesperada: ${qrKeilor}`);
      antes.envio = {
        victorEth: num((await activo(api.victor, 'ETH')).balance),
        keilorEth: num((await activo(api.keilor, 'ETH')).balance),
        victorSaldo: await api.victor.saldo(),
        keilorSaldo: await api.keilor.saldo(),
      };
    });

    await f.paso(`Victor envía ${ENVIO_ETH} ETH a keilor pegando su código`, async () => {
      await boton(victor.page, /Ethereum/).first().click();
      await boton(ultimoDialogo(victor.page), txt('Enviar'), { exacto: true }).click();
      const hoja = dialogo(victor.page, 'Enviar ETH');
      await hoja.waitFor({ state: 'visible' });
      await hoja.locator('#qr-manual-code').fill(qrKeilor);
      await boton(hoja, txt('Continuar'), { exacto: true }).click();
      // El nombre de quien recibe se resuelve recien cuando hay monto ("Le llega a: —" antes).
      await hoja.getByPlaceholder('0.00').fill(String(ENVIO_ETH));
      await verTexto(victor.page, CUENTAS.keilor.nombre);
      // La vista previa llega ~400 ms despues de teclear: trae la comision.
      await verTexto(victor.page, txt('Comisión de KiramoPay'));
      await boton(hoja, 'Enviar ETH', { exacto: true }).click();
      const confirmar = dialogo(victor.page, txt('Confirmar'));
      await confirmar.waitFor({ state: 'visible' });
      await boton(confirmar, 'Enviar ETH', { exacto: true }).click();
      await sinDialogos(victor.page, 15000);
    });

    await f.paso('El envío movió ETH (con comisión del 0,25 %) y ninguna billetera en dinero', async (c) => {
      const fee = ENVIO_ETH * 0.0025;
      const vEth = num((await activo(api.victor, 'ETH')).balance);
      const kEth = num((await activo(api.keilor, 'ETH')).balance);
      c.cercano(vEth, antes.envio.victorEth - ENVIO_ETH - fee, 1e-12, 'ETH de victor');
      c.cercano(kEth, antes.envio.keilorEth + ENVIO_ETH, 1e-12, 'ETH de keilor');
      const vS = await api.victor.saldo();
      const kS = await api.keilor.saldo();
      c.igual(vS.crc, antes.envio.victorSaldo.crc, 'CRC de victor');
      c.igual(vS.usd, antes.envio.victorSaldo.usd, 'USD de victor');
      c.igual(kS.crc, antes.envio.keilorSaldo.crc, 'CRC de keilor');
      c.igual(kS.usd, antes.envio.keilorSaldo.usd, 'USD de keilor');
      const mov = await movimientoCripto(api.victor, 'send');
      c.exigir(mov, 'victor no tiene movimiento de cripto tipo send');
      c.cercano(mov.amount, ENVIO_ETH, 1e-12, 'cantidad enviada');
      c.cercano(mov.fee, fee, 1e-12, 'comisión cobrada');
      c.igual(mov.counterparty_name, CUENTAS.keilor.nombre, 'nombre del destinatario');
      const recibo = await movimientoCripto(api.keilor, 'receive');
      c.exigir(recibo, 'keilor no tiene movimiento de cripto tipo receive');
      c.cercano(recibo.amount, ENVIO_ETH, 1e-12, 'cantidad recibida');
      const comisiones = bd.consultar(`SELECT amount::text AS monto FROM crypto_platform_fees WHERE crypto_tx_id = '${mov.id}'`);
      c.ok(comisiones.length === 1 && Math.abs(num(comisiones[0].monto) - fee) < 1e-12, `la comisión no quedó registrada en crypto_platform_fees: ${JSON.stringify(comisiones)}`);
      const fila = (await api.victor.movimientos({ type: 'crypto_send', limit: '5' }))[0];
      c.ok(!!fila, 'no hay fila crypto_send en el historial de victor');
    });

    await f.paso('Keilor ve el ETH recibido en su pantalla de Cripto', async () => {
      const keilor = await abrirSesion(f, 'keilor');
      await ir(keilor.page, txt('Cripto'));
      await keilor.page.getByText(`${txt('Recibido')} ETH`).first().waitFor({ state: 'visible', timeout: 15000 });
    });

    await f.paso('Convertir ETH a SOL por la API y repetir con la misma llave', async (c) => {
      const k = llave('convert');
      const cuerpo = { from_asset: 'ETH', to_asset: 'SOL', from_amount: 0.002, idempotency_key: k };
      const antesEth = num((await activo(api.victor, 'ETH')).balance);
      const r1 = await api.victor.post('/crypto/convert', cuerpo);
      c.respuesta(r1, 201, 'convertir');
      const esperadoSol = (0.002 * precioEth) / (await peticion('GET', '/crypto/prices?symbols=SOL')).data.SOL.price;
      c.cercano(r1.data?.total, esperadoSol, 1e-9, 'SOL recibidos');
      const r2 = await api.victor.post('/crypto/convert', cuerpo);
      c.respuesta(r2, 201, 'repetir la conversión');
      c.igual(r2.data?.replayed, true, 'la repetición debe marcarse replayed');
      c.cercano(num((await activo(api.victor, 'ETH')).balance), antesEth - 0.002, 1e-12, 'ETH restante (se convierte UNA vez)');
      const r3 = await api.victor.post('/crypto/convert', { ...cuerpo, from_amount: 0.003 });
      c.respuesta(r3, 409, 'misma llave con otra cantidad', 'LLAVE_REUTILIZADA');
    });

    await f.paso('Rechazos del servidor: más de lo que tiene, tope diario en dólares y envío a uno mismo', async (c) => {
      const saldoAntes = await api.victor.saldo();
      const r1 = await api.victor.post('/crypto/sell', { asset: 'ETH', amount: 5, to_currency: 'CRC', idempotency_key: llave('sell') });
      c.respuesta(r1, 422, 'vender más ETH del que tiene', 'CRYPTO_INSUFFICIENT_BALANCE');
      // Ya se gastaron ~75 de los 190 USD del dia: comprar 150 los pasa.
      const r2 = await api.victor.post('/crypto/buy', { asset: 'ETH', from_currency: 'USD', from_amount: 150, idempotency_key: llave('buy') });
      c.respuesta(r2, 422, 'comprar por encima del tope diario', 'DAILY_LIMIT_EXCEEDED');
      const r3 = await api.victor.post('/crypto/send/preview', { asset: 'ETH', amount: 0.001, qr_data: await qrPersonal(api.victor, 'CRC') });
      c.respuesta(r3, 400, 'enviarse cripto a uno mismo', 'CRYPTO_SEND_SELF');
      const r4 = await api.victor.post('/crypto/send/preview', { asset: 'ETH', amount: 0.001, qr_data: 'KP:no-es-un-codigo' });
      c.respuesta(r4, 400, 'código QR mal formado', 'QR_INVALIDO');
      const saldoDespues = await api.victor.saldo();
      c.igual(saldoDespues.usd, saldoAntes.usd, 'los rechazos no deben mover dólares');
      c.igual(saldoDespues.crc, saldoAntes.crc, 'los rechazos no deben mover colones');
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('Casos límite por API: cantidad ínfima, par repetido y activo en minúsculas', async (c) => {
      // Una cantidad que vale menos de un centavo no se puede anotar: se rechaza con un 400 claro antes de mover
      // nada. Convertir un activo en si mismo no hace nada: 400 de par invalido. Un simbolo en minusculas es el
      // mismo activo: se acepta.
      const eth0 = num((await activo(api.victor, 'ETH')).balance);
      const saldo0 = await api.victor.saldo();
      const polvo = await api.victor.post('/crypto/send', { asset: 'ETH', amount: 0.00000001, qr_data: qrKeilor, idempotency_key: llave('polvo') });
      c.respuesta(polvo, 400, 'enviar una cantidad que vale menos de un centavo', 'CRYPTO_INVALID_AMOUNT');
      c.cercano(num((await activo(api.victor, 'ETH')).balance), eth0, 1e-12, 'ETH de victor tras el envío de la cantidad ínfima');
      const igual = await api.victor.post('/crypto/convert', { from_asset: 'ETH', to_asset: 'ETH', from_amount: 0.0001, idempotency_key: llave('convert') });
      c.respuesta(igual, 400, 'convertir ETH a ETH', 'CRYPTO_INVALID_PAIR');
      const igualEnMinusculas = await api.victor.post('/crypto/convert', { from_asset: 'eth', to_asset: 'ETH', from_amount: 0.0001, idempotency_key: llave('convert') });
      c.respuesta(igualEnMinusculas, 400, 'convertir "eth" a ETH (el mismo activo escrito distinto)', 'CRYPTO_INVALID_PAIR');
      c.cercano(num((await activo(api.victor, 'ETH')).balance), eth0, 1e-12, 'ETH de victor tras convertir un activo en sí mismo');
      c.igual((await api.victor.saldo()).usd, saldo0.usd, 'dólares de victor tras los rechazos');
      const minusculas = await api.victor.post('/crypto/buy', { asset: 'eth', from_currency: 'USD', from_amount: 1, idempotency_key: llave('buy') });
      c.respuesta(minusculas, 201, 'comprar US$1 de "eth" en minúsculas');
      c.igual((await api.victor.saldo()).usd, saldo0.usd - centimos(1), 'dólares de victor tras comprar con el símbolo en minúsculas');
      c.cercano(num((await activo(api.victor, 'ETH')).balance), eth0 + 1 / precioEth, 1e-9, 'ETH de victor tras comprar con el símbolo en minúsculas');
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    }, { seguir: true });
  },
};
