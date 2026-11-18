import { HttpCryptoRepository } from '../crypto.http';
import type { HttpClient } from '../client';

function clientReturning(data: unknown): HttpClient {
  return { get: async () => ({ success: true, data }) } as unknown as HttpClient;
}

// La boveda de herencia se ofrece solo si el servidor lo dice: un servidor
// viejo no conoce la bandera y no tiene la espera resuelta.
describe('HttpCryptoRepository.getAvailability: boveda de herencia', () => {
  it('la ofrece cuando el servidor dice true', async () => {
    const res = await new HttpCryptoRepository(
      clientReturning({ purchases_active: true, self_custody_active: true, inheritance_vault_active: true }),
    ).getAvailability();
    expect(res.data).toEqual({ purchasesActive: true, selfCustodyActive: true, inheritanceVaultActive: true });
  });

  it('no la ofrece si el servidor no la menciona o dice false', async () => {
    const viejo = await new HttpCryptoRepository(
      clientReturning({ purchases_active: true, self_custody_active: true }),
    ).getAvailability();
    expect(viejo.data?.inheritanceVaultActive).toBe(false);
    const cerrado = await new HttpCryptoRepository(
      clientReturning({ purchases_active: true, self_custody_active: true, inheritance_vault_active: false }),
    ).getAvailability();
    expect(cerrado.data?.inheritanceVaultActive).toBe(false);
  });
});
