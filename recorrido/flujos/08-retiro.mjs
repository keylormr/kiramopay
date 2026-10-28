// Retiro por el riel simulado ("Pagos salientes"). El riel de prueba decide el
// resultado por el prefijo de la cuenta de destino: cualquier cuenta normal se
// completa; "fail..." es rechazada por el riel y el servidor devuelve el dinero.
import { abrirSesion, ir, boton, ultimoDialogo, sinDialogos, verTexto, reposar, volver } from '../lib/ui.mjs';
import { clientes, centimos, problemasDelLibro } from '../lib/comun.mjs';
import { reColones, txt, escapar } from '../lib/textos.mjs';
import { llave, CUENTAS } from '../lib/entorno.mjs';
import * as bd from '../lib/bd.mjs';

// La plata que sale por un riel sale del sistema: el pasivo con el usuario y la reserva bajan lo mismo (y
// suben lo mismo si el riel rechaza y se reembolsa).
const RESERVA = 'SYSTEM:RESERVE:CRC';

async function abrirPagosSalientes(sesion) {
  const p = sesion.page;
  await ir(p, txt('Perfil'));
  await boton(p, new RegExp(escapar(txt('Pagos salientes')))).first().click();
  await verTexto(p, txt('Envía fondos a cuentas externas mediante un riel de pago.'));
  await reposar(p);
}

async function nuevoPago(sesion, { nombre, cuenta, monto }) {
  const p = sesion.page;
  const nuevo = boton(p, txt('Nuevo pago'), { exacto: true }).first();
  await nuevo.waitFor({ state: 'visible' });
  // El boton queda deshabilitado hasta que llegan los rieles.
  await p.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.getAttribute('aria-label') === 'Nuevo pago' || x.innerText.trim() === 'Nuevo pago');
    return !!b && !b.disabled;
  });
  await nuevo.click();
  const hoja = ultimoDialogo(p);
  await hoja.getByPlaceholder(txt('Nombre del beneficiario')).fill(nombre);
  await hoja.getByPlaceholder('CR00000000000000000000').fill(cuenta);
  await hoja.getByPlaceholder('0.00').fill(String(monto));
  await boton(hoja, txt('Enviar pago'), { exacto: true }).click();
  await sinDialogos(p, 15000);
}

