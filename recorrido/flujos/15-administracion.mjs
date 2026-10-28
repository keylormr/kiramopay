// Panel de administracion de keilor: verificar comercios (aprobar, rechazar,
// cerrar, plan), usuarios (bloquear y desbloquear), disputas de escrow y fondo
// de promociones. Un usuario normal no debe ver ni alcanzar nada de esto.
import { CUENTAS, CORRIDA } from '../lib/entorno.mjs';
import { abrirSesion, ir, boton, ultimoDialogo, sinDialogos, verTexto, volver, reposar } from '../lib/ui.mjs';
import { clientes, centimos } from '../lib/comun.mjs';
import { peticion, esperarHasta } from '../lib/api.mjs';
import { txt, escapar } from '../lib/textos.mjs';

async function abrirPanel(sesion, fila) {
  const p = sesion.page;
  // Los paneles son pantallas completas: si hay uno abierto, se sale con "Volver".
  const abierto = await p.getByRole('button', { name: txt('Volver'), exact: true }).first().isVisible().catch(() => false);
  if (abierto) await volver(p);
  await ir(p, txt('Perfil'));
  await verTexto(p, txt('Administración'));
  await boton(p, new RegExp(escapar(fila))).first().click();
  await reposar(p);
}

const tarjetaDe = (p, nombre, accion) =>
  p.getByText(nombre).first().locator(`xpath=ancestor::*[.//button[normalize-space()="${accion}"]][1]`);

async function registrarComercio(api, nombre) {
  const r = await api.exigir('POST', '/qr/merchant', {
    name: nombre,
    description: 'Comercio de la prueba de administración',
    category: 'restaurant',
    cedula: '3101123',
    cedula_type: 'juridica',
    legal_name: `${nombre} SA`,
  });
  return r.data;
}

