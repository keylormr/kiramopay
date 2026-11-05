import { HttpSinpeRepository } from '../sinpe.http';
import type { HttpClient } from '../client';

// La consulta del nombre registrado a un telefono (POST, para que el numero no
// quede en la URL). El servidor exige +506XXXXXXXX; los contactos locales se
// guardan como "8888-1234".

function repo(respuesta: unknown) {
  const post = vi.fn(async () => respuesta);
  const client = { post } as unknown as HttpClient;
  return { repositorio: new HttpSinpeRepository(client), post };
}

describe('HttpSinpeRepository.lookupRecipient', () => {
  it('manda el telefono normalizado por POST y devuelve el nombre registrado', async () => {
    const { repositorio, post } = repo({ success: true, data: { registered: true, display_name: 'Keilor M. R.' } });

    const res = await repositorio.lookupRecipient('8888-0000');

    expect(post).toHaveBeenCalledWith('/api/v1/sinpe/recipient', { phone: '+50688880000' });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ registered: true, displayName: 'Keilor M. R.' });
  });

  it('un numero sin cuenta sale sin nombre', async () => {
    const { repositorio } = repo({ success: true, data: { registered: false } });

    const res = await repositorio.lookupRecipient('+50688880000');

    expect(res.data).toEqual({ registered: false, displayName: undefined });
  });

  it('conserva el codigo del servidor en un rechazo (limite, numero propio, base caida)', async () => {
    const { repositorio } = repo({ success: false, error: { code: 'RATE_LIMITED', message: 'x' } });

    const res = await repositorio.lookupRecipient('88880000');

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('RATE_LIMITED');
  });

  it('un numero que no se puede normalizar se manda tal cual y llega el rechazo del servidor', async () => {
    const { repositorio, post } = repo({ success: false, error: { code: 'INVALID_PHONE', message: 'x' } });

    const res = await repositorio.lookupRecipient('123');

    expect(post).toHaveBeenCalledWith('/api/v1/sinpe/recipient', { phone: '123' });
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('INVALID_PHONE');
  });
});
