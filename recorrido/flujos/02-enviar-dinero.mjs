// Enviar dinero entre usuarios: victor le manda a keilor por SINPE (el camino
// interno de KiramoPay a KiramoPay) y keilor lo recibe.
import { llave } from '../lib/entorno.mjs';
import { CUENTAS } from '../lib/entorno.mjs';
import { abrirSesion, ir, boton, ultimoDialogo, sinDialogos, verTexto, cerrarSesion } from '../lib/ui.mjs';
import { clientes, centimos, saldos, ultimoMovimiento, problemasDelLibro } from '../lib/comun.mjs';
import { reColones, txt } from '../lib/textos.mjs';
import * as bd from '../lib/bd.mjs';
import { peticion } from '../lib/api.mjs';

const MONTO = 1500; // colones

export default {
  id: 'enviar-dinero',
  nombre: 'Enviar dinero entre usuarios (victor a keilor)',
  async ejecutar(f, ctx) {
    const api = await clientes('victor', 'keilor');
    const minor = centimos(MONTO);
    const antes = {};
    const reservasAntes = {};
    let victor;

    await f.paso('Saldos y reservas antes del envío', async () => {
      Object.assign(antes, await saldos(api.victor, api.keilor));
      const r = await peticion('GET', '/transparency/proof-of-reserves');
      for (const m of r.data.currencies) reservasAntes[m.currency] = m;
    });

    await f.paso('Victor abre la pestaña SINPE y la hoja "Enviar a nuevo número"', async () => {
      victor = await abrirSesion(f, 'victor');
      await ir(victor.page, txt('SINPE'));
      await boton(victor.page, txt('Enviar a nuevo número')).click();
      await ultimoDialogo(victor.page).waitFor({ state: 'visible' });
    });

    await f.paso(`Victor escribe el teléfono de keilor y ₡${MONTO}, y confirma`, async () => {
      const hoja = ultimoDialogo(victor.page);
      await hoja.getByPlaceholder('8888-0000').fill(CUENTAS.keilor.telefono);
      await hoja.getByPlaceholder('0', { exact: true }).fill(String(MONTO));
      await hoja.getByPlaceholder(txt('Ej: Almuerzo, pago deuda...')).fill('Recorrido');
      await boton(hoja, new RegExp(`^${txt('Enviar')}\\s*₡`)).click();
      // Hoja "Confirmar": revisar a quien le llega antes de mover plata.
      const confirmar = ultimoDialogo(victor.page);
      await confirmar.getByText(/\+506\s?8888-0001/).waitFor({ state: 'visible' });
      await boton(confirmar, txt('Enviar'), { exacto: true }).click();
    });

    await f.paso('La pantalla dice "¡Enviado!" con el nombre de keilor', async () => {
      await verTexto(victor.page, txt('¡Enviado!'));
      await verTexto(victor.page, CUENTAS.keilor.nombre);
    });

    await f.paso('Victor cierra la hoja de resultado', async () => {
      await boton(ultimoDialogo(victor.page), txt('Cerrar')).first().click();
      await sinDialogos(victor.page);
    });

    await f.paso('Saldos: victor baja y keilor sube exactamente lo enviado', async (c) => {
      const despues = await saldos(api.victor, api.keilor);
      c.igual(despues.victor.crc, antes.victor.crc - minor, 'saldo CRC de victor');
      c.igual(despues.keilor.crc, antes.keilor.crc + minor, 'saldo CRC de keilor');
      c.igual(despues.victor.usd, antes.victor.usd, 'saldo USD de victor (no debe moverse)');
      c.igual(despues.keilor.usd, antes.keilor.usd, 'saldo USD de keilor (no debe moverse)');
    });

    await f.paso('Movimientos: sinpe_send de victor y sinpe_receive de keilor', async (c) => {
      const envio = await ultimoMovimiento(api.victor, 'sinpe_send');
      const recibo = await ultimoMovimiento(api.keilor, 'sinpe_receive');
      c.exigir(envio, 'victor no tiene ningún movimiento sinpe_send');
      c.exigir(recibo, 'keilor no tiene ningún movimiento sinpe_receive');
      c.igual(envio.amount, minor, 'monto del movimiento de victor');
      c.igual(envio.status, 'completed', 'estado del movimiento de victor');
      c.igual(envio.counterparty_phone, '+50688880001', 'teléfono de la contraparte de victor');
      c.igual(recibo.amount, minor, 'monto del movimiento de keilor');
      c.igual(recibo.status, 'completed', 'estado del movimiento de keilor');
      c.igual(recibo.counterparty_name, CUENTAS.victor.nombre, 'nombre de la contraparte de keilor');
      ctx.estado.sinpeTxId = envio.id;
    });

    await f.paso('Historial SINPE de los dos lados', async (c) => {
      const h1 = (await api.victor.exigir('GET', '/sinpe/history')).data;
      const h2 = (await api.keilor.exigir('GET', '/sinpe/history')).data;
      const enviado = h1.find((h) => h.type === 'sent' && h.amount === minor);
      const recibido = h2.find((h) => h.type === 'received' && h.amount === minor);
      c.ok(!!enviado, 'victor no ve el envío en su historial SINPE');
      c.ok(!!recibido, 'keilor no ve el recibo en su historial SINPE');
      if (recibido) c.igual(recibido.contact_name, CUENTAS.victor.nombre, 'nombre del remitente en el historial de keilor');
    });

    await f.paso('Libro: un asiento balanceado, de la cuenta de victor a la de keilor', async (c) => {
      const lineas = bd.asiento({ tx: ctx.estado.sinpeTxId });
      c.ok(lineas.length === 2, `se esperaban 2 líneas en el asiento y hay ${lineas.length}`);
      const deb = bd.lineaDe(lineas, bd.cuentaUsuario(CUENTAS.victor.id, 'CRC'), 'debit');
      const cre = bd.lineaDe(lineas, bd.cuentaUsuario(CUENTAS.keilor.id, 'CRC'), 'credit');
      c.ok(deb && Number(deb.monto) === minor, `falta el débito de ${minor} a la cuenta de victor`);
      c.ok(cre && Number(cre.monto) === minor, `falta el crédito de ${minor} a la cuenta de keilor`);
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('La prueba de reservas no cambia (el envío entre personas es suma cero)', async (c) => {
      const r = await peticion('GET', '/transparency/proof-of-reserves');
      for (const m of r.data.currencies) {
        const antesM = reservasAntes[m.currency];
        c.igual(m.user_liabilities_minor, antesM.user_liabilities_minor, `pasivo ${m.currency}`);
        c.igual(m.reserve_balance_minor, antesM.reserve_balance_minor, `reserva ${m.currency}`);
      }
    });

    await f.paso('Keilor entra y ve el dinero recibido en su inicio', async () => {
      const keilor = await abrirSesion(f, 'keilor');
      const s = await api.keilor.saldo();
      await keilor.page.getByText(reColones(s.crc / 100)).first().waitFor({ state: 'visible', timeout: 15000 });
      await cerrarSesion(keilor);
    });

    await f.paso('Rechazos del servidor: llave repetida, a uno mismo, número sin cuenta y monto con segundo factor', async (c) => {
      // Misma llave y misma petición: no mueve plata otra vez.
      const k = llave('sinpe');
      const cuerpo = { phone: '+50688880001', amount: 100, description: 'repetida', idempotency_key: k };
      const antesRepeticion = (await api.victor.saldo()).crc;
      const r1 = await api.victor.post('/sinpe/send', cuerpo);
      c.respuesta(r1, 200, 'primer envío de ₡1');
      const r2 = await api.victor.post('/sinpe/send', cuerpo);
      c.respuesta(r2, 200, 'repetición con la misma llave');
      c.igual(r2.data?.replayed, true, 'la repetición debe marcarse replayed');
      c.igual(r2.data?.transaction_id, r1.data?.transaction_id, 'la repetición devuelve el mismo movimiento');
      c.igual((await api.victor.saldo()).crc, antesRepeticion - 100, 'victor pagó UNA sola vez');
      // Misma llave con otro monto.
      const r3 = await api.victor.post('/sinpe/send', { ...cuerpo, amount: 200 });
      c.respuesta(r3, 409, 'misma llave con otro monto', 'LLAVE_REUTILIZADA');
      // A uno mismo.
      const r4 = await api.victor.post('/sinpe/send', { phone: '+50688880004', amount: 100, idempotency_key: llave('sinpe') });
      c.respuesta(r4, 400, 'envío a uno mismo', 'SELF_SEND');
      // Número sin cuenta de KiramoPay.
      const r5 = await api.victor.post('/sinpe/send', { phone: '+50688889999', amount: 100, idempotency_key: llave('sinpe') });
      c.respuesta(r5, 400, 'envío a un número sin cuenta', 'RECIPIENT_NOT_USER');
      // Desde ₡100.000 se exige segundo factor y no se mueve nada.
      const antesMfa = (await api.victor.saldo()).crc;
      const r6 = await api.victor.post('/sinpe/send', { phone: '+50688880001', amount: 10000000, idempotency_key: llave('sinpe') });
      c.respuesta(r6, 428, 'envío de ₡100.000 sin segundo factor', 'MFA_REQUIRED');
      c.igual((await api.victor.saldo()).crc, antesMfa, 'el rechazo por segundo factor no debe mover plata');
      // Monto cero o negativo.
      const r7 = await api.victor.post('/sinpe/send', { phone: '+50688880001', amount: 0, idempotency_key: llave('sinpe') });
      c.respuesta(r7, 400, 'envío de monto cero', 'VALIDATION_ERROR');
    });
  },
};
