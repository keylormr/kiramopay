/**
 * Generacion de sesion: un contador que sube cada vez que la sesion cambia de
 * duenno (login, registro, cierre de sesion, expulsion).
 *
 * Existe por una carrera concreta. `syncAllData` dispara nueve peticiones y las
 * espera; si mientras tanto el usuario cierra sesion, `limpiarDatosDeUsuario`
 * vacia los stores y ACTO SEGUIDO llegan esas respuestas y vuelven a escribir
 * los datos del usuario anterior sobre los stores ya limpios. El siguiente en
 * usar el aparato hereda cuentas, contactos e historial de quien salio: justo lo
 * que esa limpieza existe para impedir.
 *
 * Quien empieza un trabajo asincronico que va a escribir en un store guarda la
 * generacion del momento; al terminar, si cambio, descarta el resultado.
 *
 * Vive en su propio modulo, y no dentro de dataSync, para que
 * `limpiarDatosDeUsuario` pueda subirlo sin crear un ciclo de importaciones
 * entre los stores y los servicios.
 */
let generacion = 0;

/** La generacion actual. Se guarda ANTES de empezar el trabajo asincronico. */
export function generacionActual(): number {
  return generacion;
}

/** Invalida todo trabajo en vuelo: lo que llegue despues ya no es de nadie. */
export function nuevaGeneracion(): void {
  generacion += 1;
}

/** True si la generacion guardada sigue siendo la vigente. */
export function sigueVigente(guardada: number): boolean {
  return guardada === generacion;
}
