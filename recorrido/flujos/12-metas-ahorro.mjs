// Metas de ahorro: depositar y retirar mueven plata entre la billetera y la
// cuenta SYSTEM:SAVINGS:CRC del libro; el plan gratuito permite 3 metas.
import { llave } from '../lib/entorno.mjs';
import { abrirSesion, boton, ultimoDialogo, sinDialogos, verTexto, volver, reposar } from '../lib/ui.mjs';
import { clientes, centimos, problemasDelLibro } from '../lib/comun.mjs';
import { reColones, txt } from '../lib/textos.mjs';
import * as bd from '../lib/bd.mjs';

const AHORRO = 'SYSTEM:SAVINGS:CRC';

async function abrirMetas(sesion) {
  const p = sesion.page;
  await boton(p, /Mis metas/).first().click();
  await verTexto(p, txt('Metas de ahorro'));
  await reposar(p);
}

async function crearMeta(sesion, nombre, objetivo, { primera = false } = {}) {
  const p = sesion.page;
  await boton(p, primera ? txt('Crear primera meta') : txt('Nueva meta'), { exacto: true }).first().click();
  const hoja = ultimoDialogo(p);
  await hoja.getByPlaceholder(txt('Ej: Vacaciones, Auto nuevo...')).fill(nombre);
  await hoja.getByLabel(txt('Monto objetivo')).fill(String(objetivo));
  await boton(hoja, txt('Crear meta'), { exacto: true }).click();
  await sinDialogos(p);
  await verTexto(p, nombre);
}

