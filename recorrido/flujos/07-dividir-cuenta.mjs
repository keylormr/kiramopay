// Dividir cuenta: victor reparte ₡3.000 en partes iguales con emmanuel y keilor.
// Emmanuel paga su parte (la plata llega a victor) y keilor rechaza la suya, con
// lo que el grupo queda liquidado.
import { CUENTAS } from '../lib/entorno.mjs';
import { abrirSesion, boton, ultimoDialogo, sinDialogos, verTexto, reposar } from '../lib/ui.mjs';
import { clientes, centimos, problemasDelLibro } from '../lib/comun.mjs';
import { txt } from '../lib/textos.mjs';
import { esperarHasta } from '../lib/api.mjs';
import * as bd from '../lib/bd.mjs';

async function abrirDividirCuenta(sesion) {
  const p = sesion.page;
  await boton(p, /Dividir cuenta/).first().click();
  await p.getByText(txt('Dividir cuenta'), { exact: true }).first().waitFor({ state: 'visible' });
  await reposar(p);
}

export default {
  id: 'dividir-cuenta',
  nombre: 'Dividir cuenta entre tres',
  async ejecutar(f, ctx) {
    const api = await clientes('victor', 'emmanuel', 'keilor');
    const titulo = `Cena ${Math.random().toString(36).slice(2, 6)}`;
    const TOTAL = 3000;
    const CUOTA = 1000;
    let victor;
    let emmanuel;
    let keilor;
    let grupo;
    const antes = {};

    const detalle = async () => (await api.victor.exigir('GET', `/splits/${grupo}`)).data;

    await f.paso('Saldos antes de dividir', async () => {
      antes.victor = await api.victor.saldo();
      antes.emmanuel = await api.emmanuel.saldo();
      antes.keilor = await api.keilor.saldo();
    });

    await f.paso(`Victor crea la división de ₡${TOTAL} con emmanuel y keilor`, async (c) => {
      victor = await abrirSesion(f, 'victor');
      await abrirDividirCuenta(victor);
      await boton(victor.page, txt('Crear división'), { exacto: true }).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByPlaceholder(txt('Ej: Cena, Viaje, Compras...')).fill(titulo);
      await hoja.getByPlaceholder('0', { exact: true }).fill(String(TOTAL));
      await hoja.getByPlaceholder(txt('Nombre del contacto')).nth(0).fill('Emmanuel');
      await hoja.getByPlaceholder(txt('Teléfono')).nth(0).fill(CUENTAS.emmanuel.telefono);
      await hoja.getByPlaceholder(txt('Nombre del contacto')).nth(1).fill('Keilor');
      await hoja.getByPlaceholder(txt('Teléfono')).nth(1).fill(CUENTAS.keilor.telefono);
      await boton(hoja, txt('Crear división'), { exacto: true }).last().click();
      await sinDialogos(victor.page, 15000);
      await verTexto(victor.page, titulo);
      const lista = (await api.victor.exigir('GET', '/splits')).data ?? [];
      const g = lista.find((x) => x.title === titulo);
      c.exigir(g, 'la división no aparece en GET /splits');
      grupo = g.id;
      c.igual(g.total_amount, centimos(TOTAL), 'total de la división');
      c.igual(g.status, 'active', 'estado del grupo');
    });

    await f.paso('Las cuotas: la de victor nace pagada y las otras dos pendientes; crear no mueve plata', async (c) => {
      const d = await detalle();
      c.igual(d.shares.length, 3, 'cantidad de cuotas');
      const porUsuario = Object.fromEntries(d.shares.map((s) => [s.user_id, s]));
      c.igual(porUsuario[CUENTAS.victor.id]?.status, 'paid', 'cuota de victor');
      c.igual(porUsuario[CUENTAS.emmanuel.id]?.status, 'pending', 'cuota de emmanuel');
      c.igual(porUsuario[CUENTAS.keilor.id]?.status, 'pending', 'cuota de keilor');
      for (const s of d.shares) c.igual(s.amount, centimos(CUOTA), `monto de la cuota de ${s.user_name}`);
      c.igual((await api.victor.saldo()).crc, antes.victor.crc, 'crear no debe mover plata');
    });

    await f.paso('La lista muestra el estado de la división en español', async (c) => {
      // Defecto conocido de la pantalla: pinta el estado crudo del servidor ("active").
      const crudo = await victor.page.getByText('active', { exact: true }).count();
      if (crudo) await victor.page.getByText('active', { exact: true }).first().scrollIntoViewIfNeeded().catch(() => {});
      c.igual(crudo, 0, 'veces que la lista pinta el estado en inglés ("active")');
    }, { seguir: true });

    await f.paso('Emmanuel abre "Dividir cuenta", ve la división y paga su parte', async (c) => {
      emmanuel = await abrirSesion(f, 'emmanuel');
      await abrirDividirCuenta(emmanuel);
      await emmanuel.page.getByText(titulo).first().click();
      await boton(ultimoDialogo(emmanuel.page), txt('Pagar mi parte'), { exacto: true }).click();
      // "Pagada" ya sale en la cuota de victor: se espera a que desaparezca el boton de pagar.
      await boton(emmanuel.page, txt('Pagar mi parte'), { exacto: true }).waitFor({ state: 'detached', timeout: 15000 });
      await esperarHasta(async () => (await detalle()).shares.find((s) => s.user_id === CUENTAS.emmanuel.id)?.status === 'paid', { descripcion: 'que se registre el pago de emmanuel' }).catch(() => {});
      const d = await detalle();
      const cuota = d.shares.find((s) => s.user_id === CUENTAS.emmanuel.id);
      c.igual(cuota.status, 'paid', 'cuota de emmanuel');
      c.ok(!!cuota.paid_at, 'paid_at de la cuota');
      c.igual(d.group.status, 'active', 'el grupo sigue activo mientras keilor no responda');
    });

    await f.paso('Emmanuel baja ₡1.000 y victor los recibe, con su movimiento y su asiento', async (c) => {
      c.igual((await api.emmanuel.saldo()).crc, antes.emmanuel.crc - centimos(CUOTA), 'saldo de emmanuel');
      c.igual((await api.victor.saldo()).crc, antes.victor.crc + centimos(CUOTA), 'saldo de victor');
      const envio = (await api.emmanuel.movimientos({ type: 'p2p_send', limit: '5' }))[0];
      c.exigir(envio, 'emmanuel no tiene movimiento p2p_send');
      c.igual(envio.amount, centimos(CUOTA), 'monto del movimiento de emmanuel');
      const recibo = (await api.victor.movimientos({ type: 'p2p_receive', limit: '5' }))[0];
      c.exigir(recibo, 'victor no tiene movimiento p2p_receive');
      c.igual(recibo.amount, centimos(CUOTA), 'monto del movimiento de victor');
      const lineas = bd.asiento({ llave: `split:${grupo}:${CUENTAS.emmanuel.id}` });
      c.ok(bd.lineaDe(lineas, bd.cuentaUsuario(CUENTAS.emmanuel.id, 'CRC'), 'debit'), 'falta el débito a emmanuel en el libro');
      c.ok(bd.lineaDe(lineas, bd.cuentaUsuario(CUENTAS.victor.id, 'CRC'), 'credit'), 'falta el crédito a victor en el libro');
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('Pagar dos veces la misma cuota no cobra otra vez', async (c) => {
      const antesE = (await api.emmanuel.saldo()).crc;
      const r = await api.emmanuel.post(`/splits/${grupo}/pay`, {});
      c.ok(r.status === 204 || r.status === 400, `repetir el pago respondió ${r.resumen()}`);
      c.igual((await api.emmanuel.saldo()).crc, antesE, 'saldo de emmanuel tras repetir el pago');
    });

    await f.paso('Keilor rechaza su parte y el grupo queda liquidado, sin mover plata', async (c) => {
      keilor = await abrirSesion(f, 'keilor');
      await abrirDividirCuenta(keilor);
      await keilor.page.getByText(titulo).first().click();
      await boton(ultimoDialogo(keilor.page), txt('Rechazar mi parte'), { exacto: true }).click();
      // Pide confirmacion en el mismo panel.
      await boton(ultimoDialogo(keilor.page), txt('Rechazar mi parte'), { exacto: true }).last().click();
      await verTexto(keilor.page, txt('Rechazada'));
      await esperarHasta(async () => (await detalle()).group.status === 'settled', { descripcion: 'que el grupo quede liquidado' }).catch(() => {});
      const d = await detalle();
      c.igual(d.shares.find((s) => s.user_id === CUENTAS.keilor.id).status, 'declined', 'cuota de keilor');
      c.igual(d.group.status, 'settled', 'estado del grupo');
      c.igual((await api.keilor.saldo()).crc, antes.keilor.crc, 'keilor no pierde nada al rechazar');
    });

    await f.paso('Una cuota de ₡100.000 pide segundo factor (como cualquier salida de ese monto)', async (c) => {
      // Defecto conocido: la pantalla y el servidor responden un 400 generico (PAY_FAILED) en lugar de
      // pedir el segundo factor, y la cuota nunca se puede pagar.
      const crear = await api.victor.post('/splits', {
        title: `Grande ${titulo}`,
        total_amount: centimos(300000),
        currency: 'CRC',
        split_type: 'equal',
        participants: [
          { user_phone: CUENTAS.emmanuel.telefono, user_name: 'Emmanuel' },
          { user_phone: CUENTAS.keilor.telefono, user_name: 'Keilor' },
        ],
      });
      c.exigirRespuesta(crear, 201, 'crear la división grande');
      const grande = crear.data.group.id;
      const antesE = (await api.emmanuel.saldo()).crc;
      const pago = await api.emmanuel.post(`/splits/${grande}/pay`, {});
      c.respuesta(pago, 428, 'pagar una cuota de ₡100.000 sin segundo factor', 'MFA_REQUIRED');
      c.igual((await api.emmanuel.saldo()).crc, antesE, 'el rechazo no debe mover plata');
      await api.victor.delete(`/splits/${grande}`);
    }, { seguir: true });
  },
};

