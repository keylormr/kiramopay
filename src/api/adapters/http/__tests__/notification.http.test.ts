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

// Los avisos se guardan ya escritos, en el idioma que la cuenta tenia ese dia:
// los anteriores a la migracion 074 estan en espanol. La lista se pide en el
// idioma de la pantalla (?lang=) y el servidor reescribe los que reconoce.
describe('HttpNotificationRepository.getAll: idioma', () => {
  const vacio = () => vi.fn().mockResolvedValue({ success: true, data: [] });

  beforeEach(() => {
    localStorage.clear();
  });

  it('pide la lista en el idioma que la persona eligio', async () => {
    localStorage.setItem('kiramopay_language', 'fr');
    const get = vacio();
    await new HttpNotificationRepository({ get } as unknown as HttpClient).getAll();
    expect(get).toHaveBeenCalledWith('/api/v1/notifications?lang=fr');
  });

  it('sin eleccion guardada, en el que usa la pantalla (el del navegador, ingles en la prueba)', async () => {
    const get = vacio();
    await new HttpNotificationRepository({ get } as unknown as HttpClient).getAll();
    expect(get).toHaveBeenCalledWith('/api/v1/notifications?lang=en');
  });

  it('el idioma de chino simplificado va como lo conoce el servidor', async () => {
    localStorage.setItem('kiramopay_language', 'zh-cn');
    const get = vacio();
    await new HttpNotificationRepository({ get } as unknown as HttpClient).getAll();
    expect(get).toHaveBeenCalledWith('/api/v1/notifications?lang=zh-cn');
  });
});

// Ocultar una notificacion (la pantalla dice "eliminar"; el servidor la oculta
// y el registro queda). La ruta lleva el id escapado, y el codigo del rechazo
// es el del servidor: antes se pisaba con DELETE_FAILED.
describe('HttpNotificationRepository.delete', () => {
  it('pide DELETE sobre esa notificacion, con el id escapado', async () => {
    const del = vi.fn().mockResolvedValue({ success: true });

    const res = await new HttpNotificationRepository({ del } as unknown as HttpClient).delete('n 1/x');

    expect(del).toHaveBeenCalledWith('/api/v1/notifications/n%201%2Fx');
    expect(res.success).toBe(true);
  });

  it('el codigo del rechazo es el del servidor', async () => {
    const del = vi.fn().mockResolvedValue({
      success: false,
      error: { code: 'NOTIFICATION_NOT_FOUND', message: 'notification not found' },
    });

    const res = await new HttpNotificationRepository({ del } as unknown as HttpClient).delete('n1');

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('NOTIFICATION_NOT_FOUND');
  });
});
