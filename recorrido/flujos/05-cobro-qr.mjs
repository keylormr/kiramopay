// Cobro con QR: keilor, como comercio, genera el cobro y victor lo paga. El
// comercio absorbe la comision (0,25 % durante la promocion de entrada): el
// pagador paga exactamente el monto del cobro.
import { CUENTAS, llave } from '../lib/entorno.mjs';
import { abrirSesion, boton, ultimoDialogo, sinDialogos, verTexto, cambiarAPerfil } from '../lib/ui.mjs';
import { clientes, centimos, asegurarComercio, problemasDelLibro } from '../lib/comun.mjs';
import { reColones, txt } from '../lib/textos.mjs';
import * as bd from '../lib/bd.mjs';

const MONTO = 1000; // colones
const COMISION_BPS = 25;

export default {
  id: 'cobro-qr',
  nombre: 'Cobrar con QR (keilor comercio, victor paga)',
  async ejecutar(f, ctx) {
    const api = await clientes('victor', 'keilor', 'emmanuel');
    const minor = centimos(MONTO);
    const comision = Math.floor((minor * COMISION_BPS) / 10000);
    const neto = minor - comision;
    let comercio;
    let keilor;
    let victor;
    let cobro; // { id, qr_data }
    let comprobante = ''; // texto de la hoja "Pago realizado" que ve victor
    const antes = {};

    await f.paso('El comercio de keilor está aprobado (si el flujo de alta no corrió, se prepara por API)', async () => {
      comercio = await asegurarComercio(ctx);
      const bal = await api.keilor.exigir('GET', `/qr/merchants/${comercio.id}/balance?currency=CRC`);
      antes.comercio = bal.data.balance;
      antes.victor = await api.victor.saldo();
      antes.keilor = await api.keilor.saldo();
    });

    await f.paso(`Keilor abre su negocio y genera un cobro de ₡${MONTO}`, async () => {
      keilor = await abrirSesion(f, 'keilor');
      await cambiarAPerfil(keilor.page, comercio.nombre);
      await boton(keilor.page, txt('Generar QR de cobro'), { exacto: true }).first().click();
      const hoja = ultimoDialogo(keilor.page);
      await hoja.getByPlaceholder('0.00').fill(String(MONTO));
      const [resp] = await Promise.all([
        keilor.page.waitForResponse((r) => r.url().endsWith('/api/v1/qr/charges') && r.request().method() === 'POST'),
        boton(hoja, txt('Cobrar este monto'), { exacto: true }).click(),
      ]);
      const cuerpo = await resp.json();
      if (resp.status() !== 201) throw new Error(`POST /qr/charges respondió ${resp.status()}: ${JSON.stringify(cuerpo).slice(0, 200)}`);
      cobro = { id: cuerpo.data.id, qr_data: cuerpo.data.qr_data };
      await verTexto(keilor.page, reColones(MONTO));
    });

    await f.paso('El cobro queda pendiente, por el monto y con un QR de monto fijo', async (c) => {
      const r = await api.keilor.exigir('GET', `/qr/charges/${cobro.id}`);
      c.igual(r.data.status, 'pending', 'estado del cobro');
      c.igual(r.data.amount, minor, 'monto del cobro');
      c.igual(r.data.currency, 'CRC', 'moneda del cobro');
      c.ok(/^KP:merchant_fixed:/.test(cobro.qr_data), `el QR del cobro no es de monto fijo: ${cobro.qr_data}`);
    });

    await f.paso('Victor abre "Escanear QR", pega el código del cobro y ve a quién le paga y cuánto', async () => {
      victor = await abrirSesion(f, 'victor');
      await boton(victor.page, txt('Escanear QR'), { exacto: true }).first().click();
      const hoja = ultimoDialogo(victor.page);
      await hoja.locator('#qr-manual-code').fill(cobro.qr_data);
      await boton(hoja, txt('Continuar'), { exacto: true }).click();
      await verTexto(victor.page, comercio.nombre);
      await verTexto(victor.page, reColones(MONTO));
    });

    await f.paso('Victor paga y la pantalla confirma "Pago realizado"', async () => {
      await boton(ultimoDialogo(victor.page), txt('Pagar'), { exacto: true }).click();
      await victor.page.getByRole('heading', { name: txt('Pago realizado') }).waitFor({ state: 'visible', timeout: 15000 });
      comprobante = await ultimoDialogo(victor.page).innerText();
    });

    await f.paso('El comprobante del pago muestra el monto con el formato de la app', async (c) => {
      // El comprobante escribe "₡1,000.00" como el resto de la app, no "CRC 1000" (codigo de moneda y numero pelado).
      c.ok(reColones(MONTO).test(comprobante), `el comprobante dice ${JSON.stringify(comprobante.replace(/\s+/g, ' ').trim())}: el monto debería verse como ₡${MONTO.toLocaleString('en-US')}.00`);
    }, { seguir: true });

    await f.paso('Saldos: victor paga el monto exacto; el comercio recibe el neto; la billetera de keilor no cambia', async (c) => {
      const v = await api.victor.saldo();
      c.igual(v.crc, antes.victor.crc - minor, 'saldo CRC de victor');
      const k = await api.keilor.saldo();
      c.igual(k.crc, antes.keilor.crc, 'la billetera personal de keilor no debe cambiar hasta que retire');
      const bal = await api.keilor.exigir('GET', `/qr/merchants/${comercio.id}/balance?currency=CRC`);
      c.igual(bal.data.balance - antes.comercio, neto, `saldo del comercio (bruto ${minor} menos comisión ${comision})`);
    });

    await f.paso('El cobro pasa a pagado y queda la venta con su comisión y el movimiento de victor', async (c) => {
      const r = await api.keilor.exigir('GET', `/qr/charges/${cobro.id}`);
      c.igual(r.data.status, 'paid', 'estado del cobro');
      c.igual(r.data.paid_by, api.victor.id, 'quién pagó');
      const ventas = (await api.keilor.exigir('GET', `/qr/merchants/${comercio.id}/payments`)).data ?? [];
      const venta = ventas.find((v) => v.charge_id === cobro.id);
      c.exigir(venta, 'la venta no aparece en los movimientos del comercio');
      c.igual(venta.amount, minor, 'monto bruto de la venta');
      c.igual(venta.fee, comision, 'comisión de la venta');
      c.igual(venta.status, 'completed', 'estado de la venta');
      c.igual(venta.payer_id, api.victor.id, 'pagador de la venta');
      const fila = (await api.victor.movimientos({ type: 'qr_payment', limit: '5' }))[0];
      c.exigir(fila, 'victor no tiene movimiento qr_payment');
      c.igual(fila.amount, minor, 'monto del movimiento de victor');
      c.igual(fila.counterparty_name, comercio.nombre, 'contraparte del movimiento de victor');
      ctx.estado.cobroPagado = { id: cobro.id, qr_data: cobro.qr_data, txId: fila.id };
    });

    await f.paso('Libro: débito a victor, crédito al comercio y a las comisiones, y la comisión pasa de la reserva al capital propio', async (c) => {
      const lineas = bd.asiento({ llavePrefijo: `qr2:${cobro.id}:` });
      c.ok(lineas.length === 5, `se esperaban 5 líneas en el asiento (3 del cobro y 2 que pasan la comisión de la reserva al capital propio) y hay ${lineas.length}: ${JSON.stringify(lineas)}`);
      const alCapital = lineas.find((l) => l.codigo === 'SYSTEM:CAPITAL:CRC' && l.direccion === 'debit');
      const delaReserva = lineas.find((l) => l.codigo === 'SYSTEM:RESERVE:CRC' && l.direccion === 'credit');
      c.ok(alCapital && Number(alCapital.monto) === comision, `falta el débito de ${comision} a SYSTEM:CAPITAL:CRC (la comisión deja de respaldar a los usuarios)`);
      c.ok(delaReserva && Number(delaReserva.monto) === comision, `falta el crédito de ${comision} a SYSTEM:RESERVE:CRC`);
      const deb = lineas.find((l) => l.codigo === bd.cuentaUsuario(CUENTAS.victor.id, 'CRC') && l.direccion === 'debit');
      const cm = lineas.find((l) => l.codigo.startsWith('MERCHANT:') && l.direccion === 'credit');
      const fee = lineas.find((l) => l.codigo === 'SYSTEM:FEES:CRC' && l.direccion === 'credit');
      c.ok(deb && Number(deb.monto) === minor, `falta el débito de ${minor} a victor`);
      c.ok(cm && Number(cm.monto) === neto, `falta el crédito de ${neto} al comercio`);
      c.ok(fee && Number(fee.monto) === comision, `falta el crédito de ${comision} a SYSTEM:FEES:CRC`);
      const problemas = problemasDelLibro();
      c.ok(problemas.length === 0, problemas.join(' | '));
    });

    await f.paso('Keilor ve el cobro "Pagado" en su pantalla y pasa al siguiente cliente', async () => {
      await verTexto(keilor.page, txt('Pagado'), 25000);
      await boton(ultimoDialogo(keilor.page), txt('Siguiente cliente'), { exacto: true }).click();
    });

    await f.paso('Keilor cierra la hoja y el saldo del negocio muestra el neto', async () => {
      await keilor.page.keyboard.press('Escape');
      await sinDialogos(keilor.page).catch(() => {});
      await verTexto(keilor.page, reColones((antes.comercio + neto) / 100));
    });

    await f.paso('Rechazos del servidor: repetir el pago, otro pagador, pagarse a sí mismo y cobro cancelado', async (c) => {
      const antesV = (await api.victor.saldo()).crc;
      // El mismo pagador repite el pago del mismo cobro: no se cobra otra vez.
      const r1 = await api.victor.post('/qr/pay', { qr_data: cobro.qr_data, charge_id: cobro.id });
      c.respuesta(r1, 201, 'repetir el pago');
      c.igual((await api.victor.saldo()).crc, antesV, 'repetir el pago no debe cobrar otra vez');
      // Otra persona intenta pagar un cobro ya pagado.
      const r2 = await api.emmanuel.post('/qr/pay', { qr_data: cobro.qr_data, charge_id: cobro.id });
      c.respuesta(r2, 409, 'otro pagador sobre un cobro pagado', 'COBRO_YA_PAGADO');
      // Cancelar un cobro ya pagado.
      const r3 = await api.keilor.delete(`/qr/charges/${cobro.id}`);
      c.respuesta(r3, 409, 'cancelar un cobro pagado', 'COBRO_YA_PAGADO');
      // Un cobro nuevo: el dueno no puede pagarlo, y cancelado nadie lo paga.
      const rotulo = (await api.keilor.exigir('GET', `/qr/merchants/${comercio.id}/code?currency=CRC`)).data;
      const nuevo = await api.keilor.post('/qr/charges', { qr_code_id: rotulo.id, amount: centimos(500), channel: 'counter', note: llave('c') });
      c.respuesta(nuevo, 201, 'crear un segundo cobro');
      if (nuevo.ok) {
        const r4 = await api.keilor.post('/qr/pay', { qr_data: nuevo.data.qr_data, charge_id: nuevo.data.id });
        c.respuesta(r4, 400, 'el dueño paga su propio cobro', 'NO_PODES_PAGARTE');
        const r5 = await api.keilor.delete(`/qr/charges/${nuevo.data.id}`);
        c.respuesta(r5, 204, 'cancelar un cobro pendiente');
        const r6 = await api.victor.post('/qr/pay', { qr_data: nuevo.data.qr_data, charge_id: nuevo.data.id });
        c.respuesta(r6, 409, 'pagar un cobro cancelado', 'COBRO_CANCELADO');
      }
      c.igual((await api.victor.saldo()).crc, antesV, 'ninguno de los rechazos debe mover plata');
    });
  },
};
