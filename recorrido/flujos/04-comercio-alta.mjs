// Alta del comercio de keilor: lo registra desde la pantalla y lo aprueba OTRO
// administrador (admin.kp, por API con su contraseña de semilla): el servidor no
// deja que un administrador apruebe un comercio propio (ADMIN_IS_AFFECTED_PARTY).
// Este comercio lo usan despues el cobro con QR y el modo negocio.
import { abrirSesion, boton, ultimoDialogo, dialogo, sinDialogos, verTexto, reposar, cambiarAPerfil } from '../lib/ui.mjs';
import { clientes, nombreUnico, adminKp } from '../lib/comun.mjs';
import { txt, escapar } from '../lib/textos.mjs';

/** Registra un comercio desde la hoja "Crear negocio" (tres pasos). */
export async function registrarPorLaPantalla(sesion, nombre) {
  const p = sesion.page;
  await boton(p, txt('Cambiar de perfil'), { exacto: true }).first().click();
  await boton(ultimoDialogo(p), new RegExp(escapar(txt('Crear negocio')))).click();
  const hoja = dialogo(p, txt('Crear negocio'));
  await hoja.waitFor({ state: 'visible' });
  // Paso 1: persona fisica (la opcion por defecto).
  await boton(hoja, txt('Siguiente'), { exacto: true }).click();
  // Paso 2: nombre, categoria (restaurante por defecto) y descripcion.
  await hoja.getByRole('textbox').nth(0).fill(nombre);
  await hoja.getByRole('textbox').nth(1).fill('Comercio de la prueba de recorrido');
  await boton(hoja, txt('Siguiente'), { exacto: true }).click();
  // Paso 3: cedula (menos de 9 digitos: no sale a consultar el registro publico)
  // y razon social.
  await hoja.getByRole('textbox').nth(0).fill('3101123');
  await hoja.getByRole('textbox').nth(1).fill(`${nombre} SA`);
  await hoja.getByLabel(txt('Acepto los términos y condiciones del comercio')).check();
  await boton(hoja, txt('Registrar'), { exacto: true }).click();
  await sinDialogos(p, 15000);
  await reposar(p);
}

/** Cambia a Personal y vuelve al negocio: es lo que recarga su estado en la pantalla. */
export async function refrescarPerfilDeNegocio(sesion, nombre) {
  const p = sesion.page;
  await boton(p, txt('Cambiar de perfil'), { exacto: true }).first().click();
  await boton(ultimoDialogo(p), /^Personal/).click();
  await sinDialogos(p);
  await boton(p, txt('Cambiar de perfil'), { exacto: true }).first().click();
  await boton(ultimoDialogo(p), new RegExp(escapar(nombre))).click();
  await sinDialogos(p);
  await reposar(p);
}

export default {
  id: 'comercio-alta',
  nombre: 'Alta y aprobación del comercio de keilor',
  async ejecutar(f, ctx) {
    const api = await clientes('keilor');
    const nombre = nombreUnico('Soda Keilor');
    let keilor;
    let comercio;

    await f.paso('Keilor registra su comercio desde "Cambiar de perfil" > "Crear negocio"', async () => {
      keilor = await abrirSesion(f, 'keilor');
      await registrarPorLaPantalla(keilor, nombre);
    });

    await f.paso('Al terminar el registro, la pantalla deja a keilor dentro del negocio nuevo', async () => {
      // Defecto conocido: App.tsx fija el negocio activo apenas se crea, pero la lista de
      // comercios todavia no lo trae y la "autocuracion" lo toma por un negocio que ya no
      // existe: lo saca de vuelta al perfil personal sin decir nada.
      const dentro = await keilor.page.getByText(txt('Pendiente de verificación')).first()
        .waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false);
      if (!dentro) {
        throw new Error('tras registrar el comercio la pantalla volvió al perfil personal en lugar de mostrar el negocio nuevo como "Pendiente de verificación"');
      }
    }, { seguir: true });

    await f.paso('El comercio queda "pendiente de verificación" y no deja cobrar todavía', async (c) => {
      const lista = (await api.keilor.exigir('GET', '/qr/merchants')).data ?? [];
      comercio = lista.find((x) => x.name === nombre);
      c.exigir(comercio, `el comercio "${nombre}" no aparece en GET /qr/merchants`);
      c.igual(comercio.verification_status, 'pending', 'estado de verificación');
      c.igual(comercio.role, 'owner', 'rol de keilor en el comercio');
      c.igual(comercio.commission_bps, 50, 'comisión base en puntos básicos');
      c.igual(comercio.plan, 'base', 'plan del comercio');
      ctx.estado.comercio = { id: comercio.id, nombre };
      // Se entra al negocio a mano desde el selector de perfil (por el defecto de arriba
      // la pantalla pudo haber quedado en el perfil personal).
      const enNegocio = await keilor.page.getByText(txt('Pendiente de verificación')).first().isVisible().catch(() => false);
      if (!enNegocio) await cambiarAPerfil(keilor.page, nombre);
      await verTexto(keilor.page, txt('Pendiente de verificación'));
      const generar = boton(keilor.page, txt('Generar QR de cobro'), { exacto: true }).first();
      c.ok(await generar.isDisabled(), 'el botón "Generar QR de cobro" debería estar deshabilitado mientras está pendiente');
      // El servidor tampoco entrega rotulo: el comercio no esta verificado.
      const rotulo = await api.keilor.get(`/qr/merchants/${comercio.id}/code?currency=CRC`);
      c.respuesta(rotulo, 409, 'rótulo de un comercio pendiente', 'MERCHANT_UNAVAILABLE');
    });

    await f.paso('Keilor no puede aprobar su propio comercio (regla del servidor)', async (c) => {
      const r = await api.keilor.post(`/admin/merchants/${comercio.id}/approve`, {});
      c.respuesta(r, 403, 'aprobar un comercio propio', 'ADMIN_IS_AFFECTED_PARTY');
    });

    await f.paso('Otro administrador (admin.kp) lo aprueba', async (c) => {
      const admin = await adminKp();
      const r = await admin.post(`/admin/merchants/${comercio.id}/approve`, {});
      c.exigirRespuesta(r, 200, 'aprobación por admin.kp');
      c.igual(r.data.verification_status, 'verified', 'estado tras aprobar');
      c.ok(!!r.data.promo_hasta, 'la primera aprobación debe fijar promo_hasta (promoción de entrada)');
      c.igual(r.data.comision_efectiva_bps, 25, 'comisión efectiva durante la promoción');
      ctx.estado.comercio.aprobado = true;
    });

    await f.paso('Keilor refresca su perfil de negocio y ya puede generar cobros', async () => {
      await refrescarPerfilDeNegocio(keilor, nombre);
      // Verificado, el inicio del negocio ya no muestra la tarjeta de estado pendiente.
      await verTexto(keilor.page, txt('Saldo del negocio'));
      const pendiente = await keilor.page.getByText(txt('Pendiente de verificación')).count();
      if (pendiente) throw new Error('el inicio del negocio sigue mostrando "Pendiente de verificación" tras la aprobación');
      const generar = boton(keilor.page, txt('Generar QR de cobro'), { exacto: true }).first();
      await generar.waitFor({ state: 'visible', timeout: 15000 });
      if (await generar.isDisabled()) throw new Error('"Generar QR de cobro" sigue deshabilitado tras la aprobación');
    });
  },
};
