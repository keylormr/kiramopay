// Pago con garantia (escrow). Comprador: victor. Vendedor: emmanuel. Arbitro:
// keilor (administrador, que no es parte). Cuatro acuerdos:
//   A1  ₡2.000  crear, fondear, entregar y liberar (camino feliz, todo por pantalla)
//   A2  ₡1.500  disputa abierta por el comprador; el administrador falla a favor del vendedor
//   A3  ₡1.200  disputa; el administrador falla a favor del comprador
//   A4  ₡500    creado y cancelado sin fondear
import { CUENTAS } from '../lib/entorno.mjs';
import { abrirSesion, ir, boton, ultimoDialogo, sinDialogos, verTexto, reposar, volver } from '../lib/ui.mjs';
import { clientes, centimos, problemasDelLibro } from '../lib/comun.mjs';
import { txt, escapar } from '../lib/textos.mjs';
import * as bd from '../lib/bd.mjs';

const ESCROW_CRC = 'SYSTEM:ESCROW:CRC';

export async function abrirPagosProtegidos(sesion) {
  const p = sesion.page;
  await ir(p, txt('Perfil'));
  await boton(p, new RegExp(escapar(txt('Pagos protegidos')))).first().click();
  await verTexto(p, txt('El dinero se retiene de forma segura hasta que ambas partes cumplan'));
  await reposar(p);
}

async function crearPorLaPantalla(sesion, { telefono, monto, descripcion }) {
  const p = sesion.page;
  await boton(p, txt('Nuevo acuerdo'), { exacto: true }).first().click();
  const hoja = ultimoDialogo(p);
  await hoja.getByPlaceholder('8888-1234').fill(telefono);
  await hoja.getByPlaceholder('0.00').fill(String(monto));
  await hoja.getByPlaceholder(txt('¿Qué se está comprando?')).fill(descripcion);
  await boton(hoja, txt('Crear acuerdo'), { exacto: true }).click();
  await sinDialogos(p, 15000);
  await p.getByText(descripcion).first().waitFor({ state: 'visible', timeout: 15000 });
}

/** Abre el detalle de un acuerdo y pulsa una accion; la hoja queda abierta con el estado nuevo. */
async function accionEnDetalle(sesion, descripcion, accion) {
  const p = sesion.page;
  const abierto = await p.getByRole('dialog').count();
  if (!abierto) {
    await p.getByText(descripcion).first().click();
  }
  const hoja = ultimoDialogo(p);
  await boton(hoja, accion, { exacto: true }).click();
  await reposar(p, 600);
}

async function cerrarDetalle(sesion) {
  const p = sesion.page;
  if (await p.getByRole('dialog').count()) {
    await p.keyboard.press('Escape');
    await sinDialogos(p).catch(() => {});
  }
}

/** El administrador falla una disputa desde su panel. */
async function resolverComoAdmin(sesion, descripcion, aFavor) {
  const p = sesion.page;
  if (await p.getByText(txt('Disputas'), { exact: true }).count()) await volver(p);
  await ir(p, txt('Perfil'));
  await verTexto(p, txt('Administración'));
  await boton(p, new RegExp(escapar(txt('Disputas de escrow')))).first().click();
  const caso = p
    .getByText(descripcion)
    .first()
    .locator(`xpath=ancestor::*[.//button[normalize-space()="${aFavor}"]][1]`);
  await caso.waitFor({ state: 'visible', timeout: 15000 });
  await boton(caso, aFavor, { exacto: true }).click();
  const hoja = ultimoDialogo(p);
  await boton(hoja, txt('Confirmar'), { exacto: true }).click();
  await sinDialogos(p, 15000);
  await p.getByText(descripcion).first().waitFor({ state: 'detached', timeout: 15000 });
}

