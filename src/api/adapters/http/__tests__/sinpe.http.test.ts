import { describe, it, expect, vi } from 'vitest';
import { HttpSinpeRepository } from '../sinpe.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as unknown as HttpClient;
}

describe('HttpSinpeRepository.addContact', () => {
  // Los contactos locales guardan "8888-1234" (sin +506); el backend exige
  // +506XXXXXXXX. Mandar la forma local tal cual era un 400 de formato
  // garantizado — el alta manual contra el backend real nunca funcionaba.
  it('normaliza el telefono del contacto antes de mandarlo al backend', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { id: 'srv-1', phone: '+50688881234', name: 'Diego Mora', bank: 'BAC', is_favorite: false },
    });
    const client = fakeClient({ post });
    const repo = new HttpSinpeRepository(client);

    await repo.addContact({ id: 'local-1', name: 'Diego Mora', phone: '8888-1234', bank: 'BAC' });

    expect(post).toHaveBeenCalledWith('/api/v1/sinpe/contacts', {
      phone: '+50688881234',
      name: 'Diego Mora',
      bank: 'BAC',
      is_favorite: false,
    });
  });

  // "Marcar como favorito" se perdía en silencio: el POST nunca lo mandaba,
  // así que quedaba en su default (false) sin importar lo que eligiera el
  // usuario en el formulario.
  it('manda is_favorite cuando el contacto se marca como favorito', async () => {
    const post = vi.fn().mockResolvedValue({
      success: true,
      data: { id: 'srv-1', phone: '+50688881234', name: 'Diego Mora', bank: 'BAC', is_favorite: true },
    });
    const client = fakeClient({ post });
    const repo = new HttpSinpeRepository(client);

    await repo.addContact({
      id: 'local-1',
      name: 'Diego Mora',
      phone: '8888-1234',
      bank: 'BAC',
      isFavorite: true,
    });

    expect(post).toHaveBeenCalledWith('/api/v1/sinpe/contacts', {
      phone: '+50688881234',
      name: 'Diego Mora',
      bank: 'BAC',
      is_favorite: true,
    });
  });

  // El servidor responde 409 CONTACT_EXISTS con el contacto existente en
  // `data`; el adaptador no puede aplanarlo a un ADD_FAILED generico o el
  // llamador pierde la unica pista de que era un duplicado.
  it('preserva el codigo CONTACT_EXISTS y el contacto existente del servidor', async () => {
    const post = vi.fn().mockResolvedValue({
      success: false,
      error: {
        code: 'CONTACT_EXISTS',
        message: 'ya tienes este numero guardado como contacto',
        data: { id: 'srv-1', phone: '+50688881234', name: 'Diego Mora', bank: 'BAC' },
      },
    });
    const client = fakeClient({ post });
    const repo = new HttpSinpeRepository(client);

    const res = await repo.addContact({ id: 'local-1', name: 'Otro Nombre', phone: '8888-1234' });

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('CONTACT_EXISTS');
    expect(res.error?.data).toEqual({
      id: 'srv-1',
      phone: '+50688881234',
      name: 'Diego Mora',
      bank: 'BAC',
    });
  });

  it('cae a ADD_FAILED cuando el servidor no manda codigo propio', async () => {
    const post = vi.fn().mockResolvedValue({ success: false, error: { message: 'boom' } });
    const client = fakeClient({ post });
    const repo = new HttpSinpeRepository(client);

    const res = await repo.addContact({ id: 'local-1', name: 'Ana', phone: '8888-1234' });

    expect(res.success).toBe(false);
    expect(res.error?.code).toBe('ADD_FAILED');
  });
});
