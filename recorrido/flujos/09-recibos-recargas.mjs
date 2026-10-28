// Pago de recibos y recargas de saldo (pestana "Servicios"). Los convenios de
// recibos estan activos fuera de produccion y el servidor solo conoce cuatro
// proveedores (ice, aya, kolbi, cabletica); la pantalla ofrece quince.
import { llave } from '../lib/entorno.mjs';
import { abrirSesion, ir, boton, ultimoDialogo, sinDialogos, verTexto, reposar } from '../lib/ui.mjs';
import { clientes, centimos, problemasDelLibro } from '../lib/comun.mjs';
import { reColones, txt } from '../lib/textos.mjs';
import * as bd from '../lib/bd.mjs';

const RECIBO = 1500;
const RECARGA = 1000;
const CLIENTE_ICE = '1234567';
const TELEFONO = '88880000';
const EXTERNO = 'SYSTEM:EXTERNAL:CRC';
// Los once proveedores del selector que el servidor no conoce.
const SIN_CONVENIO = ['cnfl', 'esph', 'coopelesca', 'esph-agua', 'claro', 'movistar', 'tigo', 'liberty', 'ccss', 'ins', 'marchamo'];

async function cerrarHoja(page) {
  await page.keyboard.press('Escape');
  await sinDialogos(page).catch(() => {});
}

