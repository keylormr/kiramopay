/**
 * Colores de los graficos, escritos como variables CSS.
 *
 * Los graficos son SVG y HTML propios, asi que `fill="var(--grafico-...)"`
 * llega tal cual al elemento y el tema claro/oscuro cambia solo con CSS (ver
 * index.css, bloque "Graficos"). Ningun grafico debe leer colores en
 * JavaScript.
 *
 * Reglas que sostienen estos valores:
 * - Ingreso y gasto son la semantica de flujo de toda la app (verde / rojo), y
 *   en los graficos de flujo tambien se separan por POSICION (arriba / abajo),
 *   asi que la identidad nunca depende solo del color.
 * - Las categorias siguen a la categoria, no a su puesto: filtrar o cambiar de
 *   periodo no las repinta.
 * - Las cuatro categorias con color (azul, naranja, violeta, ciruela/rosa) se
 *   validaron con TODOS los pares, en los dos temas, contra la superficie real
 *   de la tarjeta: separacion con daltonismo >= 10 y con vision normal >= 15
 *   (OKLab x100). No hay verde entre ellas a proposito: en esta pantalla el
 *   verde significa ingreso, y una porcion verde en "gastos" confunde.
 * - "Otros" es un gris neutro de otro brillo, para que no se confunda con el
 *   violeta. Algunos tonos quedan bajo 3:1 contra la tarjeta; por eso cada
 *   grafico de categorias lleva al lado la lista con nombre, monto y
 *   porcentaje, que es la codificacion secundaria.
 * - Ingreso y gasto (verde/rojo) no se distinguen con deuteranopia: nunca
 *   dependen solo del color (posicion arriba/abajo, rotulos, signo e icono).
 */
export const COLOR = {
  ingreso: 'var(--grafico-ingreso)',
  gasto: 'var(--grafico-gasto)',
  anterior: 'var(--grafico-anterior)',
  rejilla: 'var(--grafico-rejilla)',
  eje: 'var(--grafico-eje)',
  cursor: 'var(--grafico-cursor)',
} as const;

const COLOR_CATEGORIA: Record<string, string> = {
  transfers: 'var(--grafico-cat-1)',
  shopping: 'var(--grafico-cat-2)',
  services: 'var(--grafico-cat-3)',
  cash: 'var(--grafico-cat-4)',
  income: 'var(--grafico-ingreso)',
  other: 'var(--grafico-cat-otros)',
};

export const CATEGORIAS_CONOCIDAS = Object.keys(COLOR_CATEGORIA);

export function colorDeCategoria(categoria: string): string {
  return COLOR_CATEGORIA[categoria] ?? COLOR_CATEGORIA.other;
}
