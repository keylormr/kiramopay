import { fechaSinCortes } from '../fechaSinCortes';

describe('fechaSinCortes', () => {
  it('deja cortar solo despues de la coma', () => {
    const texto = new Intl.DateTimeFormat('es-CR', { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date('2026-11-04T18:45:00-06:00'));
    const resultado = fechaSinCortes(texto);

    const partes = resultado.split(', ');
    expect(partes.length).toBeGreaterThan(1);
    for (const parte of partes) expect(parte).not.toMatch(/ /);
    // El texto que se lee no cambia.
    expect(resultado.replace(/\s/g, ' ')).toBe(texto.replace(/\s/g, ' '));
  });

  it('sin coma, la fecha entera queda en un solo renglon', () => {
    expect(fechaSinCortes('6 nov')).toBe('6\u00a0nov');
    expect(fechaSinCortes('—')).toBe('—');
  });
});
