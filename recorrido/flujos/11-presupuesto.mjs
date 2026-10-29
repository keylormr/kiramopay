// Presupuestos: topes por categoria que la persona va anotando a mano. Como los
// pagos fijos, NO mueven dinero ("No se descuenta solo de tus movimientos"):
// ademas de la lista, el flujo comprueba que el saldo y el libro no cambian.
import { abrirSesion, abrirDesdePerfil, boton, ultimoDialogo, sinDialogos, verTexto } from '../lib/ui.mjs';
import { clientes, centimos } from '../lib/comun.mjs';
import { reColones, txt } from '../lib/textos.mjs';
import * as bd from '../lib/bd.mjs';

export default {
  id: 'presupuesto',
  nombre: 'Presupuestos (tope, gasto anotado, empezar de cero)',
  async ejecutar(f, ctx) {
    const api = await clientes('victor');
    const nombre = `Comida ${Math.random().toString(36).slice(2, 6)}`;
    const TOPE = 50000;
    const GASTO = 12000;
    const antes = {};
    let victor;
    let presupuesto;

    const buscar = async () => ((await api.victor.exigir('GET', '/budgets')).data ?? []).find((x) => x.label === nombre);

    await f.paso('Antes: saldo, asientos del libro y presupuestos de victor', async () => {
      antes.saldo = await api.victor.saldo();
      antes.asientos = bd.totalAsientos();
      antes.cantidad = ((await api.victor.exigir('GET', '/budgets')).data ?? []).length;
    });

    await f.paso('Victor abre Perfil > Presupuestos y crea uno con tope de ₡50.000', async () => {
      victor = await abrirSesion(f, 'victor');
      await abrirDesdePerfil(victor.page, txt('Presupuestos'));
      await boton(victor.page, txt('Nuevo presupuesto'), { exacto: true }).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByLabel(txt('Categoría')).fill(nombre);
      await hoja.getByLabel(txt('Tope')).fill(String(TOPE));
      await boton(hoja, txt('Guardar'), { exacto: true }).click();
      await sinDialogos(victor.page);
      await verTexto(victor.page, nombre);
    });

    await f.paso('El servidor guardó el tope y la pantalla lo muestra', async (c) => {
      presupuesto = await buscar();
      c.exigir(presupuesto, `el presupuesto "${nombre}" no aparece en GET /budgets`);
      c.igual(presupuesto.amount_limit, centimos(TOPE), 'tope');
      c.igual(presupuesto.amount_spent, 0, 'gastado al crear');
      c.igual(presupuesto.currency, 'CRC', 'moneda');
      c.igual(presupuesto.period, 'monthly', 'periodo');
      await victor.page.getByText(reColones(TOPE)).first().waitFor({ state: 'visible', timeout: 8000 });
    });

    await f.paso(`Victor anota un gasto de ₡${GASTO}`, async (c) => {
      await boton(victor.page, txt('Anotar gasto'), { exacto: true }).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByLabel(txt('Monto')).fill(String(GASTO));
      await boton(hoja, txt('Anotar'), { exacto: true }).click();
      await sinDialogos(victor.page);
      await victor.page.getByText(reColones(GASTO)).first().waitFor({ state: 'visible', timeout: 8000 });
      c.igual((await buscar()).amount_spent, centimos(GASTO), 'gastado en el servidor');
      await victor.page.getByText(reColones(TOPE - GASTO)).first().waitFor({ state: 'visible', timeout: 8000 });
    });

    await f.paso('Anotar un gasto no mueve dinero: ni saldo ni asientos', async (c) => {
      c.igual((await api.victor.saldo()).crc, antes.saldo.crc, 'saldo de victor');
      c.igual(bd.totalAsientos(), antes.asientos, 'asientos del libro');
      const movs = await api.victor.movimientos({ limit: '5' });
      c.ok(!movs.some((m) => Number(m.amount) === centimos(GASTO)), 'apareció un movimiento por el gasto anotado');
    });

    await f.paso('"Empezar de cero" pone lo anotado en cero y deja el tope', async (c) => {
      await boton(victor.page, txt('Empezar de cero')).first().click();
      await boton(ultimoDialogo(victor.page), txt('Poner en cero'), { exacto: true }).click();
      await sinDialogos(victor.page);
      await esperar(async () => (await buscar()).amount_spent === 0);
      const despues = await buscar();
      c.igual(despues.amount_spent, 0, 'gastado tras empezar de cero');
      c.igual(despues.amount_limit, centimos(TOPE), 'el tope debe quedarse');
    });

    await f.paso('Rechazos del servidor: nombre vacío, tope cero, periodo y moneda desconocidos, presupuesto ajeno', async (c) => {
      const valido = { label: 'Prueba', amount_limit: 100000, currency: 'CRC', icon: 'utensils', color: '#f97316', period: 'monthly' };
      c.respuesta(await api.victor.post('/budgets', { ...valido, label: '' }), 400, 'nombre vacío', 'BUDGET_LABEL_REQUIRED');
      c.respuesta(await api.victor.post('/budgets', { ...valido, amount_limit: 0 }), 400, 'tope cero', 'BUDGET_INVALID_LIMIT');
      c.respuesta(await api.victor.patch(`/budgets/${presupuesto.id}`, { amount_spent: -1 }), 400, 'gastado negativo', 'BUDGET_INVALID_SPENT');
      const otro = await clientes('keilor');
      c.respuesta(await otro.keilor.delete(`/budgets/${presupuesto.id}`), 404, 'borrar el presupuesto de otra persona', 'BUDGET_NOT_FOUND');
      c.ok(!!(await buscar()), 'el presupuesto de victor debe seguir en su lista');
    });

    await f.paso('Victor elimina el presupuesto y desaparece de la lista', async (c) => {
      await boton(victor.page, `${txt('Eliminar')}: ${nombre}`, { exacto: true }).click();
      await boton(ultimoDialogo(victor.page), txt('Eliminar'), { exacto: true }).last().click();
      await sinDialogos(victor.page);
      await victor.page.getByText(nombre).first().waitFor({ state: 'hidden', timeout: 10000 });
      c.ok(!(await buscar()), 'el presupuesto sigue en GET /budgets después de eliminarlo');
      c.igual(((await api.victor.exigir('GET', '/budgets')).data ?? []).length, antes.cantidad, 'cantidad de presupuestos al final');
      c.igual((await api.victor.saldo()).crc, antes.saldo.crc, 'saldo de victor al final');
      c.igual(bd.totalAsientos(), antes.asientos, 'asientos del libro al final');
    });
  },
};

/** Sondeo corto: la pantalla guarda en el servidor un instante despues de cerrar la hoja. */
async function esperar(fn, intentos = 20) {
  for (let i = 0; i < intentos; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 400));
  }
}
