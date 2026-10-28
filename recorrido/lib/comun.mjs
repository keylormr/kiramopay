// Ayudas compartidas por varios flujos.
import { entrar, entrarConContrasena, peticion } from './api.mjs';
import { CORRIDA, CUENTAS } from './entorno.mjs';
import * as bd from './bd.mjs';

/** Colones a unidades menores (centimos). */
export const centimos = (colones) => Math.round(colones * 100);

/** Saldos {crc, usd} de varias personas a la vez: { victor: {...}, keilor: {...} }. */
export async function saldos(...clientes) {
  const salida = {};
  for (const c of clientes) salida[c.usuario] = await c.saldo();
  return salida;
}

/** Abre las sesiones de API de las personas pedidas: { victor: Cliente, ... }. */
export async function clientes(...usuarios) {
  const salida = {};
  for (const u of usuarios) salida[u] = await entrar(u);
  return salida;
}

/** Codigo QR personal (el que se pega en lugar de escanear) de una persona. */
export async function qrPersonal(api, moneda = 'CRC') {
  const r = await api.exigir('GET', `/qr/codes/me?currency=${moneda}`);
  return r.data.qr_data;
}

/** Ultima fila del libro de movimientos de una persona con ese tipo. */
export async function ultimoMovimiento(api, tipo) {
  const filas = await api.movimientos({ type: tipo, limit: '5' });
  return filas[0] ?? null;
}

/** Cuenta los movimientos de un tipo (hasta 100). */
export async function contarMovimientos(api, tipo) {
  const filas = await api.movimientos({ type: tipo, limit: '100' });
  return filas.length;
}

/** El libro cuadra: sin deriva de billeteras y sin asientos descuadrados. Devuelve los problemas. */
export function problemasDelLibro() {
  const problemas = [];
  const deriva = bd.derivaDeBilleteras();
  if (deriva.length) {
    problemas.push(
      `billeteras que no coinciden con el libro: ${deriva
        .map((d) => `${d.username} (CRC ${d.drift_crc}, USD ${d.drift_usd})`)
        .join('; ')}`,
    );
  }
  const malos = bd.asientosDescuadrados();
  if (malos.length) problemas.push(`${malos.length} asiento(s) con debitos distintos de creditos: ${JSON.stringify(malos.slice(0, 3))}`);
  return problemas;
}

/** Nombre unico de esta corrida (para comercios y metas que no se pueden repetir). */
export const nombreUnico = (base) => `${base} ${CORRIDA}`;

/**
 * admin.kp: el otro administrador de la semilla. No es cuenta de demostracion,
 * asi que entra con la contrasena de seeder.go (valida solo en desarrollo). Es
 * quien aprueba el comercio de keilor: un administrador no puede aprobar el suyo.
 */
export async function adminKp() {
  return entrarConContrasena('admin.kp', 'Admin2024!');
}

/**
 * Comercio de keilor ya aprobado, para los flujos que lo necesitan. Si el flujo
 * de alta no corrio (o fallo antes de dejarlo listo), lo deja listo por API.
 */
export async function asegurarComercio(ctx) {
  if (ctx.estado.comercio?.aprobado) return ctx.estado.comercio;
  const keilor = await entrar('keilor');
  const propios = await keilor.exigir('GET', '/qr/merchants');
  let comercio = (propios.data ?? []).find((m) => m.name?.includes(CORRIDA));
  if (!comercio) {
    const r = await keilor.exigir('POST', '/qr/merchant', {
      name: nombreUnico('Soda Keilor'),
      description: 'Comercio de la prueba',
      category: 'restaurant',
      cedula: '3101123',
      cedula_type: 'juridica',
      legal_name: nombreUnico('Soda Keilor SA'),
    });
    comercio = r.data;
  }
  if (comercio.verification_status !== 'verified') {
    const admin = await adminKp();
    await admin.exigir('POST', `/admin/merchants/${comercio.id}/approve`, {});
  }
  ctx.estado.comercio = { id: comercio.id, nombre: comercio.name, aprobado: true };
  return ctx.estado.comercio;
}

export { CUENTAS, peticion };
