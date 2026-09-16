import { escalaDivergente, pasoRedondo } from '../escala';

describe('escala de los graficos', () => {
  it('elige pasos redondos', () => {
    expect(pasoRedondo(600_000, 4)).toBe(200_000);
    expect(pasoRedondo(1_000, 4)).toBe(250);
    expect(pasoRedondo(7, 4)).toBe(2);
    expect(pasoRedondo(0, 4)).toBe(1);
  });

  // El mismo paso a los dos lados del cero: un gasto de 150 mil tiene que
  // medir lo mismo que un ingreso de 150 mil.
  it('usa el mismo paso arriba y abajo e incluye el cero', () => {
    const e = escalaDivergente(425_000, 125_780);
    expect(e.paso).toBe(100_000);
    expect(e.arriba).toBe(500_000);
    expect(e.abajo).toBe(200_000);
    expect(e.marcas).toEqual([-200_000, -100_000, 0, 100_000, 200_000, 300_000, 400_000, 500_000]);
  });

  // Con pasos de un millon, un ano con topes de 1,1 y 1,3 millones dejaba casi
  // la mitad del grafico vacio. Se elige el paso que menos espacio desperdicia.
  it('elige el paso que menos espacio deja vacio', () => {
    const e = escalaDivergente(1_100_000, 1_300_000);
    expect(e.paso).toBe(500_000);
    expect(e.arriba).toBe(1_500_000);
    expect(e.abajo).toBe(1_500_000);
  });

  it('con solo gastos el eje empieza en cero', () => {
    const e = escalaDivergente(0, 90);
    expect(e.arriba).toBe(0);
    expect(e.marcas[e.marcas.length - 1]).toBe(0);
    expect(e.marcas[0]).toBe(-e.abajo);
  });

  it('sin datos no colapsa y no arrastra decimales binarios', () => {
    expect(escalaDivergente(0, 0).marcas).toEqual([0, 1]);
    expect(escalaDivergente(0.3, 0).marcas).toEqual([0, 0.1, 0.2, 0.3]);
  });
});
