import { LANGUAGES } from '../translations';
import spec from '../../../backend/docs/openapi.yaml?raw';
import migracion from '../../../backend/migrations/074_idioma_de_la_cuenta.sql?raw';
import textos from '../../../backend/internal/notification/textos.go?raw';

// La lista de idiomas vive en cuatro sitios: la app, el servidor (que escribe
// los avisos), el CHECK de la base y la especificacion de la API. Si la app
// suma un idioma y nadie toca los otros tres, guardarlo devuelve 400
// INVALID_LANGUAGE, la app se lo traga (es de mejor esfuerzo) y la persona
// sigue recibiendo los avisos en espanol sin que nada lo diga.

const deLaApp = LANGUAGES.map((l) => l.code).sort();

function lista(texto: string): string[] {
  return texto
    .split(',')
    .map((s) => s.trim().replace(/['"]/g, ''))
    .filter(Boolean)
    .sort();
}

describe('los idiomas de la app y los del servidor son los mismos', () => {
  it('el servidor escribe avisos en cada idioma de la app', () => {
    const m = /var Idiomas = \[\]string\{([^}]*)\}/.exec(textos);
    expect(m).not.toBeNull();
    expect(lista(m![1])).toEqual(deLaApp);
  });

  it('la base acepta cada idioma de la app', () => {
    const m = /CHECK \(language IN \(([^)]*)\)\)/.exec(migracion);
    expect(m).not.toBeNull();
    expect(lista(m![1])).toEqual(deLaApp);
  });

  it('la especificacion de la API declara cada idioma de la app, en cada lugar donde aparece', () => {
    const enums = [...spec.matchAll(/language:[\s\S]{0,120}?enum: \[([^\]]*)\]/g)].map((m) => lista(m[1]));
    expect(enums.length).toBeGreaterThanOrEqual(2);
    for (const e of enums) expect(e).toEqual(deLaApp);
  });
});
