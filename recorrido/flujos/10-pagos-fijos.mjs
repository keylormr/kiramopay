// Pagos fijos: una lista para no olvidar los pagos que se repiten. NO mueve
// dinero (el texto de la pantalla lo dice: "el pago lo haces tú por tu cuenta"),
// asi que ademas de probar la lista, el flujo comprueba que ni el saldo ni el
// libro cambian.
import { abrirSesion, abrirDesdePerfil, boton, ultimoDialogo, sinDialogos, verTexto } from '../lib/ui.mjs';
import { clientes, centimos } from '../lib/comun.mjs';
import { txt } from '../lib/textos.mjs';
import * as bd from '../lib/bd.mjs';

export default {
  id: 'pagos-fijos',
  nombre: 'Pagos fijos (lista de pagos que se repiten)',
  async ejecutar(f, ctx) {
    const api = await clientes('victor');
    const nombre = `Alquiler ${Math.random().toString(36).slice(2, 6)}`;
    const MONTO = 5000;
    const antes = {};
    let victor;
    let pago;

    const buscar = async () => ((await api.victor.exigir('GET', '/recurring')).data ?? []).find((x) => x.label === nombre);

    await f.paso('Antes: saldo, asientos del libro y lista de pagos fijos de victor', async () => {
      antes.saldo = await api.victor.saldo();
      antes.asientos = bd.totalAsientos();
      antes.cantidad = ((await api.victor.exigir('GET', '/recurring')).data ?? []).length;
    });

    await f.paso('Victor abre Perfil > Pagos fijos y crea un pago mensual de ₡5.000', async () => {
      victor = await abrirSesion(f, 'victor');
      await abrirDesdePerfil(victor.page, txt('Pagos fijos'));
      await boton(victor.page, txt('Nuevo pago fijo'), { exacto: true }).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByLabel(txt('Nombre del pago')).fill(nombre);
      await boton(hoja, txt('Servicio'), { exacto: true }).click();
      await hoja.getByLabel(txt('Monto'), { exact: true }).fill(String(MONTO));
      await boton(hoja, txt('Mensual'), { exacto: true }).click();
      await hoja.getByLabel(txt('Próxima fecha')).fill('2026-11-15');
      await boton(hoja, txt('Guardar'), { exacto: true }).click();
      await sinDialogos(victor.page);
      await verTexto(victor.page, nombre);
    });

    await f.paso('El servidor guardó el pago con sus datos y no se movió dinero', async (c) => {
      pago = await buscar();
      c.exigir(pago, `el pago "${nombre}" no aparece en GET /recurring`);
      c.igual(pago.amount, centimos(MONTO), 'monto');
      c.igual(pago.type, 'service', 'tipo');
      c.igual(pago.frequency, 'monthly', 'frecuencia');
      c.igual(String(pago.next_date).slice(0, 10), '2026-11-15', 'próxima fecha');
      c.igual(pago.currency, 'CRC', 'moneda');
      c.ok(pago.enabled === true, 'el pago nuevo debería estar activo');
      c.igual((await api.victor.saldo()).crc, antes.saldo.crc, 'saldo de victor');
      c.igual(bd.totalAsientos(), antes.asientos, 'asientos del libro');
    });

    await f.paso('Victor lo pausa y lo reanuda', async (c) => {
      await boton(victor.page, `Pausar: ${nombre}`, { exacto: true }).click();
      await boton(victor.page, `Reanudar: ${nombre}`, { exacto: true }).waitFor({ state: 'visible' });
      c.igual((await buscar()).enabled, false, 'activo tras pausar');
      await boton(victor.page, `Reanudar: ${nombre}`, { exacto: true }).click();
      await boton(victor.page, `Pausar: ${nombre}`, { exacto: true }).waitFor({ state: 'visible' });
      c.igual((await buscar()).enabled, true, 'activo tras reanudar');
    });

    await f.paso('"Ya lo pagué" anota el pago y pasa la próxima fecha al mes siguiente', async (c) => {
      await boton(victor.page, txt('Ya lo pagué'), { exacto: true }).first().click();
      const hoja = ultimoDialogo(victor.page);
      await boton(hoja, txt('Sí, ya lo pagué'), { exacto: true }).click();
      await sinDialogos(victor.page);
      const hoy = Date.now();
      const despues = await buscar();
      c.igual(String(despues.next_date).slice(0, 10), '2026-12-15', 'próxima fecha tras anotar el pago');
      const ultimo = Date.parse(String(despues.last_paid_date).slice(0, 10));
      c.ok(Number.isFinite(ultimo) && Math.abs(hoy - ultimo) <= 2 * 86400000, `último pago anotado: ${despues.last_paid_date}`);
      c.igual((await api.victor.saldo()).crc, antes.saldo.crc, 'anotar el pago no debe mover plata');
      c.igual(bd.totalAsientos(), antes.asientos, 'anotar el pago no debe escribir asientos');
    });

    await f.paso('Rechazos del servidor: nombre vacío, monto cero, frecuencia, fecha, tipo y pago ajeno', async (c) => {
      const valido = { label: 'Prueba', type: 'service', amount: 100000, currency: 'CRC', frequency: 'monthly', next_date: '2026-11-15' };
      c.respuesta(await api.victor.post('/recurring', { ...valido, label: '' }), 400, 'nombre vacío', 'RECURRING_LABEL_REQUIRED');
      c.respuesta(await api.victor.post('/recurring', { ...valido, amount: 0 }), 400, 'monto cero', 'RECURRING_INVALID_AMOUNT');
      c.respuesta(await api.victor.post('/recurring', { ...valido, frequency: 'yearly' }), 400, 'frecuencia desconocida', 'RECURRING_INVALID_FREQUENCY');
      c.respuesta(await api.victor.post('/recurring', { ...valido, next_date: '15/11/2026' }), 400, 'fecha mal escrita', 'RECURRING_INVALID_DATE');
      c.respuesta(await api.victor.post('/recurring', { ...valido, type: 'regalo' }), 400, 'tipo desconocido', 'RECURRING_INVALID_TYPE');
      const otro = await clientes('keilor');
      c.respuesta(await otro.keilor.delete(`/recurring/${pago.id}`), 404, 'borrar el pago fijo de otra persona', 'RECURRING_NOT_FOUND');
      c.respuesta(await otro.keilor.post(`/recurring/${pago.id}/toggle`, {}), 404, 'pausar el pago fijo de otra persona', 'RECURRING_NOT_FOUND');
      c.ok(!!(await buscar()), 'el pago de victor debe seguir en su lista');
    });

    await f.paso('Victor elimina el pago y desaparece de la lista', async (c) => {
      await boton(victor.page, `Eliminar: ${nombre}`, { exacto: true }).click();
      await boton(ultimoDialogo(victor.page), txt('Eliminar'), { exacto: true }).last().click();
      await sinDialogos(victor.page);
      await victor.page.getByText(nombre).first().waitFor({ state: 'hidden', timeout: 10000 });
      c.ok(!(await buscar()), 'el pago sigue en GET /recurring después de eliminarlo');
      c.igual(((await api.victor.exigir('GET', '/recurring')).data ?? []).length, antes.cantidad, 'cantidad de pagos fijos al final');
      c.igual((await api.victor.saldo()).crc, antes.saldo.crc, 'saldo de victor al final');
      c.igual(bd.totalAsientos(), antes.asientos, 'asientos del libro al final');
    });
  },
};
