// Puntos y recompensas, y el fondo de promociones que paga el cashback. Con el
// fondo en cero el canje tiene que avisarlo bien y NO tocar los puntos; una vez
// que keilor (administrador) lo fondea, el canje acredita plata de verdad.
import { llave } from '../lib/entorno.mjs';
import { abrirSesion, ir, boton, ultimoDialogo, sinDialogos, verTexto, volver, reposar } from '../lib/ui.mjs';
import { clientes, centimos, problemasDelLibro } from '../lib/comun.mjs';
import { peticion, esperarHasta } from '../lib/api.mjs';
import { reColones, txt } from '../lib/textos.mjs';
import * as bd from '../lib/bd.mjs';

const PROMOCIONES = 'SYSTEM:PROMOTIONS:CRC';
const RESERVA = 'SYSTEM:RESERVE:CRC';
const CAPITAL = 'SYSTEM:CAPITAL:CRC';
const FONDEO = 500;

async function abrirRecompensas(sesion) {
  const p = sesion.page;
  await boton(p, /Recompensas/).first().click();
  await verTexto(p, txt('Puntos y recompensas'));
  await reposar(p);
}

async function reservasCrc() {
  const r = await peticion('GET', '/transparency/proof-of-reserves');
  return r.data.currencies.find((m) => m.currency === 'CRC');
}

