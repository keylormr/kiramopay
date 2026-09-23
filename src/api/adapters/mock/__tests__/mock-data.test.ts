import { describe, it, expect } from 'vitest';
import { initialSinpeHistory } from '../mock-data';

// La demo fechaba sus SINPE solo con texto en espanol ("Hoy, 2:30 PM"): en
// ingles se leian en espanol. La pantalla muestra la fecha de maquina en el
// idioma de la app; cada fila de ejemplo tiene que traerla.
describe('semilla de la demo — SINPE', () => {
  it('cada SINPE de ejemplo trae una fecha de maquina valida', () => {
    for (const fila of initialSinpeHistory) {
      expect(Number.isNaN(Date.parse(fila.dateISO ?? '')), fila.id).toBe(false);
    }
  });
});
