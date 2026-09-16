import { esFechaValida, fechaCorta, hoyLocal, siguienteFecha } from '../pagosFijos';

describe('pagosFijos — la proxima fecha sigue la regla del servidor', () => {
  it('semanal y quincenal suman dias, cruzando meses y años', () => {
    expect(siguienteFecha('2026-09-28', 'weekly')).toBe('2026-10-05');
    expect(siguienteFecha('2026-12-25', 'biweekly')).toBe('2027-01-08');
  });

  it('mensual se queda en el ultimo dia cuando el dia no existe, como Postgres', () => {
    expect(siguienteFecha('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(siguienteFecha('2028-01-31', 'monthly')).toBe('2028-02-29');
    expect(siguienteFecha('2026-03-31', 'monthly')).toBe('2026-04-30');
    expect(siguienteFecha('2026-12-15', 'monthly')).toBe('2027-01-15');
  });

  it('una fecha ilegible no se inventa: vuelve tal cual', () => {
    expect(siguienteFecha('mañana', 'monthly')).toBe('mañana');
    expect(esFechaValida('2026-02-30')).toBe(false);
    expect(esFechaValida('05/10/2026')).toBe(false);
    expect(esFechaValida('2026-10-05')).toBe(true);
  });

  it('hoy sale del calendario del dispositivo, no de UTC', () => {
    // 11 p. m. del 5 en la hora local: en UTC ya podria ser el 6.
    expect(hoyLocal(new Date(2026, 9, 5, 23, 30))).toBe('2026-10-05');
  });

  it('la fecha corta no se corre un dia por la zona horaria', () => {
    expect(fechaCorta('2026-10-05', 'es')).toMatch(/5/);
    expect(fechaCorta('2026-10-05', 'es')).not.toMatch(/\b4\b/);
    expect(fechaCorta('x', 'es')).toBe('x');
  });
});
