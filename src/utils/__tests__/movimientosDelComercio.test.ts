import type { QRPayment, RetiroDelComercio } from '@/api/repositories/qrpayment.repository';
import {
  agruparPorDia,
  claveDeDia,
  fusionarMovimientos,
  horaLocal,
  movimientoDeCobro,
  movimientoDeRetiro,
  rotuloDeDia,
} from '../movimientosDelComercio';

// Costa Rica: getTimezoneOffset() = 360 (minutos al oeste de UTC).
const CR = 360;

const cobro = (extra: Partial<QRPayment> = {}): QRPayment => ({
  id: 'c1', qrCodeId: 'q1', payerId: 'u2', receiverId: 'u1', merchantId: 'm1',
  amount: 1000, fee: 5, currency: 'CRC', status: 'completed', createdAt: '2026-10-29T07:00:00Z',
  ...extra,
});

const retiro = (extra: Partial<RetiroDelComercio> = {}): RetiroDelComercio => ({
  id: 'r1', amount: 500, currency: 'CRC', status: 'completed', createdAt: '2026-10-29T14:00:00Z',
  ...extra,
});

describe('movimientoDeCobro', () => {
  it('un cobro completado es un cobro, con su comision y su neto', () => {
    const m = movimientoDeCobro(cobro({ payerName: 'Ana Mora', locationName: 'Centro', collectorName: 'Luis Rojas' }));
    expect(m).toMatchObject({
      id: 'c1', tipo: 'cobro', moneda: 'CRC', monto: 1000, comision: 5, neto: 995, estado: 'completed',
      pagador: 'Ana Mora', sucursal: 'Centro', cajero: 'Luis Rojas',
    });
  });

  it('un cobro devuelto es una devolucion, no un cobro', () => {
    expect(movimientoDeCobro(cobro({ status: 'refunded' })).tipo).toBe('devolucion');
  });

  it('un cobro fallido o pendiente sigue siendo un cobro, con su estado', () => {
    expect(movimientoDeCobro(cobro({ status: 'failed' }))).toMatchObject({ tipo: 'cobro', estado: 'failed' });
    expect(movimientoDeCobro(cobro({ status: 'pending' }))).toMatchObject({ tipo: 'cobro', estado: 'pending' });
  });

  it('no inventa lo que el servidor no dio: sin nombres quedan sin definir', () => {
    const m = movimientoDeCobro(cobro());
    expect(m.pagador).toBeUndefined();
    expect(m.sucursal).toBeUndefined();
    expect(m.cajero).toBeUndefined();
    expect(m.sucursalId).toBeUndefined();
    expect(m.cajeroId).toBeUndefined();
  });

  it('conserva los identificadores para distinguir "sin sucursal" de "sin nombre"', () => {
    const m = movimientoDeCobro(cobro({ locationId: 'loc1', collectedBy: 'u9' }));
    expect(m.sucursalId).toBe('loc1');
    expect(m.sucursal).toBeUndefined();
    expect(m.cajeroId).toBe('u9');
  });

  it('la referencia es la transaccion del pago si la hay, y si no el id', () => {
    expect(movimientoDeCobro(cobro({ txId: 'tx-9' })).referencia).toBe('tx-9');
    expect(movimientoDeCobro(cobro()).referencia).toBe('c1');
  });
});

describe('movimientoDeRetiro', () => {
  it('un retiro no lleva comision: lo que sale es lo que se retira', () => {
    const m = movimientoDeRetiro(retiro({ withdrawnByName: 'Keilor Martinez' }));
    expect(m).toMatchObject({
      id: 'r1', tipo: 'retiro', moneda: 'CRC', monto: 500, comision: 0, neto: 500, estado: 'completed',
      retiradoPor: 'Keilor Martinez', referencia: 'r1',
    });
  });
});

describe('claveDeDia y la zona horaria', () => {
  it('el dia es el de quien mira, no el de UTC', () => {
    // 03:00 UTC del 29 son las 21:00 del 28 en Costa Rica.
    expect(claveDeDia('2026-10-29T03:00:00Z', CR)).toBe('2026-10-28');
    expect(claveDeDia('2026-10-29T07:00:00Z', CR)).toBe('2026-10-29');
    expect(claveDeDia('2026-10-29T03:00:00Z', 0)).toBe('2026-10-29');
  });

  it('cruza el fin de mes y de ano', () => {
    expect(claveDeDia('2026-11-01T04:00:00Z', CR)).toBe('2026-10-31');
    expect(claveDeDia('2027-01-01T05:59:00Z', CR)).toBe('2026-12-31');
  });

  it('una fecha invalida no revienta', () => {
    expect(claveDeDia('no-es-fecha', CR)).toBe('');
  });
});

