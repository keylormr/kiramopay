/**
 * Un conteo con su sustantivo, en singular o plural: "1 cobro", "3 cobros".
 *
 * La clave del plural es `clave`; la del singular, `clave_one`. Los dos textos
 * llevan `{n}`, de modo que cada idioma ponga el numero donde le toca. Un
 * `replace('{n}', ...)` suelto sobre una sola frase daba "Ultimos 1 cobros".
 *
 * Singular es exactamente 1. No se usa Intl.PluralRules: en francés o hindi su
 * categoria "one" tambien incluye al cero, y "Dernier encaissement" con cero
 * cobros no es cierto.
 */
export function conteoConPlural(t: (clave: string) => string, clave: string, n: number): string {
  return t(n === 1 ? `${clave}_one` : clave).replace('{n}', n.toLocaleString('en-US'));
}
