// Ninguna pantalla usa un emoji como icono. Un emoji cambia de dibujo en cada
// sistema (y en Windows algunos ni existen), no sigue el color del tema y se ve
// como un juguete al lado de los iconos de linea. Los iconos van en
// components/Icons.tsx (IconosLinea) y los logos de cripto en LogoCripto.
//
// Se revisa el codigo de produccion (.tsx); los textos traducidos y los datos
// de ejemplo del adaptador falso no son iconos.

const fuentes = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

const rutas = Object.keys(fuentes).filter((r) => !r.includes('/__tests__/') && !/\.test\.tsx$/.test(r));

// Emoji con presentacion grafica, o cualquier caracter seguido del selector de
// variacion 16 (el que convierte, p. ej., un simbolo de texto en emoji).
const EMOJI = /\p{Emoji_Presentation}|️/u;

describe('sin emojis como iconos', () => {
  it('hay pantallas que revisar', () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it('ningun componente ni pantalla escribe un emoji', () => {
    const conEmoji = rutas.flatMap((ruta) =>
      fuentes[ruta]
        .split('\n')
        .map((linea, i) => ({ linea, i }))
        .filter(({ linea }) => EMOJI.test(linea))
        .map(({ linea, i }) => `${ruta}:${i + 1}: ${linea.trim().slice(0, 80)}`),
    );
    expect(conEmoji).toEqual([]);
  });
});