describe('horaLocal', () => {
  it('la hora sale en la zona de quien mira y en el idioma de la app', () => {
    // 07:00 UTC = 01:00 en Costa Rica.
    const es = horaLocal('2026-10-29T07:00:00Z', CR, 'es');
    expect(es).toMatch(/^0?1:00/);
    const tarde = horaLocal('2026-10-29T21:30:00Z', CR, 'en');
    expect(tarde).toMatch(/3:30/);
  });
});

describe('agruparPorDia', () => {
  it('agrupa por el dia local, el mas reciente primero, y cada grupo conserva el orden', () => {
    const movs = [
      movimientoDeCobro(cobro({ id: 'a', createdAt: '2026-10-29T07:00:00Z' })),
      movimientoDeCobro(cobro({ id: 'b', createdAt: '2026-10-29T03:00:00Z' })), // 21:00 del 28 en CR
      movimientoDeCobro(cobro({ id: 'c', createdAt: '2026-10-28T20:00:00Z' })),
      movimientoDeCobro(cobro({ id: 'd', createdAt: '2026-10-05T12:00:00Z' })),
    ];
    const grupos = agruparPorDia(movs, CR);
    expect(grupos.map((g) => g.clave)).toEqual(['2026-10-29', '2026-10-28', '2026-10-05']);
    expect(grupos[0].movimientos.map((m) => m.id)).toEqual(['a']);
    expect(grupos[1].movimientos.map((m) => m.id)).toEqual(['b', 'c']);
  });

  it('sin movimientos no hay grupos', () => {
    expect(agruparPorDia([], CR)).toEqual([]);
  });
});

describe('fusionarMovimientos', () => {
  it('mezcla cobros y retiros por fecha, el mas reciente primero', () => {
    const lista = fusionarMovimientos(
      [cobro({ id: 'c-hoy', createdAt: '2026-10-29T07:00:00Z' }), cobro({ id: 'c-ayer', createdAt: '2026-10-28T20:00:00Z' })],
      [retiro({ id: 'r-hoy', createdAt: '2026-10-29T14:00:00Z' })],
      false,
    );
    expect(lista.map((m) => m.id)).toEqual(['r-hoy', 'c-hoy', 'c-ayer']);
    expect(lista.map((m) => m.tipo)).toEqual(['retiro', 'cobro', 'cobro']);
  });

  it('si faltan cobros por cargar, no muestra retiros mas viejos que el ultimo cobro cargado', () => {
    // Faltan cobros entre el ultimo cargado y ese retiro: mostrarlo pintaria una
    // lista a la que le faltan filas sin decirlo.
    const lista = fusionarMovimientos(
      [cobro({ id: 'c1', createdAt: '2026-10-29T07:00:00Z' })],
      [retiro({ id: 'r-viejo', createdAt: '2026-10-20T14:00:00Z' }), retiro({ id: 'r-nuevo', createdAt: '2026-10-29T14:00:00Z' })],
      true,
    );
    expect(lista.map((m) => m.id)).toEqual(['r-nuevo', 'c1']);
  });

  it('cuando ya se cargaron todos los cobros, entran todos los retiros', () => {
    const lista = fusionarMovimientos(
      [cobro({ id: 'c1', createdAt: '2026-10-29T07:00:00Z' })],
      [retiro({ id: 'r-viejo', createdAt: '2026-10-20T14:00:00Z' })],
      false,
    );
    expect(lista.map((m) => m.id)).toEqual(['c1', 'r-viejo']);
  });

  it('con faltantes y sin ningun cobro cargado, no se muestra ningun retiro', () => {
    expect(fusionarMovimientos([], [retiro()], true)).toEqual([]);
  });
});

describe('rotuloDeDia', () => {
  const t = (clave: string) => ({ business_day_today: 'Hoy', business_day_yesterday: 'Ayer' })[clave as 'business_day_today'] ?? clave;

  it('hoy y ayer llevan su nombre ademas de la fecha', () => {
    expect(rotuloDeDia('2026-10-29', '2026-10-29', 'es', t).relativo).toBe('Hoy');
    expect(rotuloDeDia('2026-10-28', '2026-10-29', 'es', t).relativo).toBe('Ayer');
  });

  it('otro dia lleva solo la fecha, en el idioma de la app', () => {
    const r = rotuloDeDia('2026-10-05', '2026-10-29', 'es', t);
    expect(r.relativo).toBeUndefined();
    expect(r.fecha).toMatch(/5/);
    expect(r.fecha.toLowerCase()).toContain('octubre');
  });

  it('ayer cruza el limite del mes', () => {
    expect(rotuloDeDia('2026-10-31', '2026-11-01', 'es', t).relativo).toBe('Ayer');
  });

  it('la fecha no depende de la zona del telefono', () => {
    expect(rotuloDeDia('2026-10-29', '2026-10-29', 'en', t).fecha.toLowerCase()).toContain('oct');
    expect(rotuloDeDia('2026-10-29', '2026-10-29', 'en', t).fecha).toContain('29');
  });
});
