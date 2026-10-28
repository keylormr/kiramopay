// Estado de partida: el servidor sano, las cuentas de la semilla, la entrada sin
// contraseña (por API y por la pantalla) y un libro que cuadra antes de mover
// un solo colon.
import { peticion, entrar } from '../lib/api.mjs';
import { API_BASE, CUENTAS } from '../lib/entorno.mjs';
import { abrirSesion } from '../lib/ui.mjs';
import { problemasDelLibro } from '../lib/comun.mjs';
import { reColones } from '../lib/textos.mjs';

export default {
  id: 'preparacion',
  nombre: 'Preparación: servidor, semilla, entrada sin contraseña y libro',
  async ejecutar(f, ctx) {
    await f.paso('El servidor responde y la base y Redis están sanos', async (c) => {
      const res = await fetch(`${API_BASE}/health`);
      const cuerpo = await res.json();
      c.igual(res.status, 200, 'GET /health');
      c.igual(cuerpo.services?.database, 'ok', 'base de datos en /health');
      c.igual(cuerpo.services?.redis, 'ok', 'Redis en /health');
      ctx.estado.salud = cuerpo;
      console.log(`      /health: ${JSON.stringify(cuerpo).slice(0, 400)}`);
    });

    await f.paso('Entrada sin contraseña por la API: keilor, victor y emmanuel', async (c) => {
      for (const u of ['keilor', 'victor', 'emmanuel']) {
        const api = await entrar(u);
        c.igual(api.id, CUENTAS[u].id, `id de ${u}`);
        c.igual(api.perfil.kyc_level, 1, `nivel KYC de ${u}`);
      }
      const keilor = await entrar('keilor');
      c.igual(keilor.perfil.role, 'admin', 'rol de keilor');
    });

    await f.paso('Una cuenta que no es de demostración sigue pidiendo contraseña', async (c) => {
      // admin.kp no tiene demo_login: sin contraseña debe responder PASSWORD_REQUIRED.
      const r = await peticion('POST', '/auth/login', { cuerpo: { identifier: 'admin.kp', password: '' } });
      c.respuesta(r, 401, 'login sin contraseña de admin.kp', 'PASSWORD_REQUIRED');
    });

    await f.paso('Saldos iniciales de la semilla', async (c) => {
      for (const u of ['keilor', 'victor', 'emmanuel']) {
        const api = await entrar(u);
        const s = await api.saldo();
        c.igual(s.crc, CUENTAS[u].crc, `saldo CRC de ${u}`);
        c.igual(s.usd, CUENTAS[u].usd, `saldo USD de ${u}`);
      }
    });

    await f.paso('El libro cuadra antes de empezar', async (c) => {
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('Entrada sin contraseña por la pantalla (victor)', async (c) => {
      const v = await abrirSesion(f, 'victor');
      // Con la sesion abierta el inicio muestra el saldo que dice la API.
      const s = await v.api.saldo();
      await v.page.getByText(reColones(s.crc / 100)).first().waitFor({ state: 'visible', timeout: 15000 });
      c.ok(true, '');
    });
  },
};
