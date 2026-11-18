import { aTexto, deTexto, type BovedaGuardada } from '../almacen';
import { leerLlave, llaveDeLaCuenta, textoDeLaLlave } from '../llaves';
import {
  anotarLlenado,
  ESPERA_TRAS_MOVER_MS,
  llenadoSinVer,
  movimientoVigente,
  sePuedeQuitar,
  type MovimientoReciente,
} from '../reglas';

// Lo que se movio hace poco: un envio tarda en verse en la red. Mientras tanto
// la boveda no se quita (se perderia lo que llega despues) y lo que va en
// camino cuenta para el tope.
const AHORA = Date.parse('2026-11-18T12:00:00.000Z');
const HACE = (ms: number) => new Date(AHORA - ms).toISOString();
const HORA = 60 * 60 * 1000;

describe('movimiento reciente', () => {
  it('dura 24 horas; una fecha ilegible o del futuro no libera nada', () => {
    expect(ESPERA_TRAS_MOVER_MS).toBe(24 * HORA);
    expect(movimientoVigente(undefined, AHORA)).toBe(false);
    expect(movimientoVigente({ en: HACE(23 * HORA) }, AHORA)).toBe(true);
    expect(movimientoVigente({ en: HACE(24 * HORA) }, AHORA)).toBe(false);
    expect(movimientoVigente({ en: '' }, AHORA)).toBe(true);
    expect(movimientoVigente({ en: 'ayer' }, AHORA)).toBe(true);
    expect(movimientoVigente({ en: new Date(AHORA + HORA).toISOString() }, AHORA)).toBe(true);
  });

  it('una boveda vacia se quita solo si nadie la movio hace poco', () => {
    expect(sePuedeQuitar(0, undefined, AHORA)).toBe(true);
    expect(sePuedeQuitar(1, undefined, AHORA)).toBe(false);
    expect(sePuedeQuitar(0, { en: HACE(HORA) }, AHORA)).toBe(false);
    expect(sePuedeQuitar(0, { en: HACE(25 * HORA) }, AHORA)).toBe(true);
  });

  it('un llenado cuenta hasta que su direccion aparece usada o pasa la espera', () => {
    const m: MovimientoReciente = { en: HACE(HORA), llenado: { indice: 2, sats: 300_000 } };
    // La red todavia ofrece el indice 2 como el siguiente: no lo vio.
    expect(llenadoSinVer(m, 2, AHORA)).toBe(300_000);
    // Ya lo vio: pasa a contar como confirmado o en camino, no dos veces.
    expect(llenadoSinVer(m, 3, AHORA)).toBe(0);
    expect(llenadoSinVer({ ...m, en: HACE(25 * HORA) }, 2, AHORA)).toBe(0);
    expect(llenadoSinVer({ en: HACE(HORA) }, 2, AHORA)).toBe(0);
  });

  it('dos llenados a la misma direccion sin ver se suman; uno ya visto no', () => {
    const primero = anotarLlenado(undefined, 2, 300_000, AHORA);
    expect(primero).toEqual({ en: new Date(AHORA).toISOString(), llenado: { indice: 2, sats: 300_000 } });
    expect(anotarLlenado(primero, 2, 200_000, AHORA).llenado).toEqual({ indice: 2, sats: 500_000 });
    // El anterior ya se vio (la red ofrece el 3): solo cuenta el nuevo.
    expect(anotarLlenado(primero, 3, 200_000, AHORA).llenado).toEqual({ indice: 3, sats: 200_000 });
    // Un reintento del mismo envio no suma de nuevo.
    expect(anotarLlenado(primero, 2, 0, AHORA).llenado).toEqual({ indice: 2, sats: 300_000 });
  });
});

describe('el movimiento se guarda con la boveda', () => {
  const boveda: BovedaGuardada = {
    red: 'bitcoin',
    titular: llaveDeLaCuenta('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'bitcoin'),
    heredero: leerLlave(textoDeLaLlave(llaveDeLaCuenta('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong', 'bitcoin')), 'bitcoin'),
    plazoBloques: 52_560,
    creada: '2026-11-18T12:00:00.000Z',
  };

  it('va y vuelve igual', () => {
    const con = { ...boveda, movimiento: { en: HACE(HORA), llenado: { indice: 1, sats: 5_000 } } };
    expect(deTexto(aTexto(con))).toEqual(con);
    expect(deTexto(aTexto(boveda))).toEqual(boveda);
  });

  it('uno ilegible queda vigente: la boveda no se suelta por un dato roto', () => {
    const roto = JSON.parse(aTexto(boveda)) as Record<string, unknown>;
    roto.mov = { en: 42, llenado: { indice: -1, sats: 'mucho' } };
    const leida = deTexto(JSON.stringify(roto));
    expect(leida.movimiento).toEqual({ en: '' });
    expect(movimientoVigente(leida.movimiento, AHORA)).toBe(true);
  });
});
