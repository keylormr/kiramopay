// Regulador de ritmo. El servidor limita a 200 peticiones por minuto a cada
// persona (middleware.UserRateLimit) y a 300 el total por cuenta: la pantalla de
// una sesion abierta ya pide una veintena al cargar, y el script, que repite
// consultas sin pausa, llegaba a pasarse y recibia 429 que nada tenian que ver
// con lo que se estaba probando. Aqui se cuentan las peticiones de cada persona
// (las del script y las de su navegador) y se espera cuando ya van muchas.
const VENTANA_MS = 60_000;
const TOPE = Number(process.env.RECORRIDO_TOPE_POR_MINUTO || 110);

const marcas = new Map(); // usuario -> [instantes]

export const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Anota `n` peticiones de una persona. */
export function anotar(usuario, n = 1) {
  if (!usuario) return;
  const lista = marcas.get(usuario) ?? [];
  const ahora = Date.now();
  for (let i = 0; i < n; i++) lista.push(ahora);
  marcas.set(usuario, lista);
}

function recientes(usuario) {
  const corte = Date.now() - VENTANA_MS;
  const lista = (marcas.get(usuario) ?? []).filter((t) => t > corte);
  marcas.set(usuario, lista);
  return lista.length;
}

/** Espera hasta que la persona tenga lugar para `necesito` peticiones mas. */
export async function cupo(usuario, necesito = 1) {
  if (!usuario) return;
  while (recientes(usuario) + necesito > TOPE) await pausa(1000);
}
