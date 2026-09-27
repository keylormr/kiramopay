import { describe, it, expect, beforeEach } from 'vitest';
import { MockSinpeRepository } from '../sinpe.mock';
import { MockServicesRepository } from '../services.mock';

// Lo que la demo anota al enviar un SINPE o al recargar llevaba solo el texto
// "Ahora": al volver a la pantalla seguia diciendo "Ahora" para siempre, y en
// espanol en cualquier idioma. Tiene que traer la fecha de maquina.
const esFecha = (iso: string | undefined) => !Number.isNaN(Date.parse(iso ?? ''));

beforeEach(() => {
  localStorage.clear();
});

describe('lo que anota la demo trae fecha de maquina', () => {
  it('un SINPE enviado, tambien cuando se vuelve a leer el historial', async () => {
    const repo = new MockSinpeRepository();

    await repo.send({ phone: '88881234', amount: 1000 });
    const historial = await repo.getHistory();

    expect(esFecha(historial.data?.[0].dateISO)).toBe(true);
  });

  it('una recarga, tambien cuando se vuelve a leer el historial', async () => {
    const repo = new MockServicesRepository();

    const hecha = await repo.recharge({ operatorId: 'kolbi', phone: '88880000', amount: 5000 });
    const historial = await repo.getRechargeHistory();

    expect(esFecha(hecha.data?.dateISO)).toBe(true);
    expect(esFecha(historial.data?.[0].dateISO)).toBe(true);
  });
});
