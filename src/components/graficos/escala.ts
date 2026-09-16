/**
 * Escalas de los graficos: marcas "redondas" (1, 2, 2,5 o 5 por potencia de
 * diez) para que el eje se lea sin hacer cuentas.
 */

/** El paso redondo mas chico que parte `rango` en a lo sumo `divisiones`. */
export function pasoRedondo(rango: number, divisiones: number): number {
  if (!(rango > 0) || !(divisiones > 0)) return 1;
  const bruto = rango / divisiones;
  const magnitud = 10 ** Math.floor(Math.log10(bruto));
  const normal = bruto / magnitud;
  const redondo = normal <= 1 ? 1 : normal <= 2 ? 2 : normal <= 2.5 ? 2.5 : normal <= 5 ? 5 : 10;
  return redondo * magnitud;
}

export interface EscalaDivergente {
  /** Tope positivo del eje (ingresos). */
  arriba: number;
  /** Tope negativo del eje, como magnitud (gastos). */
  abajo: number;
  paso: number;
  /** Marcas de abajo hacia arriba, con el cero incluido. */
  marcas: number[];
}

function escalaCon(sube: number, baja: number, divisiones: number): EscalaDivergente {
  const paso = pasoRedondo(sube + baja, divisiones);
  const arriba = Math.ceil(sube / paso) * paso;
  const abajo = Math.ceil(baja / paso) * paso;
  // Sin nada que dibujar, un paso hacia arriba: el eje no colapsa a una linea.
  const topeArriba = arriba === 0 && abajo === 0 ? paso : arriba;
  const marcas: number[] = [];
  const cantidad = Math.round((topeArriba + abajo) / paso);
  for (let i = 0; i <= cantidad; i++) {
    // Redondeo: 0,1 + 0,2 no da 0,3 en binario y la marca se veria "0.30000000000000004".
    marcas.push(Math.round((-abajo + i * paso) * 1e6) / 1e6);
  }
  return { arriba: topeArriba, abajo, paso, marcas };
}

/**
 * Eje de barras divergentes: los ingresos crecen hacia arriba y los gastos
 * hacia abajo desde el cero, con el mismo paso en los dos lados para que los
 * largos se comparen de verdad.
 *
 * Prueba de 3 a `maxDivisiones` divisiones y se queda con la que deja menos
 * espacio vacio sobre la barra mas alta; a igual ajuste, la de menos marcas.
 */
export function escalaDivergente(maxArriba: number, maxAbajo: number, maxDivisiones = 6): EscalaDivergente {
  const sube = Math.max(0, maxArriba);
  const baja = Math.max(0, maxAbajo);
  let mejor = escalaCon(sube, baja, 3);
  for (let d = 4; d <= maxDivisiones; d++) {
    const otra = escalaCon(sube, baja, d);
    const tramoOtra = otra.arriba + otra.abajo;
    const tramoMejor = mejor.arriba + mejor.abajo;
    if (tramoOtra < tramoMejor - tramoMejor * 1e-9) mejor = otra;
  }
  return mejor;
}