export default {
  id: 'retiro',
  nombre: 'Retiro por el riel simulado (pagos salientes)',
  async ejecutar(f, ctx) {
    const api = await clientes('victor');
    const tag = Math.random().toString(36).slice(2, 6);
    const cuentaBuena = 'CR05015202001026284066';
    let victor;
    const antes = {};
    const ids = {};

    await f.paso('El servidor ofrece el riel "mock" y victor no tiene pagos salientes', async (c) => {
      const rieles = await api.victor.exigir('GET', '/payouts/rails');
      c.ok((rieles.data.rails ?? []).includes('mock'), `rieles disponibles: ${JSON.stringify(rieles.data)}`);
      antes.saldo = await api.victor.saldo();
      antes.reserva = bd.saldoCuenta(RESERVA);
    });

    await f.paso('Victor envía ₡2.500 a una cuenta normal desde "Pagos salientes"', async () => {
      victor = await abrirSesion(f, 'victor');
      await abrirPagosSalientes(victor);
      await nuevoPago(victor, { nombre: `Beneficiario ${tag}`, cuenta: cuentaBuena, monto: 2500 });
      await verTexto(victor.page, `Beneficiario ${tag}`);
    });

    await f.paso('El pago se completa: baja el saldo, queda el movimiento y el asiento a la cuenta externa', async (c) => {
      const lista = (await api.victor.exigir('GET', '/payouts?limit=20')).data ?? [];
      const pago = lista.find((x) => x.destination?.name === `Beneficiario ${tag}`);
      c.exigir(pago, 'el pago no aparece en GET /payouts');
      ids.bueno = pago.id;
      c.igual(pago.status, 'completed', 'estado del pago');
      c.igual(pago.amount_minor, centimos(2500), 'monto del pago');
      c.ok(String(pago.external_id).startsWith('mock_'), `identificador externo: ${pago.external_id}`);
      c.igual((await api.victor.saldo()).crc, antes.saldo.crc - centimos(2500), 'saldo de victor');
      const mov = (await api.victor.movimientos({ type: 'payout_sent', limit: '5' }))[0];
      c.exigir(mov, 'victor no tiene movimiento payout_sent');
      c.igual(mov.amount, centimos(2500), 'monto del movimiento');
      c.igual(mov.counterparty_name, `Beneficiario ${tag}`, 'beneficiario del movimiento');
      const lineas = bd.asiento({ llave: `payout:debit:${pago.id}` });
      c.ok(bd.lineaDe(lineas, bd.cuentaUsuario(CUENTAS.victor.id, 'CRC'), 'debit'), 'falta el débito a victor');
      c.ok(bd.lineaDe(lineas, RESERVA, 'credit'), `falta el crédito a ${RESERVA} (la plata sale del sistema)`);
      c.igual(lineas.length, 2, 'líneas del asiento del pago');
      c.igual(bd.saldoCuenta(RESERVA), antes.reserva - centimos(2500), `saldo de ${RESERVA}`);
    });

    await f.paso('La pantalla muestra el pago como "Completado" y su detalle', async () => {
      await verTexto(victor.page, txt('Completado'));
      await victor.page.getByText(`Beneficiario ${tag}`).first().click();
      await verTexto(victor.page, cuentaBuena);
      await victor.page.keyboard.press('Escape');
      await sinDialogos(victor.page).catch(() => {});
    });

    await f.paso('Victor envía ₡1.000 a un destino que el riel rechaza ("fail0001")', async () => {
      antes.fallo = await api.victor.saldo();
      await nuevoPago(victor, { nombre: `Rechazado ${tag}`, cuenta: 'fail0001', monto: 1000 });
      await verTexto(victor.page, `Rechazado ${tag}`);
    });

    await f.paso('El pago rechazado queda "failed", se reembolsa y el saldo vuelve a lo de antes', async (c) => {
      const lista = (await api.victor.exigir('GET', '/payouts?limit=20')).data ?? [];
      const pago = lista.find((x) => x.destination?.name === `Rechazado ${tag}`);
      c.exigir(pago, 'el pago rechazado no aparece en GET /payouts');
      ids.malo = pago.id;
      c.igual(pago.status, 'failed', 'estado del pago');
      c.igual(pago.failure_reason, 'mock: destination rejected', 'motivo del rechazo');
      c.igual((await api.victor.saldo()).crc, antes.fallo.crc, 'saldo de victor tras el reembolso');
      const reembolso = (await api.victor.movimientos({ type: 'payout_refund', limit: '5' }))[0];
      c.ok(reembolso && reembolso.amount === centimos(1000), 'falta el movimiento payout_refund de victor');
      const lineas = bd.asiento({ llave: `payout:refund:${pago.id}` });
      c.ok(bd.lineaDe(lineas, RESERVA, 'debit'), `falta el débito a ${RESERVA} en el reembolso`);
      c.ok(bd.lineaDe(lineas, bd.cuentaUsuario(CUENTAS.victor.id, 'CRC'), 'credit'), 'falta el crédito a victor en el reembolso');
      c.igual(bd.saldoCuenta(RESERVA), antes.reserva - centimos(2500), 'la reserva baja solo por el pago completado: el reembolso devuelve lo suyo');
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('La pantalla muestra el pago rechazado como "Fallido" con su motivo', async () => {
      await verTexto(victor.page, txt('Fallido'));
      await victor.page.getByText(`Rechazado ${tag}`).first().click();
      await verTexto(victor.page, 'mock: destination rejected');
      await victor.page.keyboard.press('Escape');
      await sinDialogos(victor.page).catch(() => {});
    });

    await f.paso('Rechazos del servidor: llave repetida, riel desconocido, monto cero y segundo factor', async (c) => {
      const k = llave('payout');
      const cuerpo = { rail: 'mock', amount_minor: 100, currency: 'CRC', destination: { type: 'bank_account', account: cuentaBuena, name: `Repetido ${tag}` }, idempotency_key: k };
      const antesSaldo = (await api.victor.saldo()).crc;
      const r1 = await api.victor.post('/payouts', cuerpo);
      c.respuesta(r1, 201, 'primer pago de ₡1');
      const r2 = await api.victor.post('/payouts', cuerpo);
      c.respuesta(r2, 201, 'repetición con la misma llave');
      c.igual(r2.data?.id, r1.data?.id, 'la repetición devuelve el mismo pago');
      c.igual((await api.victor.saldo()).crc, antesSaldo - 100, 'se cobra UNA sola vez');
      c.respuesta(await api.victor.post('/payouts', { ...cuerpo, rail: 'no-existe', idempotency_key: llave('payout') }), 400, 'riel desconocido', 'PAYOUT_UNKNOWN_RAIL');
      c.respuesta(await api.victor.post('/payouts', { ...cuerpo, amount_minor: 0, idempotency_key: llave('payout') }), 400, 'monto cero', 'INVALID_REQUEST');
      const mfa = await api.victor.post('/payouts', { ...cuerpo, amount_minor: 10000000, idempotency_key: llave('payout') });
      c.respuesta(mfa, 428, 'pago de ₡100.000 sin segundo factor', 'MFA_REQUIRED');
      c.igual((await api.victor.saldo()).crc, antesSaldo - 100, 'el rechazo por segundo factor no debe mover plata');
    });

    await f.paso('Al volver al inicio, los pagos salientes ya están en los movimientos (sin recargar)', async (c) => {
      // "Pagos salientes" se abre desde Perfil: al volver se cae en Perfil y de ahi se pasa al Inicio,
      // que tiene que traer los pagos que se acaban de hacer sin recargar la pagina.
      await volver(victor.page);
      await ir(victor.page, txt('Inicio'));
      const filas = victor.page.locator('[data-movimiento]');
      await filas.first().waitFor({ state: 'visible', timeout: 15000 });
      await filas.first().scrollIntoViewIfNeeded();
      const textos = await filas.allInnerTexts();
      c.ok(textos.some((t) => t.includes(`Repetido ${tag}`)), `el inicio no muestra el último pago saliente ("Repetido ${tag}") entre sus movimientos: ${JSON.stringify(textos)}`);
    }, { seguir: true });

    await f.paso('El reembolso aparece como entrada (+) en los movimientos del inicio', async (c) => {
      // El reembolso (payout_refund) vuelve plata a victor: es una entrada y se pinta con "+".
      const nueva = await abrirSesion(f, 'victor');
      const filas = nueva.page.locator('[data-movimiento]');
      await filas.first().waitFor({ state: 'visible', timeout: 15000 });
      await filas.first().scrollIntoViewIfNeeded();
      const textos = await filas.allInnerTexts();
      const deMil = textos.filter((t) => reColones(1000).test(t));
      c.ok(deMil.length > 0, `no hay filas de ₡1.000 entre los movimientos del inicio: ${JSON.stringify(textos)}`);
      c.ok(deMil.some((t) => t.includes('+')), `el reembolso de ₡1.000 no se muestra como entrada (+) en el inicio: ${JSON.stringify(deMil)}`);
    }, { seguir: true });
  },
};
