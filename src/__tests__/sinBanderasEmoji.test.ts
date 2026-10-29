// Windows no dibuja los emojis de bandera: se ven como las letras "CR" y "US".
// Toda bandera que la pantalla pinta pasa por <Bandera>, que dibuja un SVG en
// linea. Esta prueba lee el codigo de las pantallas para que no vuelva a
// escribirse un emoji de bandera a mano, ni a pintar un dato `flag` crudo.

const fuentes = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

// Codigo de produccion: ni pruebas ni el propio componente.
const rutas = Object.keys(fuentes).filter((r) => !r.includes('/__tests__/') && !/\.test\.tsx$/.test(r));

const PAR_REGIONAL = /[\u{1F1E6}-\u{1F1FF}]{2}/u;
// {algo.flag}, {info.flag}, {pais.flagEmoji}: el dato crudo dentro del JSX. Lo
// que va como `pais={algo.flag}` es el uso correcto: se lo da a <Bandera>.
const FLAG_CRUDA = /(?<!pais=)\{\s*[\w.?]*\.?(flag|flagEmoji)\s*\}/;

describe('las banderas no se escriben como emoji', () => {
  it('hay pantallas que revisar', () => {
    expect(rutas.length).toBeGreaterThan(50);
  });

  it('ninguna pantalla ni componente trae un emoji de bandera escrito a mano', () => {
    const conEmoji = rutas.filter((r) => PAR_REGIONAL.test(fuentes[r]));
    expect(conEmoji).toEqual([]);
  });

  it('ninguna pantalla pinta el dato `flag` sin pasar por <Bandera>', () => {
    const crudas = rutas.filter((r) => FLAG_CRUDA.test(fuentes[r]));
    expect(crudas).toEqual([]);
  });
});