export default {
  id: 'administracion',
  nombre: 'Administración (comercios, usuarios, disputas)',
  async ejecutar(f, ctx) {
    const api = await clientes('keilor', 'victor', 'emmanuel');
    const aprobado = `Pulpería Aprobada ${CORRIDA}`;
    const rechazado = `Pulpería Rechazada ${CORRIDA}`;
    let keilor;
    let comercios = {};

    await f.paso('Un usuario normal no ve el panel de administración ni puede llamar a sus rutas', async (c) => {
      const victor = await abrirSesion(f, 'victor');
      await ir(victor.page, txt('Perfil'));
      await reposar(victor.page, 1500);
      c.igual(await victor.page.getByText(txt('Administración'), { exact: true }).count(), 0, 'veces que victor ve la sección "Administración"');
      c.respuesta(await api.victor.get('/admin/merchants/pending'), 403, 'victor lista comercios pendientes', 'FORBIDDEN');
      c.respuesta(await api.victor.post('/admin/users/search', { q: 'Keilor', limit: 5 }), 403, 'victor busca usuarios', 'FORBIDDEN');
      c.respuesta(await api.victor.get('/admin/promociones'), 403, 'victor mira el fondo de promociones', 'FORBIDDEN');
      c.respuesta(await api.victor.get('/admin/escrow?status=disputed'), 403, 'victor mira las disputas', 'FORBIDDEN');
      await victor.ctx.close();
    });

    await f.paso('Emmanuel registra dos comercios (quedan pendientes) y keilor entra a "Verificar comercios"', async (c) => {
      comercios.aprobado = await registrarComercio(api.emmanuel, aprobado);
      comercios.rechazado = await registrarComercio(api.emmanuel, rechazado);
      c.igual(comercios.aprobado.verification_status, 'pending', 'estado del primer comercio');
      c.igual(comercios.rechazado.verification_status, 'pending', 'estado del segundo comercio');
      keilor = await abrirSesion(f, 'keilor');
      await abrirPanel(keilor, txt('Verificar comercios'));
      await verTexto(keilor.page, txt('Comercios pendientes de revisión'));
      await verTexto(keilor.page, aprobado);
      await verTexto(keilor.page, rechazado);
    });

    await f.paso('Keilor aprueba el primero: sale de la lista y el comercio queda verificado con la promoción de entrada', async (c) => {
      const tarjeta = tarjetaDe(keilor.page, aprobado, 'Aprobar');
      await tarjeta.waitFor({ state: 'visible' });
      await boton(tarjeta, 'Aprobar', { exacto: true }).click();
      await keilor.page.getByText(aprobado).first().waitFor({ state: 'detached', timeout: 15000 });
      const lista = (await api.emmanuel.exigir('GET', '/qr/merchants')).data ?? [];
      const m = lista.find((x) => x.id === comercios.aprobado.id);
      c.exigir(m, 'el comercio aprobado no aparece en la lista de emmanuel');
      c.igual(m.verification_status, 'verified', 'estado tras aprobar');
      c.ok(!!m.promo_hasta, 'la primera aprobación debe fijar promo_hasta');
      c.igual(m.commission_bps, 50, 'comisión base');
    });

    await f.paso('Keilor rechaza el segundo con un motivo y el dueño lo ve rechazado', async (c) => {
      const tarjeta = tarjetaDe(keilor.page, rechazado, 'Rechazar');
      await tarjeta.waitFor({ state: 'visible' });
      await boton(tarjeta, 'Rechazar', { exacto: true }).click();
      const hoja = ultimoDialogo(keilor.page);
      await hoja.getByRole('textbox').first().fill('No cumple los requisitos de la prueba');
      await boton(hoja, 'Rechazar', { exacto: true }).click();
      await sinDialogos(keilor.page, 15000);
      await keilor.page.getByText(rechazado).first().waitFor({ state: 'detached', timeout: 15000 });
      const lista = (await api.emmanuel.exigir('GET', '/qr/merchants')).data ?? [];
      const m = lista.find((x) => x.id === comercios.rechazado.id);
      c.igual(m?.verification_status, 'rejected', 'estado tras rechazar');
      c.igual(m?.rejection_reason, 'No cumple los requisitos de la prueba', 'motivo del rechazo');
    });

    await f.paso('Pestaña "Todos": busca el comercio aprobado y lo cierra con un motivo', async (c) => {
      await keilor.page.getByRole('tab', { name: txt('Todos'), exact: true }).click();
      await keilor.page.locator('#admin-comercio-busqueda').fill(aprobado);
      await boton(keilor.page, txt('Buscar'), { exacto: true }).click();
      const fila = keilor.page.locator(`li[data-comercio="${comercios.aprobado.id}"]`);
      await fila.waitFor({ state: 'visible', timeout: 15000 });
      await boton(fila, 'Cerrar', { exacto: true }).click();
      await keilor.page.locator('#admin-cierre-motivo').fill('Cierre de la prueba de recorrido');
      await boton(ultimoDialogo(keilor.page), `Cerrar ${aprobado}`, { exacto: true }).click();
      await sinDialogos(keilor.page, 15000);
      await verTexto(keilor.page, /Motivo:\s*Cierre de la prueba/);
      const todos = (await api.keilor.exigir('GET', `/admin/merchants?q=${encodeURIComponent(aprobado)}`)).data ?? [];
      const m = todos.find((x) => x.id === comercios.aprobado.id);
      c.ok(!!m?.closed_at, 'el comercio debería tener closed_at tras cerrarlo');
      c.igual(m?.closure_reason, 'Cierre de la prueba de recorrido', 'motivo del cierre');
      c.respuesta(await api.keilor.post(`/admin/merchants/${comercios.aprobado.id}/approve`, {}), 409, 'aprobar un comercio cerrado', 'MERCHANT_CLOSED');
    });

    await f.paso('Pestaña "Plan de un comercio": asigna el plan Analítica al comercio rechazado', async (c) => {
      await keilor.page.getByRole('tab', { name: txt('Plan de un comercio'), exact: true }).click();
      await keilor.page.locator('#admin-plan-busqueda').fill(rechazado);
      await keilor.page.locator('label').filter({ hasText: rechazado }).first().click();
      await boton(keilor.page, txt('Revisar y asignar'), { exacto: true }).click();
      const hoja = ultimoDialogo(keilor.page);
      await verTexto(keilor.page, new RegExp(escapar(rechazado)));
      await boton(hoja, 'Sí, asignar Analítica', { exacto: true }).click();
      await sinDialogos(keilor.page, 15000);
      await verTexto(keilor.page, /quedó con el plan Anal[ií]tica/);
      const todos = (await api.keilor.exigir('GET', `/admin/merchants?q=${comercios.rechazado.id}`)).data ?? [];
      c.igual(todos.find((x) => x.id === comercios.rechazado.id)?.plan, 'analitica', 'plan tras asignarlo');
    });

    await f.paso('Rechazos del servidor: comercio inexistente, comisión fuera de rango, plan inválido, usuario normal', async (c) => {
      const inexistente = '00000000-0000-4000-8000-000000000000';
      c.ok(!(await api.keilor.post(`/admin/merchants/${inexistente}/approve`, {})).ok, 'aprobar un comercio inexistente no debería salir bien');
      c.respuesta(await api.keilor.patch(`/admin/merchants/${comercios.rechazado.id}/commission`, { commission_bps: 10001 }), 400, 'comisión de 100,01 %', 'SET_COMMISSION_FAILED');
      c.respuesta(await api.keilor.patch(`/admin/merchants/${comercios.rechazado.id}/plan`, { plan: 'platino' }), 400, 'plan desconocido', 'PLAN_INVALID');
      c.respuesta(await api.victor.post(`/admin/merchants/${comercios.rechazado.id}/approve`, {}), 403, 'victor aprueba un comercio', 'FORBIDDEN');
    });

    // ── Usuarios: bloquear y desbloquear una cuenta de la semilla ─────────
    const demo = CUENTAS.demo;
    let fichaDemo;
    try {
      await f.paso('Usuarios: keilor busca a "Demo KiramoPay" y su ficha sale con los datos personales enmascarados', async (c) => {
        fichaDemo = (await api.keilor.exigir('GET', `/admin/users/${demo.id}`)).data;
        c.igual(fichaDemo.status, 'active', 'estado inicial de la cuenta demo');
        c.ok(!String(fichaDemo.phone_masked).includes(demo.telefono), `el teléfono debería ir enmascarado: ${fichaDemo.phone_masked}`);
        await abrirPanel(keilor, txt('Usuarios'));
        await keilor.page.getByPlaceholder(txt('Cédula, correo, teléfono o nombre')).fill(`${fichaDemo.first_name} ${fichaDemo.last_name}`);
        await keilor.page.getByRole('button', { name: txt('Buscar'), exact: true }).click();
        await keilor.page.locator('article').filter({ hasText: fichaDemo.username }).first().waitFor({ state: 'visible', timeout: 15000 });
        const texto = await keilor.page.locator('article').first().innerText();
        c.ok(!texto.includes(demo.telefono), 'la tarjeta muestra el teléfono completo');
      });

      await f.paso('Keilor bloquea la cuenta con un motivo: queda bloqueada y no puede entrar', async (c) => {
        const tarjeta = keilor.page.locator('article').filter({ hasText: fichaDemo.username }).first();
        await boton(tarjeta, txt('Bloquear'), { exacto: true }).click();
        await keilor.page.locator('#admin-users-block-reason').fill('Prueba del recorrido: se desbloquea al terminar');
        await boton(ultimoDialogo(keilor.page), txt('Sí, bloquear'), { exacto: true }).click();
        await sinDialogos(keilor.page, 15000);
        await boton(tarjeta, txt('Desbloquear'), { exacto: true }).waitFor({ state: 'visible', timeout: 15000 });
        const ficha = (await api.keilor.exigir('GET', `/admin/users/${demo.id}`)).data;
        c.igual(ficha.status, 'blocked', 'estado tras bloquear');
        c.ok(String(ficha.blocked_reason).includes('Prueba del recorrido'), `motivo guardado: ${ficha.blocked_reason}`);
        const entrada = await peticion('POST', '/auth/login', { cuerpo: { identifier: 'demo', password: '' } });
        c.ok(!entrada.ok, `la cuenta bloqueada no debería entrar: ${entrada.resumen()}`);
        const auditado = await esperarHasta(async () => {
          const r = await api.keilor.get('/admin/audit?action=user_blocked&limit=20');
          return (r.data?.events ?? []).some((e) => e.resource_id === demo.id);
        }, { intentos: 10, cadaMs: 500, descripcion: 'la auditoría del bloqueo' }).then(() => true, () => false);
        c.ok(auditado, 'falta la auditoría "user_blocked" de la cuenta bloqueada');
        c.respuesta(await api.keilor.post(`/admin/users/${demo.id}/block`, { reason: '' }), 400, 'bloquear sin motivo', 'REASON_REQUIRED');
        c.respuesta(await api.keilor.post(`/admin/users/${CUENTAS.keilor.id}/block`, { reason: 'x' }), 400, 'bloquearse a sí mismo', 'CANNOT_BLOCK_SELF');
      });

      await f.paso('Keilor la desbloquea y la cuenta vuelve a entrar', async (c) => {
        const tarjeta = keilor.page.locator('article').filter({ hasText: fichaDemo.username }).first();
        await boton(tarjeta, txt('Desbloquear'), { exacto: true }).click();
        await boton(ultimoDialogo(keilor.page), txt('Sí, desbloquear'), { exacto: true }).click();
        await sinDialogos(keilor.page, 15000);
        await boton(tarjeta, txt('Bloquear'), { exacto: true }).waitFor({ state: 'visible', timeout: 15000 });
        c.igual((await api.keilor.exigir('GET', `/admin/users/${demo.id}`)).data.status, 'active', 'estado tras desbloquear');
        const entrada = await peticion('POST', '/auth/login', { cuerpo: { identifier: 'demo', password: '' } });
        c.ok(entrada.ok, `la cuenta desbloqueada debería volver a entrar: ${entrada.resumen()}`);
      });
    } finally {
      // Pase lo que pase, la cuenta de la semilla no se queda bloqueada para los otros flujos.
      await api.keilor.post(`/admin/users/${demo.id}/unblock`, {}).catch(() => {});
    }

    // ── Disputas ──────────────────────────────────────────────────────────
    let disputa;
    const descripcion = `Disputa del panel ${CORRIDA}`;
    await f.paso('Disputas: un caso abierto aparece en la cola con comprador, vendedor y motivo', async (c) => {
      const r = await api.victor.post('/escrow', { seller_phone: CUENTAS.emmanuel.telefono, amount_minor: centimos(700), currency: 'CRC', description: descripcion });
      c.exigirRespuesta(r, 201, 'crear el acuerdo');
      disputa = r.data.id;
      c.exigirRespuesta(await api.victor.post(`/escrow/${disputa}/fund`, {}), 200, 'fondear el acuerdo');
      c.exigirRespuesta(await api.emmanuel.post(`/escrow/${disputa}/dispute`, { reason: 'El comprador dice que no llegó' }), 200, 'disputar el acuerdo');
      await abrirPanel(keilor, txt('Disputas de escrow'));
      await verTexto(keilor.page, descripcion);
      await verTexto(keilor.page, new RegExp(`${txt('Comprador')}:`));
      await verTexto(keilor.page, new RegExp(`${txt('Vendedor')}:`));
      await verTexto(keilor.page, new RegExp(`${txt('Motivo')}:`));
      c.igual(await keilor.page.getByText(CUENTAS.victor.telefono).count(), 0, 'veces que el panel muestra el teléfono completo del comprador');
    });

    await f.paso('Al resolverse el caso, la cola queda vacía', async (c) => {
      c.respuesta(await api.keilor.post(`/admin/escrow/${disputa}/resolve`, { outcome: 'refunded' }), 200, 'resolver a favor del comprador');
      await abrirPanel(keilor, txt('Disputas de escrow'));
      await verTexto(keilor.page, txt('No hay disputas abiertas'));
    });

    await f.paso('Fondo de promociones: el panel muestra el saldo igual al del servidor', async (c) => {
      const saldo = (await api.keilor.exigir('GET', '/admin/promociones')).data.saldo_minor;
      await abrirPanel(keilor, txt('Fondo de promociones'));
      await verTexto(keilor.page, txt('Saldo disponible'));
      const esperado = `₡${(saldo / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      await keilor.page.getByText(esperado).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {
        c.ok(false, `el panel no muestra el saldo del servidor (${esperado})`);
      });
    });
  },
};
