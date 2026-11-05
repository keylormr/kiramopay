import { coincideConElRegistrado } from '../nombreDelDestinatario';

// El servidor devuelve el nombre REGISTRADO recortado: nombre(s) completos e
// inicial de cada apellido ("Keilor M. R."). El QR trae el nombre que escribio
// quien lo creo. Coinciden si es la misma persona dicha de otra forma; no si el
// QR dice otra cosa (un QR "de Mama" con el numero de un desconocido).

describe('coincideConElRegistrado', () => {
  const casos: Array<[string, string, string, boolean]> = [
    ['nombre completo del QR contra el recortado', 'Keilor Martinez Rodriguez', 'Keilor M. R.', true],
    ['sin tildes ni mayusculas', 'keilor MARTINEZ', 'Keilor M. R.', true],
    ['con tildes de un lado y no del otro', 'José Pérez', 'Jose P.', true],
    ['solo el nombre de pila', 'Keilor', 'Keilor M. R.', true],
    ['dos nombres de pila', 'Maria Jose Gomez', 'Maria Jose G.', true],
    ['uno de los dos nombres de pila y el apellido', 'Maria Gomez', 'Maria Jose G.', true],
    ['espacios de mas', '  Keilor   Martinez ', 'Keilor M. R.', true],
    ['caracteres invisibles en el QR', 'Kei\u200blor Martinez', 'Keilor M. R.', true],
    ['apellido compuesto dicho por su ultimo apellido', 'Ana Cruz', 'Ana D. L. C.', true],
    ['apellido compuesto completo', 'Ana de la Cruz', 'Ana D. L. C.', true],
    ['nombre de pila abreviado con punto en el QR', 'Ma. José García', 'Ma Jose G.', true],
    ['solo el segundo apellido', 'Keilor Rodriguez', 'Keilor M. R.', true],
    ['apellidos en otro orden que el registrado', 'Keilor Rodriguez Martinez', 'Keilor M. R.', false],
    ['una inicial que el registro no tiene', 'Ana Mora', 'Ana D. L. C.', false],
    ['el QR dice un apodo', 'Mama', 'Keilor M. R.', false],
    ['mismo nombre y otro apellido', 'Keilor Perez', 'Keilor M. R.', false],
    ['otro nombre y mismo apellido', 'Carlos Martinez', 'Keilor M. R.', false],
    ['mas apellidos de los registrados', 'Ana Perez Mora', 'Ana P.', false],
    ['el QR no trae nombre', '', 'Keilor M. R.', false],
    ['el registrado no trae nombre', 'Keilor', '', false],
    ['el apellido primero y el nombre despues', 'Martinez Keilor', 'Keilor M. R.', false],
  ];
  it.each(casos)('%s', (_n, qr, registrado, quiere) => {
    expect(coincideConElRegistrado(qr, registrado)).toBe(quiere);
  });
});
