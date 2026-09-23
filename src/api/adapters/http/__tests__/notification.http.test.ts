import { HttpNotificationRepository } from '../notification.http';
import type { HttpClient } from '../client';

// La fecha se armaba aca con toLocaleDateString('es-CR'): la pantalla recibia
// "4/9/2026" ya escrito y no podia ponerlo en otro idioma (en ingles se lee 9
// de abril). El adaptador pasa tambien la fecha de maquina.
describe('HttpNotificationRepository.getAll', () => {
  it('pasa created_at como dateISO para que la pantalla la escriba en su idioma', async () => {
    const client = {
      get: async () => ({
        success: true,
        data: [{
          id: 'n1', user_id: 'u1', title: 'SINPE recibido', body: 'Te enviaron 5.000 colones',
          type: 'transaction', created_at: '2026-09-04T15:30:00Z',
        }],
      }),
    } as unknown as HttpClient;

    const res = await new HttpNotificationRepository(client).getAll();

    expect(res.success).toBe(true);
    expect((res.data?.[0] as { dateISO?: string } | undefined)?.dateISO).toBe('2026-09-04T15:30:00Z');
  });
});
