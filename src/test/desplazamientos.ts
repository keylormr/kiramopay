/**
 * Registra a que elementos se les pidio `scrollIntoView`.
 *
 * jsdom no lo implementa, y `ErrorALaVista` lo llama con `?.`: sin esto, una
 * prueba no puede distinguir un error que se lleva a la vista de uno que queda
 * bajo el borde de la hoja. Se instala antes de cada prueba y se quita despues,
 * para que el resto de la suite siga viendo el jsdom de siempre.
 *
 * Uso: `const desplazados = registrarDesplazamientos();` al nivel del archivo,
 * y en la prueba `expect(desplazados).toContain(aviso)`.
 */
export function registrarDesplazamientos(): Element[] {
  const desplazados: Element[] = [];
  beforeEach(() => {
    desplazados.length = 0;
    Element.prototype.scrollIntoView = function (this: Element) {
      desplazados.push(this);
    };
  });
  afterEach(() => {
    delete (Element.prototype as Partial<Element>).scrollIntoView;
  });
  return desplazados;
}
