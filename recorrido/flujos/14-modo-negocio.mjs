// Modo negocio del comercio de keilor: catalogo de productos, movimientos de
// venta, reportes y retiro del saldo del negocio a su billetera personal.
import { llave } from '../lib/entorno.mjs';
import { abrirSesion, ir, boton, ultimoDialogo, dialogo, sinDialogos, verTexto, cambiarAPerfil, reposar } from '../lib/ui.mjs';
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

    await f.paso('Inicio: la sección "Ventas" (hoy, 7 días y mes) trae lo mismo que el resumen del servidor, con "1 cobro" en singular y "N cobros" en plural', async (c) => {
      // El servidor cuenta cada periodo en el dia de calendario de quien mira (tz=360, Costa Rica, el mismo
      // que usa el navegador del recorrido). La pantalla escribe el bruto y la cantidad de cobros de cada uno.
      const resumen = (await api.keilor.exigir('GET', `${base()}/summary?tz=360`)).data;
      const periodos = [['today', txt('Hoy')], ['week', txt('7 días')], ['month', txt('Este mes')]];
      for (const [id, nombre] of periodos) {
        const delServidor = resumen.periods.find((p) => p.period === id);
        c.exigir(delServidor, `el resumen del servidor no trae el periodo "${id}"`);
        const fila = delServidor.currencies.find((m) => m.currency === 'CRC') ?? { gross: 0, count: 0 };
        // Con un solo cobro dice "1 cobro", con varios "N cobros" (nunca "1 cobros").
        const cuenta = (fila.count === 1 ? txt('{n} cobro') : txt('{n} cobros')).replace('{n}', fila.count.toLocaleString('en-US'));
        const grupo = keilor.page.getByRole('group', { name: nombre, exact: true });
        const aparece = await grupo.getByText(new RegExp(`^${escapar(cuenta)}$`)).first().waitFor({ state: 'visible', timeout: 10000 }).then(() => true, () => false);
        if (!aparece) {
          const hallado = await grupo.innerText().catch(() => null);
          c.ok(false, `"${nombre}" dice ${JSON.stringify(hallado)}: el servidor cuenta ${fila.count} cobro(s) y debería decir "${cuenta}"`);
          continue;
        }
        const bruto = await grupo.getByText(reColones(fila.gross / 100)).first().waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false);
        c.ok(bruto, `"${nombre}" no muestra el bruto ₡${fila.gross / 100} que cuenta el servidor`);
      }
      const mal = await keilor.page.getByText(/(^|\D)1 cobros/).count();
      c.ok(mal === 0, 'la pantalla escribe "1 cobros" en plural');
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

    await f.paso('Movimientos: la venta sale bajo su día con el bruto en la fila, y su detalle trae la comisión y el neto que guarda el servidor', async (c) => {
      const venta = ventas[0];
      c.ok(venta.fee < venta.amount, `comisión inesperada: ${venta.fee} sobre ${venta.amount}`);
      c.igual(venta.status, 'completed', 'estado de la venta');
      c.exigir(venta.charge_id, 'la venta más reciente no trae el cobro del que salió (charge_id)');
      const neto = venta.amount - venta.fee;

      // Lo que guarda el servidor: el libro acredita al comercio el neto y a las comisiones la comisión.
      const lineas = bd.asiento({ llavePrefijo: `qr2:${venta.charge_id}:` });
      const alComercio = lineas.find((l) => l.codigo.startsWith('MERCHANT:') && l.direccion === 'credit');
      const alasComisiones = lineas.find((l) => l.codigo === 'SYSTEM:FEES:CRC' && l.direccion === 'credit');
      c.ok(alComercio && Number(alComercio.monto) === neto, `el libro acredita al comercio ${alComercio?.monto} y el neto de la venta es ${neto}`);
      c.ok(alasComisiones && Number(alasComisiones.monto) === venta.fee, `el libro acredita a las comisiones ${alasComisiones?.monto} y la comisión de la venta es ${venta.fee}`);

      // El dia de la venta y el de hoy, en Costa Rica (la zona del navegador del recorrido y del tz=360 de la API).
      const diaCR = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica' }).format(d);
      const hoy = diaCR(new Date());
      const ayer = diaCR(new Date(Date.now() - 86_400_000));
      const dia = diaCR(new Date(venta.created_at));
      c.exigir(dia >= ayer, `la venta más reciente es del ${dia}, de hace más de dos días: corra antes el flujo "cobro-qr"`);
      const rotulo = dia === hoy ? txt('Hoy') : txt('Ayer');

      await ir(keilor.page, txt('Movimientos'));
      // Por omision la pantalla muestra "7 días". El total de cada día lo cuenta el servidor.
      await boton(keilor.page, txt('7 días'), { exacto: true }).waitFor({ state: 'visible' });
      c.igual(await boton(keilor.page, txt('7 días'), { exacto: true }).getAttribute('aria-pressed'), 'true', 'periodo elegido por omisión');
      const totales = (await api.keilor.exigir('GET', `${base()}/payments/daily?period=week&tz=360`)).data ?? [];
      const delDia = totales.find((t) => t.date === dia && t.currency === 'CRC');
      c.exigir(delDia, `el servidor no trae el total del ${dia} en colones`);

      const seccion = keilor.page.locator('section').filter({ has: keilor.page.getByRole('heading', { name: new RegExp(`^${escapar(rotulo)}\\b`) }) });
      await seccion.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
        c.exigir(false, `la lista no tiene un día rotulado "${rotulo}" (el de la venta, ${dia})`);
      });
      const cuenta = (delDia.count === 1 ? txt('{n} cobro') : txt('{n} cobros')).replace('{n}', delDia.count.toLocaleString('en-US'));
      const totalDelDia = new RegExp(`${reColones(delDia.gross / 100).source}\\s*·\\s*${escapar(cuenta)}(?![a-zA-Z])`);
      await seccion.getByText(totalDelDia).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
        c.ok(false, `el día ${dia} no muestra su total del servidor: ₡${delDia.gross / 100} · ${cuenta}`);
      });

      // La fila: el cobro con el BRUTO y su signo, y el nombre de quien pagó.
      const fila = seccion.locator('[data-testid="movimiento"][data-tipo="cobro"]').first();
      await fila.waitFor({ state: 'visible', timeout: 8000 });
      const textoFila = await fila.innerText();
      c.ok(new RegExp(`\\+${reColones(venta.amount / 100).source}`).test(textoFila), `la fila dice ${JSON.stringify(textoFila)} y debería sumar el bruto +₡${venta.amount / 100}`);
      if (venta.payer_name) c.ok(textoFila.includes(venta.payer_name), `la fila no dice quién pagó (${venta.payer_name}): ${JSON.stringify(textoFila)}`);

      // El detalle: bruto, comisión y neto, como los guarda el servidor.
      await fila.click();
      const hoja = dialogo(keilor.page, txt('Detalle del cobro'));
      await hoja.waitFor({ state: 'visible', timeout: 8000 });
      const valorDe = async (etiqueta) => {
        const dt = hoja.locator('dt').filter({ hasText: new RegExp(`^${escapar(etiqueta)}$`) }).first();
        const hay = await dt.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false);
        return hay ? (await dt.locator('xpath=following-sibling::dd[1]').innerText()).trim() : null;
      };
      const aColones = (colones) => reColones(colones);
      const exigirMonto = async (etiqueta, minor) => {
        const texto = await valorDe(etiqueta);
        c.ok(texto !== null && aColones(minor / 100).test(texto), `el detalle dice ${etiqueta}=${JSON.stringify(texto)} y el servidor guarda ₡${minor / 100}`);
      };
      await exigirMonto(txt('Monto'), venta.amount);
      await exigirMonto(txt('Comisión'), venta.fee);
      await exigirMonto(txt('Neto recibido'), neto);
      if (venta.payer_name) c.igual(await valorDe(txt('Pagador')), venta.payer_name, 'pagador en el detalle');
      c.igual(await valorDe(txt('Referencia')), venta.tx_id || venta.id, 'referencia en el detalle');
      c.igual(await valorDe(txt('Estado')), txt('Completado'), 'estado en el detalle');
      await keilor.page.keyboard.press('Escape');
      await sinDialogos(keilor.page).catch(() => {});

      // El filtro "Hoy" deja solo el dia de hoy, con el mismo total que da el servidor.
      if (dia === hoy) {
        await boton(keilor.page, txt('Hoy'), { exacto: true }).click();
        c.igual(await boton(keilor.page, txt('Hoy'), { exacto: true }).getAttribute('aria-pressed'), 'true', 'periodo "Hoy" elegido');
        await keilor.page.getByRole('heading', { name: /^Hoy\b/ }).first().waitFor({ state: 'visible', timeout: 8000 });
        c.igual(await keilor.page.getByRole('heading', { name: /^Ayer\b/ }).count(), 0, 'días de ayer con el filtro "Hoy"');
        const deHoy = (await api.keilor.exigir('GET', `${base()}/payments/daily?period=today&tz=360`)).data ?? [];
        const crcHoy = deHoy.find((t) => t.date === hoy && t.currency === 'CRC');
        c.exigir(crcHoy, 'el servidor no trae el total de hoy en colones');
        const cuentaHoy = (crcHoy.count === 1 ? txt('{n} cobro') : txt('{n} cobros')).replace('{n}', crcHoy.count.toLocaleString('en-US'));
        await keilor.page.getByText(new RegExp(`${reColones(crcHoy.gross / 100).source}\\s*·\\s*${escapar(cuentaHoy)}(?![a-zA-Z])`)).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {
          c.ok(false, `con el filtro "Hoy" falta el total ₡${crcHoy.gross / 100} · ${cuentaHoy}`);
        });
        await boton(keilor.page, txt('7 días'), { exacto: true }).click();
      }
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
