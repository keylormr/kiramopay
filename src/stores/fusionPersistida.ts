// Rehidratacion defensiva de las porciones persistidas.
//
// Lo que hay en localStorage lo escribio una version anterior de la aplicacion,
// o un guardado que quedo a medias. Cuando un campo que el codigo recorre con
// .map/.filter/.reduce/.slice vuelve con otra forma, la vista que lo pinta
// lanza durante el render y se lleva la aplicacion entera a la pantalla de
// "Algo salio mal" — sin que la persona pueda hacer nada, porque el estado malo
// sigue guardado y vuelve a cargarse en cada intento.
//
// Ya paso: el commit 3707f01 ("stop a corrupt crypto state from crashing the
// whole app") puso esta misma guarda en la porcion de cripto. Nunca se replico
// al resto, y `transactions` se pinta en la PRIMERA pantalla despues de entrar.
//
// La comprobacion es Array.isArray y no `?? []` a proposito: lo segundo solo
// salva de null y undefined, y el caso que hay que cubrir es que el valor
// guardado tenga otra forma (un objeto, una cadena, un numero).

/**
 * Arma el `merge` de un store persistido: acepta lo guardado, pero devuelve el
 * valor inicial de cada campo listado que no haya rehidratado como arreglo.
 */
export function fusionConArrays<T extends object>(campos: (keyof T)[]) {
  return (persisted: unknown, current: T): T => {
    const guardado = (persisted ?? {}) as Partial<T>;
    const fusionado = { ...current, ...guardado } as T;
    for (const campo of campos) {
      if (!Array.isArray(guardado[campo])) {
        fusionado[campo] = current[campo];
      }
    }
    return fusionado;
  };
}

/**
 * La misma idea en el punto de consumo, para lo que se lee sin pasar por el
 * store. Es el cinturon, no el tirante: la guarda de verdad va en el `merge`.
 */
export function comoLista<T>(valor: T[] | null | undefined): T[] {
  return Array.isArray(valor) ? valor : [];
}
