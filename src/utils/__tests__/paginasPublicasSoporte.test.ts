import fs from 'fs';
import path from 'path';

// Las paginas publicas (politica de privacidad y solicitud de eliminacion) son
// HTML estatico: no pasan por i18n. Las dos mandaban a un "contacto de
// privacidad" que la politica dejaba como [DEFINIR]. Hoy el contacto es el
// correo de soporte, escrito como enlace mailto.
const raiz = process.cwd();
const privacidad = fs.readFileSync(path.join(raiz, 'public/privacidad/index.html'), 'utf-8');
const eliminar = fs.readFileSync(path.join(raiz, 'public/eliminar-cuenta/index.html'), 'utf-8');

const MAILTO = 'href="mailto:soporte@kiramopay.com"';

describe('politica de privacidad: contacto', () => {
  const seccion = /<h2 id="contacto">[\s\S]*?<\/p>/.exec(privacidad)?.[0] ?? '';

  it('la seccion de contacto existe', () => {
    expect(seccion).not.toBe('');
  });

  it('da el correo de soporte como enlace', () => {
    expect(seccion).toContain(MAILTO);
    expect(seccion).toContain('>soporte@kiramopay.com</a>');
  });

  it('ya no deja el correo de contacto como pendiente de definir', () => {
    expect(privacidad).not.toMatch(/DEFINIR correo de contacto/);
  });
});

describe('pagina de eliminar cuenta: contacto', () => {
  it('quien no puede usar el formulario sabe a donde escribir, con el enlace', () => {
    const sinJs = /<noscript>[\s\S]*?<\/noscript>/.exec(eliminar)?.[0] ?? '';
    expect(sinJs).toContain(MAILTO);
    expect(sinJs).not.toMatch(/contacto de privacidad que figura/);
  });
});
