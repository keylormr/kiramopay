// Modo negocio del comercio de keilor: catalogo de productos, movimientos de
// venta, reportes y retiro del saldo del negocio a su billetera personal.
import { llave } from '../lib/entorno.mjs';
import { abrirSesion, ir, boton, ultimoDialogo, sinDialogos, verTexto, cambiarAPerfil, reposar } from '../lib/ui.mjs';
import { clientes, centimos, asegurarComercio, adminKp, problemasDelLibro } from '../lib/comun.mjs';
import { esperarHasta } from '../lib/api.mjs';
import { reColones, txt, escapar } from '../lib/textos.mjs';
import * as bd from '../lib/bd.mjs';

const RETIRO = 500;

export default {
  id: 'modo-negocio',
  nombre: 'Modo negocio (catálogo, movimientos, reportes, retiro)',
  async ejecutar(f, ctx) {
    const api = await clientes('keilor', 'victor');
    let comercio;
    let keilor;
    let ventas;
    const antes = {};
    const producto = `Casado ${Math.random().toString(36).slice(2, 6)}`;

    const base = () => `/qr/merchants/${comercio.id}`;
    const saldoNegocio = async () => (await api.keilor.exigir('GET', `${base()}/balance?currency=CRC`)).data.balance;

    await f.paso('El comercio está aprobado y tiene al menos una venta (si falta, se prepara por API)', async (c) => {
      comercio = await asegurarComercio(ctx);
      ventas = (await api.keilor.exigir('GET', `${base()}/payments?limit=50`)).data ?? [];
      if (ventas.length === 0) {
        const codigo = await api.keilor.exigir('GET', `${base()}/code?currency=CRC`);
        const cobro = await api.keilor.exigir('POST', '/qr/charges', { qr_code_id: codigo.data.id, amount: centimos(1000), channel: 'counter' });
        await api.victor.exigir('POST', '/qr/pay', { qr_data: cobro.data.qr_data, charge_id: cobro.data.id });
        ventas = (await api.keilor.exigir('GET', `${base()}/payments?limit=50`)).data ?? [];
      }
      c.ok(ventas.length >= 1, 'el comercio no tiene ventas');
      antes.negocio = await saldoNegocio();
      antes.keilor = await api.keilor.saldo();
      c.ok(antes.negocio >= centimos(RETIRO), `el negocio debería tener al menos ₡${RETIRO} para el retiro: ${antes.negocio}`);
    });

    await f.paso('Keilor entra a su negocio y ve el saldo del negocio igual al del servidor', async () => {
      keilor = await abrirSesion(f, 'keilor');
      await cambiarAPerfil(keilor.page, comercio.nombre);
      await verTexto(keilor.page, txt('Saldo del negocio'));
      await keilor.page.getByText(reColones(antes.negocio / 100)).first().waitFor({ state: 'visible', timeout: 10000 });
    });

    await f.paso('El resumen del inicio del negocio concuerda en singular y plural', async (c) => {
      // Con un solo cobro dice "Último cobro", con varios "Últimos N cobros" (nunca "Últimos 1 cobros").
      const n = ventas.length;
      const esperado = n === 1 ? txt('Último cobro') : `Últimos ${n} cobros`;
      const aparece = await keilor.page.getByText(new RegExp(`^${escapar(esperado)}$`)).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
      if (!aparece) {
        const hallado = await keilor.page.getByText(/[ÚU]ltimos?\s+(\d+\s+)?cobros?/).first().innerText().catch(() => null);
        c.ok(false, `el resumen dice ${JSON.stringify(hallado)}: con ${n} cobro(s) debería decir "${esperado}"`);
      }
    }, { seguir: true });

    await f.paso(`Ajustes > Catálogo: agrega el producto "${producto}" de ₡2.500`, async (c) => {
      await ir(keilor.page, txt('Ajustes'));
      await boton(keilor.page, txt('Catálogo'), { exacto: true }).first().click();
      const hoja = ultimoDialogo(keilor.page);
      await boton(hoja, txt('Agregar producto'), { exacto: true }).click();
      await hoja.getByRole('textbox').first().fill(producto);
      await hoja.getByPlaceholder('0.00').fill('2500');
      await boton(hoja, txt('Agregar'), { exacto: true }).click();
      await verTexto(keilor.page, producto);
      const lista = (await api.keilor.exigir('GET', `${base()}/catalog`)).data ?? [];
      const item = lista.find((x) => x.name === producto);
      c.exigir(item, `el producto "${producto}" no aparece en GET /catalog`);
      c.igual(item.price_minor, centimos(2500), 'precio');
      c.igual(item.currency, 'CRC', 'moneda');
      c.ok(item.active === true, 'el producto nuevo debería estar activo');
    });

    await f.paso('Lo desactiva y lo vuelve a activar', async (c) => {
      const hoja = ultimoDialogo(keilor.page);
      const buscar = async () => ((await api.keilor.exigir('GET', `${base()}/catalog`)).data ?? []).find((x) => x.name === producto);
      await boton(hoja, txt('Desactivar'), { exacto: true }).first().click();
      await boton(hoja, txt('Activar'), { exacto: true }).first().waitFor({ state: 'visible' });
      c.igual((await buscar()).active, false, 'activo tras desactivar');
      await boton(hoja, txt('Activar'), { exacto: true }).first().click();
      await boton(hoja, txt('Desactivar'), { exacto: true }).first().waitFor({ state: 'visible' });
      c.igual((await buscar()).active, true, 'activo tras reactivar');
      c.igual((await buscar()).price_minor, centimos(2500), 'el precio no debe cambiar al activar y desactivar');
    });

    await f.paso('Lo elimina: sale de la lista y queda la auditoría del retiro del producto', async (c) => {
      const hoja = ultimoDialogo(keilor.page);
      await boton(hoja, txt('Eliminar producto'), { exacto: true }).first().click();
      await keilor.page.getByText(producto).first().waitFor({ state: 'hidden', timeout: 10000 });
      const lista = (await api.keilor.exigir('GET', `${base()}/catalog`)).data ?? [];
      c.ok(!lista.some((x) => x.name === producto), 'el producto sigue en GET /catalog tras eliminarlo');
      const auditoria = bd.consultar("SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'merchant_catalog_item_removed'");
      c.ok(auditoria[0].n >= 1, 'falta la auditoría "merchant_catalog_item_removed"');
      await keilor.page.keyboard.press('Escape');
      await sinDialogos(keilor.page).catch(() => {});
    });

    await f.paso('Movimientos: la pantalla lista las ventas con su neto, comisión y bruto', async (c) => {
      await ir(keilor.page, txt('Movimientos'));
      const venta = ventas[0];
      const neto = (venta.amount - venta.fee) / 100;
      await keilor.page.getByText(reColones(neto)).first().waitFor({ state: 'visible', timeout: 10000 });
      c.ok(venta.fee < venta.amount, `comisión inesperada: ${venta.fee} sobre ${venta.amount}`);
      c.igual(venta.status, 'completed', 'estado de la venta');
    });

    await f.paso('Reportes de 7, 30 y 90 días coinciden con las ventas del servidor', async (c) => {
      await ir(keilor.page, txt('Reportes'));
      for (const dias of [7, 30, 90]) {
        const boton_ = boton(keilor.page, `${dias} días`, { exacto: true });
        await boton_.click();
        await reposar(keilor.page, 600);
        const informe = (await api.keilor.exigir('GET', `${base()}/report?days=${dias}&tz=360`)).data;
        c.ok(informe.totals.count >= 1, `el reporte de ${dias} días debería contar al menos una venta`);
        c.igual(informe.totals.net, informe.totals.gross - informe.totals.fee, `neto del reporte de ${dias} días`);
        await keilor.page.getByText(reColones(informe.totals.net / 100)).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
          c.ok(false, `la pantalla de ${dias} días no muestra el neto ₡${informe.totals.net / 100}`);
        });
      }
      const suma = ventas.reduce((s, v) => s + (v.amount - v.fee), 0);
      const informe = (await api.keilor.exigir('GET', `${base()}/report?days=90&tz=360`)).data;
      c.ok(informe.totals.net >= suma, `el neto de 90 días (${informe.totals.net}) no cubre la suma de las ventas listadas (${suma})`);
    });

    await f.paso('El reporte en CSV exige el plan Analítica; con el plan, baja con su encabezado', async (c) => {
      const sinPlan = await api.keilor.get(`${base()}/report.csv?days=30&tz=360&lang=es`);
      c.respuesta(sinPlan, 403, 'CSV sin el plan Analítica', 'PLAN_REQUIRED');
      const admin = await adminKp();
      c.respuesta(await admin.patch(`/admin/merchants/${comercio.id}/plan`, { plan: 'analitica' }), 200, 'admin.kp asigna el plan Analítica');
      try {
        const conPlan = await api.keilor.get(`${base()}/report.csv?days=30&tz=360&lang=es`);
        c.respuesta(conPlan, 200, 'CSV con el plan Analítica');
        c.ok(String(conPlan.texto).includes('seccion,desde,hasta,clave,nombre,bruto,comision,neto,cobros'), `encabezado del CSV: ${String(conPlan.texto).slice(0, 120)}`);
      } finally {
        c.respuesta(await admin.patch(`/admin/merchants/${comercio.id}/plan`, { plan: 'base' }), 200, 'admin.kp devuelve el plan Base');
      }
    });

    await f.paso(`Inicio del negocio: retira ₡${RETIRO} a su cuenta personal`, async (c) => {
      await ir(keilor.page, txt('Inicio'));
      await boton(keilor.page, txt('Retirar a mi cuenta')).first().click();
      const hoja = ultimoDialogo(keilor.page);
      await hoja.getByPlaceholder('0.00').fill(String(RETIRO));
      await boton(hoja, txt('Retirar a mi cuenta')).last().click();
      await sinDialogos(keilor.page);
      await esperarHasta(async () => (await saldoNegocio()) === antes.negocio - centimos(RETIRO), { descripcion: 'que baje el saldo del negocio' });
      c.igual((await api.keilor.saldo()).crc, antes.keilor.crc + centimos(RETIRO), 'billetera personal de keilor');
      const mov = (await api.keilor.movimientos({ type: 'merchant_withdrawal', limit: '5' }))[0];
      c.exigir(mov, 'keilor no tiene movimiento merchant_withdrawal');
      c.igual(mov.amount, centimos(RETIRO), 'monto del movimiento');
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('La pantalla del negocio muestra el saldo nuevo sin tener que salir y volver', async (c) => {
      // Los datos del negocio se refrescan solos tras retirar.
      await keilor.page.getByText(reColones((antes.negocio - centimos(RETIRO)) / 100)).first().waitFor({ state: 'visible', timeout: 6000 }).catch(() => {
        c.ok(false, `la pantalla sigue mostrando el saldo viejo del negocio; el nuevo es ₡${(antes.negocio - centimos(RETIRO)) / 100}`);
      });
    }, { seguir: true });

    await f.paso('Retiro del negocio: repetir con la misma llave no retira dos veces y lo imposible se rechaza', async (c) => {
      const k = llave('retiro-negocio');
      const cuerpo = { amount: centimos(1), currency: 'CRC', idempotency_key: k };
      const base0 = await saldoNegocio();
      c.respuesta(await api.keilor.post(`${base()}/withdraw`, cuerpo), 200, 'retiro de ₡1');
      const repetido = await api.keilor.post(`${base()}/withdraw`, cuerpo);
      c.respuesta(repetido, 200, 'repetir el retiro con la misma llave');
      c.ok(repetido.data?.replayed === true, 'la repetición debería traer replayed:true');
      c.igual(await saldoNegocio(), base0 - centimos(1), 'se retira UNA sola vez');
      c.respuesta(await api.keilor.post(`${base()}/withdraw`, { ...cuerpo, amount: centimos(2) }), 409, 'misma llave con otro monto', 'LLAVE_REUTILIZADA');
      c.respuesta(await api.keilor.post(`${base()}/withdraw`, { ...cuerpo, amount: base0 + 100, idempotency_key: llave('retiro-negocio') }), 422, 'retirar más que el saldo del negocio', 'MERCHANT_INSUFFICIENT_BALANCE');
      c.respuesta(await api.keilor.post(`${base()}/withdraw`, { ...cuerpo, amount: 0, idempotency_key: llave('retiro-negocio') }), 400, 'retirar cero', 'VALIDATION_ERROR');
      c.respuesta(await api.victor.post(`${base()}/withdraw`, { ...cuerpo, idempotency_key: llave('retiro-negocio') }), 404, 'victor no es del comercio', 'MERCHANT_NOT_FOUND');
    });
  },
};
