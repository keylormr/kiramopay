/**
 * Una fecha con hora solo se parte en dos renglones despues de la coma:
 * "4 nov 2026, | 6:45 p. m.". En una columna angosta quedaba "6:45 p." en un
 * renglon y "m." en el siguiente.
 */
export function fechaSinCortes(texto: string): string {
  return texto
    .split(', ')
    .map((parte) => parte.replace(/ /g, '\u00a0'))
    .join(', ');
}
