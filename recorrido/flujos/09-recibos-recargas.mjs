// Pago de recibos y recargas de saldo (pestana "Servicios"). Los convenios de
// recibos estan activos fuera de produccion. La lista de empresas y de operadores
// que la pantalla ofrece sale del servidor (GET /services/providers): el recorrido
// no lleva una lista propia, usa la que el servidor publica y comprueba que todo
// lo que ofrece se puede pagar.
import { llave } from '../lib/entorno.mjs';
import { abrirSesion, ir, boton, ultimoDialogo, sinDialogos, verTexto, reposar } from '../lib/ui.mjs';
import { clientes, centimos, problemasDelLibro } from '../lib/comun.mjs';
import { reColones, txt, escapar } from '../lib/textos.mjs';
import * as bd from '../lib/bd.mjs';

const RECIBO = 1500;
const RECARGA = 1000;
const CLIENTE_ICE = '1234567';
const TELEFONO = '88880000';
// Pagar un recibo o recargar saca la plata del sistema: el pasivo con victor y la reserva bajan lo mismo.
const RESERVA = 'SYSTEM:RESERVE:CRC';

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
    let catalogo; // lo que el servidor ofrece: { agreements_active, providers: [{code, name, category}], operators: [{code, name}] }
    const antes = {};
    const nombreDe = (codigo) => catalogo.providers.find((p) => p.code === codigo)?.name;
    const operadorDe = (codigo) => catalogo.operators.find((o) => o.code === codigo)?.name;

    await f.paso('El servidor publica las empresas y los operadores que la pantalla ofrece, y el cobro se puede entregar', async (c) => {
      const r = await api.victor.exigir('GET', '/services/providers');
      catalogo = r.data;
      c.igual(catalogo.agreements_active, true, 'agreements_active (los convenios están activos fuera de producción)');
      c.ok(Array.isArray(catalogo.providers) && catalogo.providers.length > 0, `la lista de empresas viene vacía: ${JSON.stringify(catalogo)}`);
      c.ok(Array.isArray(catalogo.operators) && catalogo.operators.length > 0, `la lista de operadores viene vacía: ${JSON.stringify(catalogo)}`);
      for (const codigo of ['ice', 'aya', 'cabletica']) c.ok(nombreDe(codigo), `la empresa ${codigo} no está en la lista del servidor: ${JSON.stringify(catalogo.providers)}`);
      for (const codigo of ['kolbi', 'claro', 'movistar']) c.ok(operadorDe(codigo), `el operador ${codigo} no está en la lista del servidor: ${JSON.stringify(catalogo.operators)}`);
    });

    await f.paso('Saldo y historial de servicios de victor antes de pagar', async () => {
      antes.saldo = await api.victor.saldo();
      antes.reserva = bd.saldoCuenta(RESERVA);
      antes.historial = ((await api.victor.exigir('GET', '/services/history')).data ?? []).length;
    });

    await f.paso(`Victor paga un recibo de ICE de ₡${RECIBO} desde "Servicios"`, async () => {
      victor = await abrirSesion(f, 'victor');
      await ir(victor.page, txt('Servicios'));
      await boton(victor.page, new RegExp(`^${escapar(nombreDe('ice'))}`)).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByPlaceholder(txt('Ej: 1234567')).fill(CLIENTE_ICE);
      await hoja.getByPlaceholder('0', { exact: true }).fill(String(RECIBO));
      await boton(hoja, /^Pagar\s*₡/).click();
      await verTexto(victor.page, txt('¡Pago exitoso!'));
      await victor.page.getByText(reColones(RECIBO)).first().waitFor({ state: 'visible' });
    });

    await f.paso('El recibo baja el saldo exacto, deja su movimiento y su asiento contra la reserva', async (c) => {
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
      c.ok(cre && cre.codigo === RESERVA && Number(cre.monto) === centimos(RECIBO), `falta el crédito a ${RESERVA}`);
      c.igual(bd.saldoCuenta(RESERVA), antes.reserva - centimos(RECIBO), `saldo de ${RESERVA}`);
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
      await boton(victor.page, new RegExp(escapar(operadorDe('kolbi')))).first().click();
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
      c.ok(cre && cre.codigo === RESERVA && Number(cre.monto) === centimos(RECARGA), `falta el crédito a ${RESERVA}`);
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

    await f.paso('Todo lo que la pantalla ofrece, el servidor lo cobra: cada empresa y cada operador de su lista se paga', async (c) => {
      const base = (await api.victor.saldo()).crc;
      const rechazados = [];
      for (const p of catalogo.providers) {
        const r = await api.victor.post('/services/pay-bill', { provider_code: p.code, client_id: CLIENTE_ICE, amount: 100, period: 'octubre de 2026', idempotency_key: llave('recibo') });
        if (r.status !== 200) rechazados.push(`${p.code} (${r.codigo ?? r.status})`);
      }
      for (const o of catalogo.operators) {
        const r = await api.victor.post('/services/recharge', { operator: o.code, phone: '88880002', amount: centimos(500), idempotency_key: llave('recarga') });
        if (r.status !== 200) rechazados.push(`${o.code} (${r.codigo ?? r.status})`);
      }
      const ofrecidos = catalogo.providers.length + catalogo.operators.length;
      const cobrado = base - (await api.victor.saldo()).crc;
      c.ok(rechazados.length === 0, `${rechazados.length} de ${ofrecidos} empresas y operadores de la lista del servidor no se pueden pagar: ${rechazados.join(', ')}`);
      c.igual(cobrado, 100 * catalogo.providers.length + centimos(500) * catalogo.operators.length, 'plata cobrada por los pagos de la lista (los rechazos no deben cobrar)');
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('La pantalla ofrece las empresas y los operadores de la lista del servidor, y ninguna que el servidor no tenga', async (c) => {
      await ir(victor.page, txt('Servicios'));
      await victor.page.getByRole('tab', { name: txt('Servicios'), exact: true }).click();
      await reposar(victor.page, 400);
      for (const p of catalogo.providers) await boton(victor.page, new RegExp(`^${escapar(p.name)}`)).first().waitFor({ state: 'visible', timeout: 10000 });
      // Las empresas que la pantalla llevaba escritas a mano y el servidor no conoce no pueden aparecer.
      const viejas = ['CNFL', 'ESPH', 'Coopelesca', 'Tigo', 'Liberty', 'CCSS', 'Marchamo'].filter((n) => !catalogo.providers.some((p) => p.name.toUpperCase().includes(n.toUpperCase())));
      const sobran = [];
      for (const n of viejas) if ((await victor.page.getByText(new RegExp(`\\b${escapar(n)}\\b`, 'i')).count()) > 0) sobran.push(n);
      c.ok(sobran.length === 0, `la pantalla ofrece empresas que el servidor no tiene: ${sobran.join(', ')}`);
      await victor.page.getByRole('tab', { name: txt('Recarga'), exact: true }).click();
      await reposar(victor.page, 400);
      for (const o of catalogo.operators) await boton(victor.page, new RegExp(escapar(o.name))).first().waitFor({ state: 'visible', timeout: 10000 });
      await victor.page.getByRole('tab', { name: txt('Servicios'), exact: true }).click();
      await reposar(victor.page, 400);
    });

    await f.paso('Un recibo de otra empresa de la lista (Cabletica) se paga desde la pantalla', async () => {
      await boton(victor.page, new RegExp(`^${escapar(nombreDe('cabletica'))}`)).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByPlaceholder(txt('Ej: 1234567')).fill(CLIENTE_ICE);
      await hoja.getByPlaceholder('0', { exact: true }).fill('1000');
      await boton(hoja, /^Pagar\s*₡/).click();
      const exito = await victor.page.getByText(txt('¡Pago exitoso!')).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
      if (!exito) {
        const aviso = await victor.page.locator('[role=alert], [role=status]').allInnerTexts().catch(() => []);
        await cerrarHoja(victor.page);
        throw new Error(`pagar a ${nombreDe('cabletica')}, una empresa de la lista del servidor, no se pudo: la pantalla mostró ${JSON.stringify(aviso.filter(Boolean))}`);
      }
    }, { seguir: true });
  },
};