export default {
  id: 'recompensas',
  nombre: 'Recompensas: canje de puntos y fondo de promociones',
  async ejecutar(f, ctx) {
    const api = await clientes('keilor', 'victor');
    const antes = {};
    let keilor;
    let premio;

    await f.paso('Keilor tiene 3.100 puntos y el fondo de promociones está en cero', async (c) => {
      const cuenta = (await api.keilor.exigir('GET', '/loyalty/account')).data;
      antes.puntos = cuenta.available_points;
      antes.total = cuenta.total_points;
      c.igual(cuenta.available_points, 3100, 'puntos disponibles de keilor');
      c.igual(cuenta.total_points, 4250, 'puntos totales de keilor');
      const premios = (await api.keilor.exigir('GET', '/loyalty/rewards')).data ?? [];
      const lista = Array.isArray(premios) ? premios : premios.rewards ?? [];
      c.ok(lista.length >= 4, `el catálogo debería traer al menos 4 premios: ${lista.length}`);
      premio = lista.find((x) => x.points === 500 || x.cost_points === 500) ?? lista[0];
      c.exigir(premio, 'no hay premios en GET /loyalty/rewards');
      c.ok(lista.every((x) => x.redeemable_now === false), `con el fondo en cero ningún premio debería poder canjearse: ${JSON.stringify(lista.map((x) => x.redeemable_now))}`);
      const fondo = await api.keilor.exigir('GET', '/admin/promociones');
      antes.fondo = fondo.data.saldo_minor;
      c.igual(antes.fondo, 0, 'saldo del fondo de promociones');
      antes.saldo = await api.keilor.saldo();
      antes.promociones = bd.saldoCuenta(PROMOCIONES);
      antes.reserva = bd.saldoCuenta(RESERVA);
      antes.asientos = bd.totalAsientos();
      antes.reservas = await reservasCrc();
    });

    await f.paso('Keilor abre "Recompensas": todos los "Canjear" quedan deshabilitados con su aviso', async (c) => {
      keilor = await abrirSesion(f, 'keilor');
      await abrirRecompensas(keilor);
      const botones = boton(keilor.page, txt('Canjear'), { exacto: true });
      const n = await botones.count();
      c.ok(n >= 4, `se esperaban 4 botones "Canjear" y hay ${n}`);
      for (let i = 0; i < n; i++) c.ok(await botones.nth(i).isDisabled(), `el botón "Canjear" número ${i + 1} debería estar deshabilitado con el fondo en cero`);
      await verTexto(keilor.page, txt('No disponible por ahora. Tus puntos no se tocan.'));
    });

    await f.paso('La pantalla muestra el nivel de keilor en español', async (c) => {
      // El nivel del servidor ("silver") es un identificador, no un texto: la pantalla lo traduce ("Plata") y la
      // barra de progreso nombra el siguiente nivel igual ("Oro").
      const crudo = await keilor.page.getByText(/\b(bronze|silver|gold|platinum)\b/i).count();
      c.igual(crudo, 0, 'veces que la pantalla pinta un nivel en inglés (silver, gold...)');
      const traducido = await keilor.page.getByText(new RegExp(`Nivel\\s+${txt('Plata')}`, 'i')).count();
      c.ok(traducido >= 1, `la pantalla no muestra "Nivel ${txt('Plata')}" para keilor (4.250 puntos totales)`);
      const siguiente = await keilor.page.getByText(new RegExp(`${txt('Oro')}:\\s*25,000\\s*pts`, 'i')).count();
      c.ok(siguiente >= 1, `la barra de progreso no nombra el siguiente nivel como "${txt('Oro')}: 25,000 pts"`);
    }, { seguir: true });

    await f.paso('Canjear con el fondo en cero por la API se rechaza (409) y no toca puntos, plata ni libro', async (c) => {
      const r = await api.keilor.post('/loyalty/redeem', { reward_id: premio.id });
      c.respuesta(r, 409, 'canje con el fondo en cero', 'LOYALTY_SIN_FONDOS');
      c.igual((await api.keilor.exigir('GET', '/loyalty/account')).data.available_points, antes.puntos, 'puntos de keilor');
      c.igual((await api.keilor.saldo()).crc, antes.saldo.crc, 'saldo de keilor');
      c.igual(bd.totalAsientos(), antes.asientos, 'asientos del libro');
      const ajeno = await api.victor.post('/loyalty/redeem', { reward_id: premio.id });
      c.ok(!ajeno.ok, `victor no tiene puntos y el canje no debería salir bien: ${ajeno.resumen()}`);
    });

    await f.paso('Si la pantalla creyera que se puede canjear, el aviso del rechazo es claro', async (c) => {
      // Se simula la carrera: la lista de premios llega con "redeemable_now: true" y el servidor,
      // que tiene el fondo en cero, rechaza el canje de verdad.
      const p = keilor.page;
      await p.route(/\/api\/v1\/loyalty\/rewards(\?.*)?$/, async (route) => {
        const respuesta = await route.fetch();
        const cuerpo = await respuesta.json();
        const lista = Array.isArray(cuerpo.data) ? cuerpo.data : cuerpo.data?.rewards ?? [];
        for (const x of lista) x.redeemable_now = true;
        await route.fulfill({ response: respuesta, json: cuerpo });
      });
      try {
        await volver(p);
        await abrirRecompensas(keilor);
        const canjear = boton(p, txt('Canjear'), { exacto: true }).first();
        await canjear.waitFor({ state: 'visible' });
        c.ok(await canjear.isEnabled(), 'el botón "Canjear" debería estar habilitado con la lista simulada');
        await canjear.click();
        await verTexto(p, txt('Los premios de cashback no están disponibles en este momento. No se descontaron tus puntos.'));
      } finally {
        await p.unroute(/\/api\/v1\/loyalty\/rewards(\?.*)?$/);
      }
      c.igual((await api.keilor.exigir('GET', '/loyalty/account')).data.available_points, antes.puntos, 'puntos de keilor tras el aviso');
    });

    await f.paso(`Keilor (administrador) registra ₡${FONDEO} en el "Fondo de promociones"`, async (c) => {
      const p = keilor.page;
      await volver(p);
      await ir(p, txt('Perfil'));
      await boton(p, new RegExp(txt('Fondo de promociones'))).first().click({ timeout: 20000 });
      await verTexto(p, txt('Saldo disponible'));
      await p.getByPlaceholder('0.00').fill(String(FONDEO));
      await p.getByPlaceholder(txt('Transferencia o comprobante')).fill('TEST-0001');
      await boton(p, txt('Registrar depósito'), { exacto: true }).click();
      const hoja = ultimoDialogo(p);
      await verTexto(p, /TEST-0001/);
      await boton(hoja, txt('Confirmar'), { exacto: true }).click();
      await sinDialogos(p);
      await p.getByText(new RegExp(`Se registraron\\s+${reColones(FONDEO).source}`)).first().waitFor({ state: 'visible', timeout: 10000 });
      c.igual((await api.keilor.exigir('GET', '/admin/promociones')).data.saldo_minor, centimos(FONDEO), 'saldo del fondo de promociones');
    });

    await f.paso('El fondeo mueve solo el fondo y el capital propio: ni la reserva ni ninguna billetera cambian', async (c) => {
      // El fondo es plata de la empresa hasta que se regala: no respalda a nadie y no sube la reserva publicada.
      c.igual((await api.keilor.saldo()).crc, antes.saldo.crc, 'saldo de keilor');
      c.igual(bd.saldoCuenta(PROMOCIONES), antes.promociones + centimos(FONDEO), `saldo de ${PROMOCIONES}`);
      c.igual(bd.saldoCuenta(RESERVA), antes.reserva, `saldo de ${RESERVA} (el fondeo no la toca)`);
      const lineas = bd.asiento({ llavePrefijo: 'loyalty:fondeo:' });
      c.ok(bd.lineaDe(lineas, CAPITAL, 'debit'), `falta el débito a ${CAPITAL}`);
      c.ok(bd.lineaDe(lineas, PROMOCIONES, 'credit'), `falta el crédito a ${PROMOCIONES}`);
      c.igual(lineas.length, 2, 'líneas del asiento del fondeo');
      const reservas = await reservasCrc();
      c.igual(reservas.reserve_balance_minor, antes.reservas.reserve_balance_minor, 'reserva publicada en la prueba de reservas');
      c.igual(reservas.user_liabilities_minor, antes.reservas.user_liabilities_minor, 'pasivo publicado en la prueba de reservas');
      c.igual(reservas.difference_minor, 0, 'difference_minor publicado en la prueba de reservas');
      // La auditoria se escribe aparte del asiento: se espera un instante a que aparezca.
      const auditado = await esperarHasta(() => bd.consultar("SELECT 1 AS n FROM audit_logs WHERE action = 'promociones_fondeadas' LIMIT 1").length > 0, { intentos: 10, cadaMs: 500, descripcion: 'la auditoría del fondeo' }).then(() => true, () => false);
      c.ok(auditado, 'falta la auditoría "promociones_fondeadas" del fondeo');
      const k = llave('fondeo');
      const cuerpo = { amount_minor: 100, referencia: 'TEST-0002', idempotency_key: k };
      c.respuesta(await api.keilor.post('/admin/promociones/fondos', cuerpo), 200, 'fondeo de ₡1');
      const repetido = await api.keilor.post('/admin/promociones/fondos', cuerpo);
      c.respuesta(repetido, 200, 'repetir el fondeo con la misma llave');
      c.igual(repetido.data?.saldo_minor, centimos(FONDEO) + 100, 'la repetición no debe abonar otra vez');
      c.respuesta(await api.keilor.post('/admin/promociones/fondos', { amount_minor: 100, referencia: 'ab', idempotency_key: llave('fondeo') }), 400, 'referencia de menos de 3 caracteres', 'VALIDATION_ERROR');
      c.respuesta(await api.victor.post('/admin/promociones/fondos', { ...cuerpo, idempotency_key: llave('fondeo') }), 403, 'victor no es administrador');
    });

    await f.paso('Keilor canjea el premio de ₡500 y la plata llega a su billetera', async (c) => {
      const p = keilor.page;
      await volver(p);
      await ir(p, txt('Inicio'));
      await abrirRecompensas(keilor);
      const primero = boton(p, txt('Canjear'), { exacto: true }).first();
      await primero.waitFor({ state: 'visible' });
      c.ok(await primero.isEnabled(), 'con el fondo cargado el primer premio debería poder canjearse');
      const saldoAntes = (await api.keilor.saldo()).crc;
      const fondoAntes = bd.saldoCuenta(PROMOCIONES);
      const reservaAntes = bd.saldoCuenta(RESERVA);
      await primero.click();
      await p.getByText(new RegExp(`${reColones(FONDEO).source}\\s+acreditados`)).first().waitFor({ state: 'visible', timeout: 10000 });
      c.igual((await api.keilor.exigir('GET', '/loyalty/account')).data.available_points, antes.puntos - 500, 'puntos disponibles tras el canje');
      c.igual((await api.keilor.exigir('GET', '/loyalty/account')).data.total_points, antes.total, 'puntos totales tras el canje');
      c.igual((await api.keilor.saldo()).crc, saldoAntes + centimos(FONDEO), 'saldo de keilor tras el canje');
      c.igual(bd.saldoCuenta(PROMOCIONES), fondoAntes - centimos(FONDEO), `saldo de ${PROMOCIONES} tras el canje`);
      // El premio sube lo que se le debe a keilor: el capital propio pone esa plata en la reserva en el mismo asiento.
      c.igual(bd.saldoCuenta(RESERVA), reservaAntes + centimos(FONDEO), `saldo de ${RESERVA} tras el canje`);
      const lineasCanje = bd.asiento({ llavePrefijo: 'loyalty:canje:' });
      c.ok(bd.lineaDe(lineasCanje, RESERVA, 'debit'), `falta el débito a ${RESERVA} en el asiento del canje: ${JSON.stringify(lineasCanje)}`);
      c.ok(bd.lineaDe(lineasCanje, CAPITAL, 'credit'), `falta el crédito a ${CAPITAL} en el asiento del canje: ${JSON.stringify(lineasCanje)}`);
      c.igual((await reservasCrc()).difference_minor, 0, 'difference_minor publicado tras el canje');
      const mov = (await api.keilor.movimientos({ type: 'loyalty_cashback', limit: '5' }))[0];
      c.exigir(mov, 'keilor no tiene movimiento loyalty_cashback');
      c.igual(mov.amount, centimos(FONDEO), 'monto del movimiento');
      const canjes = (await api.keilor.exigir('GET', '/loyalty/redemptions')).data ?? [];
      c.ok(canjes.length >= 1, 'GET /loyalty/redemptions debería traer el canje');
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('Con el fondo gastado, los premios vuelven a "No disponible" y el historial muestra el canje', async (c) => {
      const p = keilor.page;
      await p.getByText(txt('No disponible por ahora. Tus puntos no se tocan.')).first().waitFor({ state: 'visible', timeout: 10000 });
      await boton(p, txt('Historial'), { exacto: true }).click();
      await reposar(p, 500);
      await verTexto(p, /Canje:\s*Cashback/);
      const r = await api.keilor.exigir('GET', '/loyalty/rewards');
      const lista = Array.isArray(r.data) ? r.data : r.data?.rewards ?? [];
      c.ok(lista.every((x) => x.redeemable_now === false), 'con el fondo vacío ningún premio debería poder canjearse');
    });
  },
};
