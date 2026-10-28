import { HttpEscrowRepository } from '../escrow.http';
import type { HttpClient } from '../client';

// El servidor ya mandaba cuando se fondeo, libero, devolvio o cancelo un
// acuerdo, y desde ahora el nombre de la otra parte. El adaptador solo pasaba
// las fechas de la entrega y la disputa, asi que el detalle no tenia con que
// mostrar el resto.

const crudo = {
  id: 'a1',
  buyer_id: 'buyer-1',
  seller_id: 'seller-1',
  amount_minor: 1500000,
  currency: 'CRC',
  status: 'released',
  description: 'Bicicleta',
  created_at: '2026-09-01T15:00:00Z',
  updated_at: '2026-09-05T15:00:00Z',
  funded_at: '2026-09-02T15:00:00Z',
  released_at: '2026-09-05T15:00:00Z',
  refunded_at: '2026-09-06T15:00:00Z',
  cancelled_at: '2026-09-07T15:00:00Z',
  counterparty_name: 'Luis Rojas',
};

function repoConElAcuerdo(datos: Record<string, unknown>) {
  const client = { get: async () => ({ success: true, data: datos }) } as unknown as HttpClient;
  return new HttpEscrowRepository(client);
}

describe('HttpEscrowRepository: fechas y contraparte', () => {
  it('get trae las fechas de cada paso y el nombre de la otra parte', async () => {
    const res = await repoConElAcuerdo(crudo).get('a1');

    expect(res.data?.fundedAt).toBe('2026-09-02T15:00:00Z');
    expect(res.data?.releasedAt).toBe('2026-09-05T15:00:00Z');
    expect(res.data?.refundedAt).toBe('2026-09-06T15:00:00Z');
    expect(res.data?.cancelledAt).toBe('2026-09-07T15:00:00Z');
    expect(res.data?.counterpartyName).toBe('Luis Rojas');
  });

  it('list lo trae igual', async () => {
    const res = await repoConElAcuerdo([crudo] as unknown as Record<string, unknown>).list();

    expect(res.data?.[0].releasedAt).toBe('2026-09-05T15:00:00Z');
    expect(res.data?.[0].counterpartyName).toBe('Luis Rojas');
  });

  it('lo que el servidor no manda queda sin definir', async () => {
    const minimo: Record<string, unknown> = { ...crudo };
    for (const clave of ['funded_at', 'released_at', 'refunded_at', 'cancelled_at', 'counterparty_name']) delete minimo[clave];
    const res = await repoConElAcuerdo(minimo).get('a1');

    expect(res.data?.fundedAt).toBeUndefined();
    expect(res.data?.releasedAt).toBeUndefined();
    expect(res.data?.counterpartyName).toBeUndefined();
  });
});
