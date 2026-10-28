// Recorrido de los flujos de dinero contra el servidor REAL (backend en Go con
// Postgres y Redis), con la pantalla compilada y un navegador de verdad.
//
// Cada flujo exporta { id, nombre, ejecutar(f, ctx) }. Un flujo es una lista de
// pasos; cada paso saca una captura y queda en verde o en rojo. Un fallo no
// detiene a los demas flujos: al final se escribe el informe (JSON, Markdown y
// resumen del job) y el proceso sale con codigo 1 si algo fallo.
import { Informe } from './lib/informe.mjs';
import { SOLO, SALIDA, APP, API_BASE, CORRIDA } from './lib/entorno.mjs';
import { cerrarNavegador } from './lib/ui.mjs';
import { peticion } from './lib/api.mjs';
import flujos from './flujos/index.mjs';

const informe = new Informe();
const ctx = { estado: {}, informe };

console.log(`Recorrido ${CORRIDA}: pantalla ${APP}, servidor ${API_BASE}, salida ${SALIDA}`);
const elegidos = SOLO.length ? flujos.filter((fl) => SOLO.includes(fl.id)) : flujos;

// Diferencia (reserva menos pasivo con usuarios) de la prueba de reservas despues de cada flujo: si un
// flujo la mueve, queda como alerta de ese flujo para saber cual la crea.
const diferenciaDeReservas = {};
async function anotarReservas(flujo) {
  try {
    const r = await peticion('GET', '/transparency/proof-of-reserves');
    for (const m of r.data?.currencies ?? []) {
      const dif = Number(m.reserve_balance_minor) - Number(m.user_liabilities_minor);
      const antes = diferenciaDeReservas[m.currency];
      if (flujo && antes !== undefined && dif !== antes) {
        flujo.alertar(`Prueba de reservas ${m.currency}: la diferencia (reserva menos pasivo) pasó de ${antes} a ${dif} en este flujo`);
      }
      diferenciaDeReservas[m.currency] = dif;
    }
  } catch {
    // sin dato: no es lo que se prueba
  }
}
await anotarReservas(null);

for (const def of elegidos) {
  console.log(`\n== ${def.nombre} (${def.id})`);
  const flujo = informe.nuevoFlujo(def.id, def.nombre, { telefono: !!def.telefono });
  try {
    await def.ejecutar(flujo, ctx);
  } catch (e) {
    // Un error fuera de un paso (la preparacion del flujo): se anota como paso.
    await flujo.paso('Preparación del flujo', async () => {
      throw e;
    });
  } finally {
    await flujo.cerrar();
    await anotarReservas(flujo);
  }
  for (const a of flujo.alertas) console.log(`  [alerta] ${a}`);
}

await cerrarNavegador();
informe.escribir();
const t = informe.totales();
console.log(`\nResultado: ${t.pasaron} de ${t.total} flujos pasaron, ${t.fallaron} fallaron.`);
process.exit(t.fallaron ? 1 : 0);
