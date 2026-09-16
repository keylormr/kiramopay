import {
  claveDeTramo,
  desplazar,
  fechaCivilCR,
  granularidadDe,
  hoyCR,
  nombreDeRango,
  parteTranscurrida,
  periodoAnterior,
  rangoPreset,
  tramosDe,
} from '../periodos';

describe('periodos — dias civiles de Costa Rica', () => {
  // El servidor corta los dias en hora de Costa Rica. Si el telefono usara su
  // propia zona, "este mes" pediria un rango distinto del que el servidor suma.
  it('hoy es la fecha de Costa Rica aunque en UTC ya sea manana', () => {
    // 1 de septiembre 03:00 UTC = 31 de agosto 21:00 en Costa Rica.
    expect(hoyCR(Date.UTC(2026, 8, 1, 3, 0))).toBe('2026-08-31');
    expect(hoyCR(Date.UTC(2026, 8, 1, 6, 0))).toBe('2026-09-01');
    expect(fechaCivilCR(new Date('2026-08-01T05:59:59Z'))).toBe('2026-07-31');
  });

  it('los atajos son rangos con el final excluido', () => {
    const hoy = '2026-09-13';
    expect(rangoPreset('este_mes', hoy)).toEqual({ desde: '2026-09-01', hasta: '2026-10-01' });
    expect(rangoPreset('mes_pasado', hoy)).toEqual({ desde: '2026-08-01', hasta: '2026-09-01' });
    expect(rangoPreset('ultimos_30', hoy)).toEqual({ desde: '2026-08-15', hasta: '2026-09-14' });
    expect(rangoPreset('este_ano', hoy)).toEqual({ desde: '2026-01-01', hasta: '2027-01-01' });
    // Enero: el mes pasado es diciembre del ano anterior.
    expect(rangoPreset('mes_pasado', '2026-01-05')).toEqual({ desde: '2025-12-01', hasta: '2026-01-01' });
  });

  it('el promedio divide solo entre los dias que ya pasaron', () => {
    expect(parteTranscurrida({ desde: '2026-09-01', hasta: '2026-10-01' }, '2026-09-13')).toEqual({
      desde: '2026-09-01',
      hasta: '2026-09-14',
    });
    expect(parteTranscurrida({ desde: '2026-10-01', hasta: '2026-11-01' }, '2026-09-13')).toBeNull();
  });
});

describe('periodoAnterior — comparar lo comparable', () => {
  // Trece dias de septiembre contra agosto entero diria "gastaste 60% menos"
  // sin que sea cierto: se comparan los mismos dias.
  it('un mes en curso se compara contra los mismos dias del mes anterior', () => {
    expect(periodoAnterior({ desde: '2026-09-01', hasta: '2026-10-01' }, '2026-09-13')).toEqual({
      desde: '2026-08-01',
      hasta: '2026-08-14',
    });
  });

  it('un mes cerrado se compara contra el mes anterior entero, aunque tenga menos dias', () => {
    // Marzo (31) contra febrero (28): nunca se mete en marzo.
    expect(periodoAnterior({ desde: '2026-03-01', hasta: '2026-04-01' }, '2026-09-13')).toEqual({
      desde: '2026-02-01',
      hasta: '2026-03-01',
    });
  });

  it('un ano en curso contra el mismo tramo del ano anterior', () => {
    expect(periodoAnterior({ desde: '2026-01-01', hasta: '2027-01-01' }, '2026-09-13')).toEqual({
      desde: '2025-01-01',
      hasta: '2025-09-14',
    });
  });

  it('un rango libre contra los mismos dias inmediatamente antes', () => {
    expect(periodoAnterior({ desde: '2026-08-15', hasta: '2026-09-14' }, '2026-09-13')).toEqual({
      desde: '2026-07-16',
      hasta: '2026-08-15',
    });
  });
});

describe('desplazar — las flechas del periodo', () => {
  it('mueve un mes, un ano o el mismo largo, y no entra al futuro', () => {
    const hoy = '2026-09-13';
    expect(desplazar({ desde: '2026-09-01', hasta: '2026-10-01' }, -1, hoy)).toEqual({ desde: '2026-08-01', hasta: '2026-09-01' });
    expect(desplazar({ desde: '2026-09-01', hasta: '2026-10-01' }, 1, hoy)).toBeNull();
    expect(desplazar({ desde: '2025-01-01', hasta: '2026-01-01' }, 1, hoy)).toEqual({ desde: '2026-01-01', hasta: '2027-01-01' });
    expect(desplazar({ desde: '2026-08-15', hasta: '2026-09-14' }, -1, hoy)).toEqual({ desde: '2026-07-16', hasta: '2026-08-15' });
  });
});

describe('tramos del grafico', () => {
  it('agrupa por dia, semana o mes segun el largo', () => {
    expect(granularidadDe({ desde: '2026-08-01', hasta: '2026-09-01' })).toBe('dia');
    expect(granularidadDe({ desde: '2026-06-01', hasta: '2026-09-01' })).toBe('semana');
    expect(granularidadDe({ desde: '2026-01-01', hasta: '2027-01-01' })).toBe('mes');
  });

  it('las semanas empiezan en lunes y se recortan a los bordes del rango', () => {
    // 2026-06-03 es miercoles.
    const r = { desde: '2026-06-03', hasta: '2026-06-20' };
    const tramos = tramosDe(r, 'semana');
    expect(tramos.map((t) => [t.desde, t.hasta])).toEqual([
      ['2026-06-03', '2026-06-08'],
      ['2026-06-08', '2026-06-15'],
      ['2026-06-15', '2026-06-20'],
    ]);
    expect(claveDeTramo('2026-06-05', r, 'semana')).toBe('2026-06-03');
    expect(claveDeTramo('2026-06-14', r, 'semana')).toBe('2026-06-08');
  });

  it('un ano tiene doce tramos mensuales', () => {
    expect(tramosDe({ desde: '2026-01-01', hasta: '2027-01-01' }, 'mes')).toHaveLength(12);
  });
});

describe('nombreDeRango', () => {
  it('nombra meses, anos y rangos libres', () => {
    expect(nombreDeRango({ desde: '2026-08-01', hasta: '2026-09-01' }, 'es')).toMatch(/^Agosto.*2026$/);
    expect(nombreDeRango({ desde: '2026-01-01', hasta: '2027-01-01' }, 'es')).toBe('2026');
    const libre = nombreDeRango({ desde: '2026-03-03', hasta: '2026-08-21' }, 'en');
    expect(libre).toContain('Mar');
    expect(libre).toContain('Aug');
    expect(libre).toContain('20');
  });
});
