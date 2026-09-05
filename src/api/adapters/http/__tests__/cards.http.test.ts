import { HttpCardsRepository } from '../cards.http';
import type { HttpClient } from '../client';

// El limite de gasto de una tarjeta se enviaba con `valor ? valor * 100 :
// undefined`. Cero es falso, asi que poner el limite en 0 —la forma de dejar
// la tarjeta sin margen— viajaba como "no cambiar nada": la hoja se cerraba
// sin error y la tarjeta seguia con el limite anterior.
describe('HttpCardsRepository.updateLimits', () => {
  function espia() {
    const enviado: { url?: string; body?: unknown } = {};
    const client = {
      patch: async (url: string, body: unknown) => {
        enviado.url = url;
        enviado.body = body;
        return { success: true };
      },
    } as unknown as HttpClient;
    return { client, enviado };
  }

  it('un limite de 0 se envia como 0, no se descarta', async () => {
    const { client, enviado } = espia();
    await new HttpCardsRepository(client).updateLimits('c1', { dailyLimit: 0, atmLimit: 0 });
    const body = enviado.body as Record<string, unknown>;
    expect(body.daily_limit).toBe(0);
    expect(body.atm_limit).toBe(0);
  });

  it('un limite ausente sigue viajando como undefined: no se toca lo que no se pidio cambiar', async () => {
    const { client, enviado } = espia();
    await new HttpCardsRepository(client).updateLimits('c1', { dailyLimit: 250 });
    const body = enviado.body as Record<string, unknown>;
    expect(body.daily_limit).toBe(25000); // centimos
    expect(body.monthly_limit).toBeUndefined();
    expect(body.atm_limit).toBeUndefined();
  });

  it('convierte a centimos sin arrastrar el error de la coma flotante', async () => {
    const { client, enviado } = espia();
    await new HttpCardsRepository(client).updateLimits('c1', { dailyLimit: 1234.56 });
    expect((enviado.body as Record<string, unknown>).daily_limit).toBe(123456);
  });
});
