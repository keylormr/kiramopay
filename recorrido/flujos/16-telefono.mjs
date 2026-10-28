// Segunda pasada: las pantallas principales en un telefono (390x844, con tacto).
// En cada una se comprueba por codigo que no haya desplazamiento horizontal ni
// controles fuera de la pantalla; si algo falla el paso queda en rojo con la
// lista de problemas. Las capturas van a la carpeta "capturas-telefono".
import { abrirSesion, ir, boton, ultimoDialogo, verTexto, reposar, cambiarAPerfil, revisarTelefono } from '../lib/ui.mjs';
import { asegurarComercio } from '../lib/comun.mjs';
import { txt, escapar } from '../lib/textos.mjs';

/** Deja la pantalla en el Inicio: cierra hojas y pantallas completas que hayan quedado abiertas. */
async function aInicio(p) {
  for (let i = 0; i < 6; i++) {
    if (await p.getByRole('dialog').count()) {
      await p.keyboard.press('Escape');
      await p.waitForTimeout(450);
      continue;
    }
    const atras = p.getByRole('button', { name: txt('Volver'), exact: true }).first();
    if (await atras.isVisible().catch(() => false)) {
      await atras.click();
      await p.waitForTimeout(500);
      continue;
    }
    break;
  }
  await ir(p, txt('Inicio'));
}

/** Falla si la pantalla actual se desborda en el telefono. */
async function sinDesborde(p, donde = '') {
  await reposar(p, 600);
  const problemas = await revisarTelefono(p);
  if (problemas.length) throw new Error(`${donde ? `${donde}: ` : ''}${problemas.join(' | ')}`);
}

async function abrirDePerfil(p, fila) {
  await ir(p, txt('Perfil'));
  await boton(p, new RegExp(escapar(fila))).first().click();
  await reposar(p);
}

async function abrirAdmin(p, fila) {
  await aInicio(p);
  await ir(p, txt('Perfil'));
  await verTexto(p, txt('Administración'));
  await boton(p, new RegExp(escapar(fila))).first().click();
  await reposar(p);
}

export default {
  id: 'telefono',
  nombre: 'Pantallas principales en un teléfono (390x844)',
  telefono: true,
  async ejecutar(f, ctx) {
    let comercio;
    let k;
    const paso = (nombre, fn) => f.paso(nombre, fn, { seguir: true });

    await f.paso('Keilor entra desde un teléfono y prepara el comercio', async () => {
      comercio = await asegurarComercio(ctx);
      k = await abrirSesion(f, 'keilor', { movil: true });
    });
    if (!k) return;
    const p = k.page;

    await paso('Inicio', async () => {
      await aInicio(p);
      await sinDesborde(p);
    });

    await paso('Hoja de Enviar (acción rápida del inicio)', async () => {
      await aInicio(p);
      await boton(p, txt('Enviar'), { exacto: true }).first().click();
      await reposar(p, 800);
      await sinDesborde(p);
    });

    await paso('Cobrar con QR (acción rápida del inicio)', async () => {
      await aInicio(p);
      await boton(p, txt('Cobrar con QR'), { exacto: true }).first().click();
      await reposar(p, 800);
      await sinDesborde(p);
    });

    await paso('Hoja de Enviar a un número nuevo (SINPE)', async () => {
      await aInicio(p);
      await ir(p, txt('SINPE'));
      await boton(p, txt('Enviar a nuevo número')).click();
      await ultimoDialogo(p).waitFor({ state: 'visible' });
      await sinDesborde(p);
    });

    await paso('Cripto: hoja de comprar', async () => {
      await aInicio(p);
      await ir(p, txt('Crypto'));
      await boton(p, txt('Comprar'), { exacto: true }).first().click();
      await ultimoDialogo(p).waitFor({ state: 'visible' });
      await sinDesborde(p);
    });

    await paso('Servicios', async () => {
      await aInicio(p);
      await ir(p, txt('Servicios'));
      await sinDesborde(p, 'lista de servicios');
      await p.getByRole('tab', { name: txt('Recarga'), exact: true }).click();
      await sinDesborde(p, 'pestaña Recarga');
    });

    await paso('Perfil', async () => {
      await aInicio(p);
      await ir(p, txt('Perfil'));
      await sinDesborde(p);
    });

    await paso('Dividir cuenta', async () => {
      await aInicio(p);
      await boton(p, /Dividir cuenta/).first().click();
      await p.getByText(txt('Dividir cuenta'), { exact: true }).first().waitFor({ state: 'visible' });
      await sinDesborde(p, 'lista');
      await boton(p, txt('Crear división'), { exacto: true }).first().click();
      await ultimoDialogo(p).waitFor({ state: 'visible' });
      await sinDesborde(p, 'hoja de crear división');
    });

    await paso('Pagos protegidos', async () => {
      await aInicio(p);
      await abrirDePerfil(p, txt('Pagos protegidos'));
      await verTexto(p, txt('El dinero se retiene de forma segura hasta que ambas partes cumplan'));
      await sinDesborde(p, 'lista');
      await boton(p, txt('Nuevo acuerdo'), { exacto: true }).first().click();
      await ultimoDialogo(p).waitFor({ state: 'visible' });
      await sinDesborde(p, 'hoja de nuevo acuerdo');
    });

    await paso('Modo negocio: inicio', async () => {
      await aInicio(p);
      await cambiarAPerfil(p, comercio.nombre);
      await verTexto(p, txt('Saldo del negocio'));
      await sinDesborde(p);
    });

    await paso('Modo negocio: hoja "Generar QR de cobro"', async () => {
      await boton(p, txt('Generar QR de cobro'), { exacto: true }).first().click();
      await ultimoDialogo(p).waitFor({ state: 'visible' });
      await sinDesborde(p);
    });

    await paso('Modo negocio: reportes', async () => {
      await aInicio(p);
      await ir(p, txt('Reportes'));
      await sinDesborde(p, '7 días');
      await boton(p, '90 días', { exacto: true }).click();
      await sinDesborde(p, '90 días');
    });

    await paso('Modo negocio: movimientos y ajustes', async () => {
      await ir(p, txt('Movimientos'));
      await sinDesborde(p, 'movimientos');
      await ir(p, txt('Ajustes'));
      await sinDesborde(p, 'ajustes');
    });

    await paso('Administración: verificar comercios (pendientes, todos y plan)', async () => {
      await aInicio(p);
      await cambiarAPerfil(p, 'Personal');
      await abrirAdmin(p, txt('Verificar comercios'));
      await sinDesborde(p, 'pendientes');
      await p.getByRole('tab', { name: txt('Todos'), exact: true }).click();
      await sinDesborde(p, 'todos');
      await p.getByRole('tab', { name: txt('Plan de un comercio'), exact: true }).click();
      await sinDesborde(p, 'plan de un comercio');
    });

    await paso('Administración: usuarios', async () => {
      await abrirAdmin(p, txt('Usuarios'));
      await sinDesborde(p, 'buscar');
      await p.getByPlaceholder(txt('Cédula, correo, teléfono o nombre')).fill('Demo KiramoPay');
      await p.getByRole('button', { name: txt('Buscar'), exact: true }).click();
      await p.locator('article').first().waitFor({ state: 'visible', timeout: 15000 });
      await sinDesborde(p, 'resultado de la búsqueda');
    });

    await paso('Administración: disputas', async () => {
      await abrirAdmin(p, txt('Disputas de escrow'));
      await sinDesborde(p);
    });

    await paso('Administración: fondo de promociones', async () => {
      await abrirAdmin(p, txt('Fondo de promociones'));
      await sinDesborde(p);
    });
  },
};