export default {
  id: 'recibos-recargas',
  nombre: 'Pago de recibos y recargas',
  async ejecutar(f, ctx) {
    const api = await clientes('victor');
    let victor;
    const antes = {};

    await f.paso('Saldo y historial de servicios de victor antes de pagar', async () => {
      antes.saldo = await api.victor.saldo();
      antes.externo = bd.saldoCuenta(EXTERNO);
      antes.historial = ((await api.victor.exigir('GET', '/services/history')).data ?? []).length;
    });

    await f.paso(`Victor paga un recibo de ICE de ₡${RECIBO} desde "Servicios"`, async () => {
      victor = await abrirSesion(f, 'victor');
      await ir(victor.page, txt('Servicios'));
      await boton(victor.page, /^ICE Electricidad/).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByPlaceholder(txt('Ej: 1234567')).fill(CLIENTE_ICE);
      await hoja.getByPlaceholder('0', { exact: true }).fill(String(RECIBO));
      await boton(hoja, /^Pagar\s*₡/).click();
      await verTexto(victor.page, txt('¡Pago exitoso!'));
      await victor.page.getByText(reColones(RECIBO)).first().waitFor({ state: 'visible' });
    });

    await f.paso('El recibo baja el saldo exacto, deja su movimiento y su asiento contra la cuenta externa', async (c) => {
      const lectura = await api.victor.saldo();
      c.igual(lectura.crc, antes.saldo.crc - centimos(RECIBO), 'saldo de victor tras el recibo');
      const mov = (await api.victor.movimientos({ type: 'bill_payment', limit: '5' }))[0];
      c.exigir(mov, 'victor no tiene movimiento bill_payment');
      c.igual(mov.amount, centimos(RECIBO), 'monto del movimiento');
      c.ok(String(mov.counterparty_name).includes('ICE'), `contraparte del movimiento: ${mov.counterparty_name}`);
      c.igual(mov.status, 'completed', 'estado del movimiento');
      const lineas = bd.asiento({ tx: mov.id });
      c.ok(lineas.length === 2, `el asiento debería tener 2 líneas y tiene ${lineas.length}`);
      const deb = lineas.find((l) => l.direccion === 'debit');
      const cre = lineas.find((l) => l.direccion === 'credit');
      c.ok(deb && deb.codigo.startsWith('USER:') && Number(deb.monto) === centimos(RECIBO), 'falta el débito a la billetera de victor');
      c.ok(cre && cre.codigo === EXTERNO && Number(cre.monto) === centimos(RECIBO), `falta el crédito a ${EXTERNO}`);
      c.igual(bd.saldoCuenta(EXTERNO), antes.externo + centimos(RECIBO), 'saldo de la cuenta externa');
      const historial = (await api.victor.exigir('GET', '/services/history')).data ?? [];
      c.igual(historial.length, antes.historial + 1, 'filas en GET /services/history');
      c.igual(historial[0]?.client_id, CLIENTE_ICE, 'cliente de la fila del historial');
      c.igual(historial[0]?.amount, centimos(RECIBO), 'monto de la fila del historial');
    });

    await f.paso('Victor cierra el comprobante y recarga ₡1.000 a un número de Kolbi', async () => {
      await boton(ultimoDialogo(victor.page), txt('Listo'), { exacto: true }).click();
      await sinDialogos(victor.page);
      antes.recarga = await api.victor.saldo();
      await victor.page.getByRole('tab', { name: txt('Recarga'), exact: true }).click();
      await reposar(victor.page, 400);
      await boton(victor.page, /Kolbi/).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByPlaceholder('8888-0000').fill(TELEFONO);
      await boton(hoja, reColones(RECARGA)).first().click();
      await boton(hoja, /^Recarga\s*₡/).click();
      await verTexto(victor.page, txt('¡Recarga exitosa!'));
    });

    await f.paso('La recarga baja el saldo exacto y deja su movimiento y su asiento', async (c) => {
      c.igual((await api.victor.saldo()).crc, antes.recarga.crc - centimos(RECARGA), 'saldo de victor tras la recarga');
      const mov = (await api.victor.movimientos({ type: 'recharge', limit: '5' }))[0];
      c.exigir(mov, 'victor no tiene movimiento recharge');
      c.igual(mov.amount, centimos(RECARGA), 'monto del movimiento');
      const lineas = bd.asiento({ tx: mov.id });
      const cre = lineas.find((l) => l.direccion === 'credit');
      c.ok(cre && cre.codigo === EXTERNO && Number(cre.monto) === centimos(RECARGA), `falta el crédito a ${EXTERNO}`);
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('El historial de la pantalla lista el recibo y la recarga', async () => {
      await boton(ultimoDialogo(victor.page), txt('Listo'), { exacto: true }).click().catch(() => {});
      await sinDialogos(victor.page).catch(() => {});
      await victor.page.getByRole('tab', { name: txt('Historial'), exact: true }).click();
      await reposar(victor.page, 600);
      await verTexto(victor.page, txt('Pagos de servicios'));
      await verTexto(victor.page, new RegExp(`Cliente:\\s*${CLIENTE_ICE}`));
      await verTexto(victor.page, /\+506\s?8888-?0000/);
    });

    await f.paso('Repetir el pago con la misma llave no cobra dos veces; con otros datos se rechaza', async (c) => {
      const k = llave('recibo');
      const cuerpo = { provider_code: 'aya', client_id: '7654321', amount: centimos(500), period: 'octubre de 2026', idempotency_key: k };
      const base = (await api.victor.saldo()).crc;
      const r1 = await api.victor.post('/services/pay-bill', cuerpo);
      c.respuesta(r1, 200, 'primer pago de ₡500 a AyA');
      const r2 = await api.victor.post('/services/pay-bill', cuerpo);
      c.respuesta(r2, 200, 'repetición con la misma llave');
      c.ok(r2.data?.replayed === true, `la repetición debería traer replayed:true: ${JSON.stringify(r2.data)}`);
      c.igual(r2.data?.transaction_id, r1.data?.transaction_id, 'la repetición devuelve la misma transacción');
      c.igual((await api.victor.saldo()).crc, base - centimos(500), 'se cobra UNA sola vez');
      c.respuesta(await api.victor.post('/services/pay-bill', { ...cuerpo, amount: centimos(600) }), 409, 'misma llave con otro monto', 'LLAVE_REUTILIZADA');
      const rr = llave('recarga');
      const recarga = { operator: 'claro', phone: '88880001', amount: centimos(500), idempotency_key: rr };
      c.respuesta(await api.victor.post('/services/recharge', recarga), 200, 'recarga de ₡500 a Claro');
      const repetida = await api.victor.post('/services/recharge', recarga);
      c.respuesta(repetida, 200, 'repetir la recarga con la misma llave');
      c.ok(repetida.data?.replayed === true, 'la recarga repetida debería traer replayed:true');
      c.igual((await api.victor.saldo()).crc, base - centimos(1000), 'saldo tras el recibo y la recarga de ₡500');
    });

    await f.paso('Rechazos del servidor: proveedor y operador desconocidos, monto cero, ₡100.000 sin segundo factor', async (c) => {
      const base = (await api.victor.saldo()).crc;
      const cuerpo = { provider_code: 'ice', client_id: CLIENTE_ICE, amount: centimos(100), period: 'octubre de 2026' };
      c.respuesta(await api.victor.post('/services/pay-bill', { ...cuerpo, provider_code: 'no-existe', idempotency_key: llave('recibo') }), 400, 'proveedor desconocido', 'INVALID_PROVIDER');
      c.respuesta(await api.victor.post('/services/recharge', { operator: 'no-existe', phone: TELEFONO, amount: 100, idempotency_key: llave('recarga') }), 400, 'operador desconocido', 'INVALID_OPERATOR');
      c.respuesta(await api.victor.post('/services/pay-bill', { ...cuerpo, amount: 0, idempotency_key: llave('recibo') }), 400, 'monto cero', 'VALIDATION_ERROR');
      c.respuesta(await api.victor.post('/services/pay-bill', { ...cuerpo, client_id: '', idempotency_key: llave('recibo') }), 400, 'cliente vacío', 'VALIDATION_ERROR');
      c.respuesta(await api.victor.post('/services/pay-bill', { ...cuerpo, amount: 10000000, idempotency_key: llave('recibo') }), 428, 'recibo de ₡100.000 sin segundo factor', 'MFA_REQUIRED');
      c.respuesta(await api.victor.post('/services/recharge', { operator: 'kolbi', phone: TELEFONO, amount: 10000000, idempotency_key: llave('recarga') }), 428, 'recarga de ₡100.000 sin segundo factor', 'MFA_REQUIRED');
      c.igual((await api.victor.saldo()).crc, base, 'los rechazos no deben mover plata');
    });

    await f.paso('Los quince proveedores de la pantalla se pueden pagar', async (c) => {
      // Defecto conocido: la pantalla ofrece once proveedores que el servidor no tiene dados
      // de alta; al pagarlos responde INVALID_PROVIDER y la pantalla dice solo "No se pudo
      // completar la acción".
      const base = (await api.victor.saldo()).crc;
      const rechazados = [];
      for (const codigo of SIN_CONVENIO) {
        const r = await api.victor.post('/services/pay-bill', { provider_code: codigo, client_id: CLIENTE_ICE, amount: 100, period: 'octubre de 2026', idempotency_key: llave('recibo') });
        if (r.status !== 200) rechazados.push(`${codigo} (${r.codigo ?? r.status})`);
      }
      const cobrado = base - (await api.victor.saldo()).crc;
      c.ok(rechazados.length === 0, `${rechazados.length} de ${SIN_CONVENIO.length} proveedores del selector el servidor los rechaza: ${rechazados.join(', ')}`);
      c.ok(cobrado === 100 * (SIN_CONVENIO.length - rechazados.length), `los rechazos no deben cobrar: se cobraron ${cobrado} centavos`);
    }, { seguir: true });

    await f.paso('Un recibo de CNFL (proveedor del selector) se paga desde la pantalla', async () => {
      await ir(victor.page, txt('Servicios'));
      await victor.page.getByRole('tab', { name: txt('Servicios'), exact: true }).click();
      await reposar(victor.page, 400);
      await boton(victor.page, /^CNFL/).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByPlaceholder(txt('Ej: 1234567')).fill(CLIENTE_ICE);
      await hoja.getByPlaceholder('0', { exact: true }).fill('1000');
      await boton(hoja, /^Pagar\s*₡/).click();
      const exito = await victor.page.getByText(txt('¡Pago exitoso!')).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
      if (!exito) {
        const aviso = await victor.page.locator('[role=alert], [role=status]').allInnerTexts().catch(() => []);
        await cerrarHoja(victor.page);
        throw new Error(`pagar a CNFL, uno de los quince proveedores de la pantalla, no se pudo: la pantalla mostró ${JSON.stringify(aviso.filter(Boolean))}`);
      }
    }, { seguir: true });
  },
};