export default {
  id: 'escrow',
  nombre: 'Pago con garantía (escrow): entrega, disputa y cancelación',
  async ejecutar(f, ctx) {
    const api = await clientes('victor', 'emmanuel', 'keilor');
    const tag = Math.random().toString(36).slice(2, 6);
    const desc = {
      a1: `Pedido A1 ${tag}`,
      a2: `Pedido A2 ${tag}`,
      a3: `Pedido A3 ${tag}`,
      a4: `Pedido A4 ${tag}`,
    };
    const id = {};
    let victor;
    let emmanuel;
    let keilor;
    const antes = {};

    const agreement = async (clave, quien = 'victor') => (await api[quien].exigir('GET', `/escrow/${id[clave]}`)).data;
    const buscarPorDescripcion = async (clave) => {
      const lista = (await api.victor.exigir('GET', '/escrow?limit=100')).data ?? [];
      return lista.find((a) => a.description === desc[clave]);
    };

    await f.paso('Saldos y cuenta de garantía antes de empezar', async () => {
      antes.victor = await api.victor.saldo();
      antes.emmanuel = await api.emmanuel.saldo();
      antes.garantia = bd.saldoCuenta(ESCROW_CRC);
    });

    // ── A1: camino feliz ─────────────────────────────────────────────────
    await f.paso('A1: victor crea el acuerdo de ₡2.000 con emmanuel desde "Pagos protegidos"', async (c) => {
      victor = await abrirSesion(f, 'victor');
      await abrirPagosProtegidos(victor);
      await crearPorLaPantalla(victor, { telefono: CUENTAS.emmanuel.telefono, monto: 2000, descripcion: desc.a1 });
      const a = await buscarPorDescripcion('a1');
      c.exigir(a, 'el acuerdo A1 no aparece en GET /escrow');
      id.a1 = a.id;
      c.igual(a.status, 'pending', 'estado tras crear');
      c.igual(a.amount_minor, centimos(2000), 'monto');
      c.igual(a.buyer_id, CUENTAS.victor.id, 'comprador');
      c.igual(a.seller_id, CUENTAS.emmanuel.id, 'vendedor');
      c.igual((await api.victor.saldo()).crc, antes.victor.crc, 'crear no debe mover plata');
    });

    await f.paso('A1: victor fondea y el dinero pasa a la cuenta de garantía', async (c) => {
      await accionEnDetalle(victor, desc.a1, txt('Fondear'));
      await verTexto(victor.page, txt('Fondeado'));
      const a = await agreement('a1');
      c.igual(a.status, 'funded', 'estado tras fondear');
      c.ok(!!a.deliver_by, 'al fondear debe fijarse el plazo de entrega (deliver_by)');
      c.igual((await api.victor.saldo()).crc, antes.victor.crc - centimos(2000), 'saldo de victor');
      c.igual(bd.saldoCuenta(ESCROW_CRC), antes.garantia + centimos(2000), 'cuenta de garantía en el libro');
      const mov = (await api.victor.movimientos({ type: 'escrow_fund', limit: '5' }))[0];
      c.ok(mov && mov.amount === centimos(2000), 'falta el movimiento escrow_fund de victor');
      const lineas = bd.asiento({ llave: `escrow:fund:${id.a1}` });
      c.ok(bd.lineaDe(lineas, bd.cuentaUsuario(CUENTAS.victor.id, 'CRC'), 'debit'), 'falta el débito a victor en el libro');
      c.ok(bd.lineaDe(lineas, ESCROW_CRC, 'credit'), 'falta el crédito a la garantía en el libro');
    });

    await f.paso('A1: reglas de quién puede qué (el comprador no entrega, el vendedor no libera)', async (c) => {
      c.respuesta(await api.victor.post(`/escrow/${id.a1}/deliver`, {}), 403, 'el comprador marca la entrega', 'ESCROW_SELLER_ONLY');
      c.respuesta(await api.emmanuel.post(`/escrow/${id.a1}/release`, {}), 403, 'el vendedor libera su propio pago', 'ESCROW_BUYER_ONLY');
      c.respuesta(await api.keilor.get(`/escrow/${id.a1}`), 403, 'un tercero lee el acuerdo', 'ESCROW_FORBIDDEN');
      c.respuesta(await api.emmanuel.post(`/escrow/${id.a1}/fund`, {}), 403, 'el vendedor fondea', 'ESCROW_BUYER_ONLY');
      c.igual((await agreement('a1')).status, 'funded', 'estado tras los rechazos');
    });

    await f.paso('A1: emmanuel ve el acuerdo fondeado y marca la entrega', async (c) => {
      await cerrarDetalle(victor);
      emmanuel = await abrirSesion(f, 'emmanuel');
      await abrirPagosProtegidos(emmanuel);
      await verTexto(emmanuel.page, txt('Fondeado'));
      await accionEnDetalle(emmanuel, desc.a1, txt('Marcar como entregado'));
      const a = await agreement('a1', 'emmanuel');
      c.ok(!!a.delivered_at, 'delivered_at debería estar fijado');
      c.ok(!!a.review_by, 'review_by debería estar fijado');
      c.igual(a.status, 'funded', 'marcar la entrega no cambia el estado');
      c.igual((await api.emmanuel.saldo()).crc, antes.emmanuel.crc, 'marcar la entrega no mueve plata');
    });

    await f.paso('A1: victor libera el pago y emmanuel lo recibe', async (c) => {
      await cerrarDetalle(emmanuel);
      await volver(victor.page);
      await abrirPagosProtegidos(victor);
      await accionEnDetalle(victor, desc.a1, txt('Liberar al vendedor'));
      await verTexto(victor.page, txt('Liberado'));
      const a = await agreement('a1');
      c.igual(a.status, 'released', 'estado final');
      c.ok(!!a.released_at, 'released_at');
      c.igual((await api.emmanuel.saldo()).crc, antes.emmanuel.crc + centimos(2000), 'saldo de emmanuel');
      c.igual(bd.saldoCuenta(ESCROW_CRC), antes.garantia, 'la garantía vuelve a su valor inicial');
      const mov = (await api.emmanuel.movimientos({ type: 'escrow_receive', limit: '5' }))[0];
      c.ok(mov && mov.amount === centimos(2000), 'falta el movimiento escrow_receive de emmanuel');
      const lineas = bd.asiento({ llave: `escrow:release:${id.a1}` });
      c.ok(bd.lineaDe(lineas, ESCROW_CRC, 'debit'), 'falta el débito a la garantía');
      c.ok(bd.lineaDe(lineas, bd.cuentaUsuario(CUENTAS.emmanuel.id, 'CRC'), 'credit'), 'falta el crédito a emmanuel');
      // Repetir la accion no paga dos veces.
      const otra = await api.victor.post(`/escrow/${id.a1}/release`, {});
      c.respuesta(otra, 200, 'repetir la liberación');
      c.igual((await api.emmanuel.saldo()).crc, antes.emmanuel.crc + centimos(2000), 'repetir no paga dos veces');
      await cerrarDetalle(victor);
    });

    // ── A2: disputa a favor del vendedor ─────────────────────────────────
    await f.paso('A2: victor crea y fondea ₡1.500 y abre una disputa con motivo', async (c) => {
      await crearPorLaPantalla(victor, { telefono: CUENTAS.emmanuel.telefono, monto: 1500, descripcion: desc.a2 });
      id.a2 = (await buscarPorDescripcion('a2')).id;
      await accionEnDetalle(victor, desc.a2, txt('Fondear'));
      await verTexto(victor.page, txt('Fondeado'));
      await boton(ultimoDialogo(victor.page), txt('Abrir disputa'), { exacto: true }).click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByPlaceholder(txt('Motivo')).fill('No llegó lo acordado');
      await boton(hoja, txt('Enviar disputa'), { exacto: true }).click();
      await verTexto(victor.page, txt('En disputa'));
      const a = await agreement('a2');
      c.igual(a.status, 'disputed', 'estado tras disputar');
      c.igual(a.dispute_reason, 'No llegó lo acordado', 'motivo guardado');
      c.igual(bd.saldoCuenta(ESCROW_CRC), antes.garantia + centimos(1500), 'la garantía retiene el dinero en disputa');
      await cerrarDetalle(victor);
    });

    await f.paso('A2: keilor (administrador) falla a favor del vendedor desde "Disputas de escrow"', async (c) => {
      keilor = await abrirSesion(f, 'keilor');
      const antesE = (await api.emmanuel.saldo()).crc;
      await resolverComoAdmin(keilor, desc.a2, txt('A favor del vendedor'));
      const a = await agreement('a2');
      c.igual(a.status, 'released', 'estado tras resolver a favor del vendedor');
      c.igual((await api.emmanuel.saldo()).crc, antesE + centimos(1500), 'emmanuel recibe el pago');
      c.igual(bd.saldoCuenta(ESCROW_CRC), antes.garantia, 'la garantía se vacía');
    });

    // ── A3: disputa a favor del comprador ────────────────────────────────
    await f.paso('A3: se crea, se fondea y se disputa ₡1.200 (el comprador desde la pantalla, el resto por API)', async (c) => {
      const r = await api.victor.post('/escrow', { seller_phone: CUENTAS.emmanuel.telefono, amount_minor: centimos(1200), currency: 'CRC', description: desc.a3 });
      c.exigirRespuesta(r, 201, 'crear A3');
      id.a3 = r.data.id;
      c.exigirRespuesta(await api.victor.post(`/escrow/${id.a3}/fund`, {}), 200, 'fondear A3');
      c.exigirRespuesta(await api.emmanuel.post(`/escrow/${id.a3}/dispute`, { reason: 'El comprador no recibió nada' }), 200, 'disputar A3 (vendedor)');
      c.igual((await agreement('a3')).status, 'disputed', 'estado de A3');
    });

    await f.paso('A3: keilor falla a favor del comprador y victor recupera su dinero', async (c) => {
      const antesV = (await api.victor.saldo()).crc;
      const antesE = (await api.emmanuel.saldo()).crc;
      await resolverComoAdmin(keilor, desc.a3, txt('A favor del comprador'));
      const a = await agreement('a3');
      c.igual(a.status, 'refunded', 'estado tras resolver a favor del comprador');
      c.igual((await api.victor.saldo()).crc, antesV + centimos(1200), 'victor recupera el dinero');
      c.igual((await api.emmanuel.saldo()).crc, antesE, 'emmanuel no cobra');
      const mov = (await api.victor.movimientos({ type: 'escrow_refund', limit: '5' }))[0];
      c.ok(mov && mov.amount === centimos(1200), 'falta el movimiento escrow_refund de victor');
      c.igual(bd.saldoCuenta(ESCROW_CRC), antes.garantia, 'la garantía vuelve a su valor inicial');
      // Ya no quedan disputas abiertas y resolver otra vez es un error.
      const cola = (await api.keilor.exigir('GET', '/admin/escrow?status=disputed')).data;
      c.igual(cola.total, 0, 'disputas abiertas en la cola del administrador');
      c.respuesta(await api.keilor.post(`/admin/escrow/${id.a3}/resolve`, { outcome: 'released' }), 409, 'resolver un acuerdo ya resuelto', 'ESCROW_INVALID_STATE');
    });

    // ── A4: cancelacion ──────────────────────────────────────────────────
    await f.paso('A4: victor crea ₡500 y lo cancela sin fondear', async (c) => {
      await crearPorLaPantalla(victor, { telefono: CUENTAS.emmanuel.telefono, monto: 500, descripcion: desc.a4 });
      id.a4 = (await buscarPorDescripcion('a4')).id;
      const saldoAntes = (await api.victor.saldo()).crc;
      await accionEnDetalle(victor, desc.a4, txt('Cancelar acuerdo'));
      await verTexto(victor.page, txt('Cancelado'));
      c.igual((await agreement('a4')).status, 'cancelled', 'estado tras cancelar');
      c.igual((await api.victor.saldo()).crc, saldoAntes, 'cancelar no mueve plata');
    });

    await f.paso('El libro cuadra y la garantía quedó como al empezar', async (c) => {
      c.igual(bd.saldoCuenta(ESCROW_CRC), antes.garantia, 'cuenta de garantía');
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });
  },
};
