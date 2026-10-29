// Cierre del recorrido: despues de mover plata por todos los caminos, el libro
// contable tiene que seguir cuadrado. Va siempre al ultimo.
import { API_BASE } from '../lib/entorno.mjs';
import { clientes } from '../lib/comun.mjs';
import { peticion, errores5xx } from '../lib/api.mjs';
import * as bd from '../lib/bd.mjs';

export default {
  id: 'libro-final',
  nombre: 'Libro contable al final del recorrido',
  async ejecutar(f, ctx) {
    const api = await clientes('keilor');

    await f.paso('Ninguna billetera se desvió del libro y todos los asientos cuadran', async (c) => {
      // Se lee por SQL ANTES de llamar a la reconciliacion: esa corrige sola lo que encuentre y taparia el defecto.
      const deriva = bd.derivaDeBilleteras();
      c.ok(deriva.length === 0, `billeteras que no coinciden con el libro: ${JSON.stringify(deriva)}`);
      const malos = bd.asientosDescuadrados();
      c.ok(malos.length === 0, `${malos.length} asiento(s) con débitos distintos de créditos: ${JSON.stringify(malos.slice(0, 5))}`);
      for (const s of bd.sumasPorMoneda()) c.igual(s.debitos, s.creditos, `débitos contra créditos en ${s.currency}`);
    });

    await f.paso('La reconciliación del servidor no encuentra billeteras malas', async (c) => {
      const r = await peticion('POST', '/admin/reconcile', { token: api.keilor.token, cuerpo: {} });
      c.exigirRespuesta(r, 200, 'reconciliación');
      c.igual(r.data.wallets_bad, 0, 'billeteras con desvío');
      c.igual(r.data.drift_crc, 0, 'desvío total en colones');
      c.igual(r.data.drift_usd, 0, 'desvío total en dólares');
    });

    await f.paso('La garantía de escrow y las metas de ahorro no retienen plata de más', async (c) => {
      const garantia = bd.saldoCuenta('SYSTEM:ESCROW:CRC');
      c.igual(garantia, 0, 'saldo de SYSTEM:ESCROW:CRC con todos los acuerdos resueltos o cancelados');
      const ahorros = bd.saldoCuenta('SYSTEM:SAVINGS:CRC');
      c.igual(ahorros, 0, 'saldo de SYSTEM:SAVINGS:CRC con todas las metas eliminadas');
    });

    await f.paso('La reserva es exactamente igual al pasivo con los usuarios en cada moneda, como al empezar', async (c) => {
      // Regla del dueno: en cada moneda la reserva es EXACTAMENTE igual a lo que se les debe a los usuarios
      // (difference_minor = 0, fully_backed = true), despues de cualquier operacion. Lo que no es de ellos
      // (comisiones, fondo de promociones, la plata de una compra de cripto) vive en SYSTEM:CAPITAL.
      const r = await peticion('GET', '/transparency/proof-of-reserves');
      c.exigirRespuesta(r, 200, 'prueba de reservas');
      const monedas = r.data.currencies ?? [];
      c.ok(monedas.length >= 1, 'la prueba de reservas no trae monedas');
      for (const m of monedas) {
        c.ok(typeof m.difference_minor === 'number' && typeof m.fully_backed === 'boolean', `${m.currency}: la prueba de reservas no trae difference_minor y fully_backed: ${JSON.stringify(m)}`);
        f.alertar(`Prueba de reservas ${m.currency}: pasivo ${m.user_liabilities_minor}, reserva ${m.reserve_balance_minor}, difference_minor ${m.difference_minor}, fully_backed ${m.fully_backed}, cobertura ${Number(m.ratio_pct).toFixed(3)} %`);
        const cambios = (ctx.estado.cambiosReservas ?? [])
          .filter((x) => x.moneda === m.currency)
          .map((x) => `${x.flujo}: ${x.antes} a ${x.despues}`)
          .join('; ');
        c.ok(m.difference_minor === 0 && m.fully_backed === true, `${m.currency}: la reserva (${m.reserve_balance_minor}) no es igual al pasivo con usuarios (${m.user_liabilities_minor}): difference_minor ${m.difference_minor}, fully_backed ${m.fully_backed}. Cambios de la diferencia por flujo: ${cambios || 'ninguno'}`);
      }
    }, { seguir: true });

    await f.paso('El historial acepta pedir más movimientos que el tope sin volver a 20', async (c) => {
      // Un "limit" mayor que el tope (100) devuelve el tope, no vuelve al valor por defecto (20).
      const victor = await clientes('victor');
      const cien = (await victor.victor.exigir('GET', '/transactions?limit=100')).data.transactions ?? [];
      const quinientos = (await victor.victor.exigir('GET', '/transactions?limit=500')).data.transactions ?? [];
      c.ok(cien.length > 20, `victor debería tener más de 20 movimientos al final del recorrido: ${cien.length}`);
      c.ok(quinientos.length >= cien.length, `pedir limit=500 devolvió ${quinientos.length} movimientos y limit=100 devolvió ${cien.length}: el tope debería recortar a 100, no volver a 20`);
    }, { seguir: true });

    await f.paso('Ningún flujo provocó un error 5xx del servidor', async (c) => {
      const errores = [];
      for (const fl of ctx.informe.flujos) {
        for (const a of fl.alertas ?? []) if (/HTTP 5\d\d/.test(a)) errores.push(`${fl.nombre}: ${a}`);
      }
      for (const e of errores5xx) errores.push(`API: ${e}`);
      c.ok(errores.length === 0, `${errores.length} respuesta(s) 5xx durante el recorrido:\n${errores.slice(0, 10).join('\n')}`);
    }, { seguir: true });

    await f.paso('El servidor sigue sano al terminar', async (c) => {
      const res = await fetch(`${API_BASE}/health`);
      const cuerpo = await res.json().catch(() => ({}));
      c.igual(res.status, 200, 'GET /health');
      c.igual(cuerpo.services?.database, 'ok', 'base de datos');
      c.igual(cuerpo.services?.redis, 'ok', 'Redis');
    });
  },
};