export default {
  id: 'metas-ahorro',
  nombre: 'Metas de ahorro (depositar, retirar, tope del plan)',
  async ejecutar(f, ctx) {
    const api = await clientes('victor');
    const tag = Math.random().toString(36).slice(2, 6);
    const nombre = `Vacaciones ${tag}`;
    const OBJETIVO = 50000;
    const DEPOSITO = 10000;
    const RETIRO = 4000;
    const antes = {};
    let victor;
    let meta;

    const metas = async () => (await api.victor.exigir('GET', '/savings/goals')).data ?? [];
    const buscar = async (n) => (await metas()).find((m) => m.name === n);

    await f.paso('Antes: saldo, cuenta de ahorros del libro y metas de victor', async (c) => {
      antes.saldo = await api.victor.saldo();
      antes.ahorros = bd.saldoCuenta(AHORRO);
      antes.metas = (await metas()).length;
      c.igual(antes.metas, 0, 'victor debería empezar sin metas de ahorro');
    });

    await f.paso(`Victor crea la meta "${nombre}" de ₡${OBJETIVO} desde "Mis metas"`, async (c) => {
      victor = await abrirSesion(f, 'victor');
      await abrirMetas(victor);
      await crearMeta(victor, nombre, OBJETIVO, { primera: true });
      meta = await buscar(nombre);
      c.exigir(meta, `la meta "${nombre}" no aparece en GET /savings/goals`);
      c.igual(meta.target_minor, centimos(OBJETIVO), 'objetivo');
      c.igual(meta.saved_minor, 0, 'ahorrado al crear');
      c.igual((await api.victor.saldo()).crc, antes.saldo.crc, 'crear la meta no debe mover plata');
    });

    await f.paso(`Victor deposita ₡${DEPOSITO} en la meta`, async (c) => {
      await boton(victor.page, txt('Agregar fondos'), { exacto: true }).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByRole('textbox').first().fill(String(DEPOSITO));
      await boton(hoja, txt('Depositar'), { exacto: true }).click();
      await sinDialogos(victor.page);
      await victor.page.getByText(reColones(DEPOSITO)).first().waitFor({ state: 'visible', timeout: 10000 });
      c.igual((await api.victor.saldo()).crc, antes.saldo.crc - centimos(DEPOSITO), 'saldo de victor');
      c.igual((await buscar(nombre)).saved_minor, centimos(DEPOSITO), 'ahorrado en la meta');
      c.igual(bd.saldoCuenta(AHORRO), antes.ahorros + centimos(DEPOSITO), 'saldo de SYSTEM:SAVINGS:CRC');
      const mov = (await api.victor.movimientos({ type: 'savings_deposit', limit: '5' }))[0];
      c.exigir(mov, 'victor no tiene movimiento savings_deposit');
      c.igual(mov.amount, centimos(DEPOSITO), 'monto del movimiento');
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso(`Victor retira ₡${RETIRO} de la meta`, async (c) => {
      await boton(victor.page, txt('Retirar fondos'), { exacto: true }).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByRole('textbox').first().fill(String(RETIRO));
      await boton(hoja, txt('Retirar'), { exacto: true }).click();
      await sinDialogos(victor.page);
      await victor.page.getByText(reColones(DEPOSITO - RETIRO)).first().waitFor({ state: 'visible', timeout: 10000 });
      c.igual((await api.victor.saldo()).crc, antes.saldo.crc - centimos(DEPOSITO - RETIRO), 'saldo de victor');
      c.igual((await buscar(nombre)).saved_minor, centimos(DEPOSITO - RETIRO), 'ahorrado en la meta');
      c.igual(bd.saldoCuenta(AHORRO), antes.ahorros + centimos(DEPOSITO - RETIRO), 'saldo de SYSTEM:SAVINGS:CRC');
      const mov = (await api.victor.movimientos({ type: 'savings_withdraw', limit: '5' }))[0];
      c.exigir(mov, 'victor no tiene movimiento savings_withdraw');
      c.igual(mov.amount, centimos(RETIRO), 'monto del movimiento');
    });

    await f.paso('Al volver al inicio, los movimientos del ahorro ya están en la lista', async (c) => {
      // El inicio solo refresca su lista de movimientos con una notificacion en vivo: la pantalla de metas
      // tiene que traerlos ella (ademas del saldo) para que no queden como estaban hasta recargar la pagina.
      await volver(victor.page);
      const filas = victor.page.locator('[data-movimiento]');
      await filas.first().waitFor({ state: 'visible', timeout: 10000 });
      const textos = await filas.allInnerTexts();
      c.ok(textos.some((t) => t.includes(txt('Retiro de ahorro'))), `el inicio no muestra el "Retiro de ahorro" entre sus movimientos: ${JSON.stringify(textos)}`);
    }, { seguir: true });

    await f.paso('Repetir un depósito con la misma llave no mueve plata; el servidor rechaza lo imposible', async (c) => {
      const base = (await api.victor.saldo()).crc;
      const k = llave('ahorro');
      const cuerpo = { amount_minor: centimos(500) };
      const r1 = await api.victor.post(`/savings/goals/${meta.id}/deposit`, cuerpo, { 'Idempotency-Key': k });
      c.respuesta(r1, 200, 'depósito de ₡500');
      const r2 = await api.victor.post(`/savings/goals/${meta.id}/deposit`, cuerpo, { 'Idempotency-Key': k });
      c.respuesta(r2, 200, 'repetición con la misma llave');
      c.ok(r2.data?.replayed === true, `la repetición debería traer replayed:true: ${JSON.stringify(r2.data)}`);
      c.igual((await api.victor.saldo()).crc, base - centimos(500), 'se descuenta UNA sola vez');
      const lineas = bd.asiento({ llave: `savings:${k}` });
      c.ok(bd.lineaDe(lineas, AHORRO, 'credit'), 'falta el crédito a SYSTEM:SAVINGS:CRC en el asiento del depósito');
      const ahorrado = (await buscar(nombre)).saved_minor;
      c.respuesta(await api.victor.post(`/savings/goals/${meta.id}/withdraw`, { amount_minor: ahorrado + 1 }, { 'Idempotency-Key': llave('ahorro') }), 422, 'retirar más de lo ahorrado', 'SAVINGS_EXCEEDS_SAVED');
      c.respuesta(await api.victor.post(`/savings/goals/${meta.id}/deposit`, { amount_minor: 0 }, { 'Idempotency-Key': llave('ahorro') }), 400, 'depositar cero', 'SAVINGS_INVALID_AMOUNT');
      c.respuesta(await api.victor.post(`/savings/goals/${meta.id}/deposit`, { amount_minor: base + 100000 }, { 'Idempotency-Key': llave('ahorro') }), 422, 'depositar más que el saldo', 'INSUFFICIENT_BALANCE');
      const otro = await clientes('keilor');
      c.respuesta(await otro.keilor.post(`/savings/goals/${meta.id}/deposit`, { amount_minor: 100 }, { 'Idempotency-Key': llave('ahorro') }), 404, 'depositar en la meta de otra persona', 'SAVINGS_GOAL_NOT_FOUND');
      c.igual((await api.victor.saldo()).crc, base - centimos(500), 'los rechazos no deben mover plata');
    });

    await f.paso('Victor elimina la meta y lo ahorrado vuelve a su billetera', async (c) => {
      const ahorrado = (await buscar(nombre)).saved_minor;
      const saldoAntes = (await api.victor.saldo()).crc;
      const dentro = await victor.page.getByRole('heading', { name: txt('Metas de ahorro') }).first().isVisible().catch(() => false);
      if (!dentro) await abrirMetas(victor);
      await boton(victor.page, txt('Eliminar'), { exacto: true }).first().click();
      await boton(ultimoDialogo(victor.page), txt('Eliminar'), { exacto: true }).last().click();
      await sinDialogos(victor.page);
      c.igual((await api.victor.saldo()).crc, saldoAntes + ahorrado, 'saldo de victor tras eliminar la meta');
      c.ok(!(await buscar(nombre)), 'la meta sigue en GET /savings/goals');
      c.igual(bd.saldoCuenta(AHORRO), antes.ahorros, 'SYSTEM:SAVINGS:CRC debe volver a como estaba');
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('Victor crea tres metas y la cuarta se rechaza (plan gratuito)', async (c) => {
      await verTexto(victor.page, txt('Metas de ahorro'));
      for (const letra of ['A', 'B', 'C']) await crearMeta(victor, `Meta ${letra} ${tag}`, 20000, { primera: letra === 'A' });
      c.igual((await metas()).length, 3, 'metas de victor');
      const cuarta = await api.victor.post('/savings/goals', { name: `Meta D ${tag}`, target_minor: 2000000, currency: 'CRC', icon: 'piggy-bank', color: '#3b82f6' });
      c.respuesta(cuarta, 409, 'cuarta meta por API', 'SAVINGS_GOAL_LIMIT');
      const detalles = cuarta.cuerpo?.error?.details;
      c.ok(detalles?.limite === 3 && detalles?.actuales === 3, `detalles del tope: ${JSON.stringify(detalles)}`);
      await boton(victor.page, txt('Nueva meta'), { exacto: true }).first().click();
      await verTexto(victor.page, txt('Llegaste al tope de tu plan'));
    });

    await f.paso('Limpieza: se eliminan las metas de la prueba y el libro queda cuadrado', async (c) => {
      for (const m of await metas()) c.respuesta(await api.victor.delete(`/savings/goals/${m.id}`), 200, `eliminar la meta ${m.name}`);
      c.igual((await metas()).length, 0, 'metas que quedan');
      c.igual(bd.saldoCuenta(AHORRO), antes.ahorros, 'SYSTEM:SAVINGS:CRC al final');
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });
  },
};
