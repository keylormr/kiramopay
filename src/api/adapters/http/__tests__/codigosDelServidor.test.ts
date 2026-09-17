import { HttpMarketplaceRepository } from '../marketplace.http';
import { HttpCryptoRepository } from '../crypto.http';
import { HttpCountryRepository } from '../country.http';
import { HttpBudgetRepository } from '../budget.http';
import { HttpRecurringRepository } from '../recurring.http';
import { HttpB2BRepository } from '../b2b.http';
import type { HttpClient } from '../client';

// Estos adaptadores REEMPLAZABAN el codigo de error del servidor por uno
// generico, asi que el motivo real nunca llegaba a la pantalla: el usuario veia
// "no se pudo comprar" sin saber por que. Se corrigio, pero nada lo probaba —
// las vistas mockean el adaptador, asi que revertir el arreglo dejaba la suite
// entera en verde. Estas pruebas son lo que hace que el arreglo se quede.
//
// Los codigos que importan: SIN_INTEGRACION (el cobro se rechaza porque no hay
// convenio con el socio) y PRICE_STALE (el precio de cripto esta vencido y no
// se ejecuta la orden contra un numero muerto).
function clienteQueFalla(code: string, message = 'del servidor'): HttpClient {
  const fallo = async () => ({ success: false, error: { code, message } });
  return { get: fallo, post: fallo, put: fallo, patch: fallo, del: fallo } as unknown as HttpClient;
}

describe('los adaptadores conservan el codigo de error del servidor', () => {
  describe('marketplace', () => {
    const casos: Array<[string, (r: HttpMarketplaceRepository) => Promise<{ error?: { code: string } }>]> = [
      ['createRide', (r) => r.createRide({ pickup: 'a', dropoff: 'b' } as never)],
      ['confirmRide', (r) => r.confirmRide('ride-1')],
      ['createFoodOrder', (r) => r.createFoodOrder({ restaurantId: 'r1', items: [] } as never)],
    ];

    it.each(casos)('%s deja pasar SIN_INTEGRACION', async (_nombre, llamar) => {
      const repo = new HttpMarketplaceRepository(clienteQueFalla('SIN_INTEGRACION'));
      const res = await llamar(repo);
      expect(res.error?.code).toBe('SIN_INTEGRACION');
    });

    it.each(casos)('%s cae a su codigo propio cuando el servidor no manda ninguno', async (_n, llamar) => {
      const sinCodigo = async () => ({ success: false, error: { message: 'boom' } });
      const repo = new HttpMarketplaceRepository(
        { get: sinCodigo, post: sinCodigo, put: sinCodigo, patch: sinCodigo, del: sinCodigo } as unknown as HttpClient,
      );
      const res = await llamar(repo);
      // Cualquiera de los genericos sirve; lo que no puede es quedar vacio.
      expect(res.error?.code).toBeTruthy();
    });
  });

  describe('cripto', () => {
    const casos: Array<[string, (r: HttpCryptoRepository) => Promise<{ error?: { code: string } }>]> = [
      ['buy', (r) => r.buy({ asset: 'BTC', fromAmount: 1000, fromCurrency: 'CRC' } as never)],
      ['sell', (r) => r.sell({ asset: 'BTC', amount: 0.01, toCurrency: 'CRC' } as never)],
      ['convert', (r) => r.convert({ fromAsset: 'BTC', toAsset: 'ETH', amount: 0.01 } as never)],
    ];

    it.each(casos)('%s deja pasar PRICE_STALE', async (_nombre, llamar) => {
      const repo = new HttpCryptoRepository(clienteQueFalla('PRICE_STALE'));
      const res = await llamar(repo);
      expect(res.error?.code).toBe('PRICE_STALE');
    });

    it.each(casos)('%s deja pasar MFA_REQUIRED', async (_nombre, llamar) => {
      const repo = new HttpCryptoRepository(clienteQueFalla('MFA_REQUIRED'));
      const res = await llamar(repo);
      expect(res.error?.code).toBe('MFA_REQUIRED');
    });

    it.each(casos)('%s deja pasar CRYPTO_INSUFFICIENT_BALANCE', async (_nombre, llamar) => {
      const repo = new HttpCryptoRepository(clienteQueFalla('CRYPTO_INSUFFICIENT_BALANCE'));
      const res = await llamar(repo);
      expect(res.error?.code).toBe('CRYPTO_INSUFFICIENT_BALANCE');
    });

    // Staking y retiro pisaban el codigo con STAKE_FAILED y UNSTAKE_FAILED: la
    // pantalla solo tenia el texto en ingles para decidir, y lo mostraba.
    const deStaking: Array<[string, string, (r: HttpCryptoRepository) => Promise<{ error?: { code: string } }>]> = [
      ['stake', 'STAKING_NOT_AVAILABLE', (r) => r.stake({ asset: 'USDT', amount: 1, locked: false })],
      ['stake', 'CRYPTO_INSUFFICIENT_BALANCE', (r) => r.stake({ asset: 'ETH', amount: 1, locked: false })],
      ['unstake', 'STAKING_POSITION_NOT_FOUND', (r) => r.unstake('stake-1789326379706')],
      ['unstake', 'STAKING_POSITION_LOCKED', (r) => r.unstake('pos-1')],
    ];

    it.each(deStaking)('%s deja pasar %s', async (_nombre, codigo, llamar) => {
      const repo = new HttpCryptoRepository(clienteQueFalla(codigo));
      const res = await llamar(repo);
      expect(res.error?.code).toBe(codigo);
    });
  });

  // Misma politica en la remesa a otro pais: sin corresponsal que la entregue,
  // el servidor la rechaza con SIN_CORRESPONSAL y ese codigo tiene que llegar
  // entero a la pantalla.
  describe('remesa a otro pais', () => {
    it('sendCrossBorder deja pasar SIN_CORRESPONSAL', async () => {
      const repo = new HttpCountryRepository(clienteQueFalla('SIN_CORRESPONSAL'));
      const res = await repo.sendCrossBorder({
        receiverPhone: '88887777', toCountry: 'PA', amount: 5000, currency: 'CRC',
      } as never);
      expect(res.error?.code).toBe('SIN_CORRESPONSAL');
    });

    it('sendCrossBorder cae a su codigo propio cuando el servidor no manda ninguno', async () => {
      const sinCodigo = async () => ({ success: false, error: { message: 'boom' } });
      const repo = new HttpCountryRepository(
        { get: sinCodigo, post: sinCodigo, put: sinCodigo, patch: sinCodigo, del: sinCodigo } as unknown as HttpClient,
      );
      const res = await repo.sendCrossBorder({
        receiverPhone: '88887777', toCountry: 'PA', amount: 5000, currency: 'CRC',
      } as never);
      expect(res.error?.code).toBe('TRANSFER_FAILED');
    });
  });

  // Presupuestos, pagos fijos y la plataforma de comercios: las pantallas
  // traducen por codigo; con uno fijo, "ya no existe" y "el nombre es muy
  // largo" eran el mismo mensaje.
  const sinCodigo = async () => ({ success: false, error: { message: 'boom' } });
  const clienteSinCodigo = { get: sinCodigo, post: sinCodigo, put: sinCodigo, patch: sinCodigo, del: sinCodigo } as unknown as HttpClient;

  describe('presupuestos', () => {
    const casos: Array<[string, (r: HttpBudgetRepository) => Promise<{ error?: { code: string } }>, string]> = [
      ['getBudgets', (r) => r.getBudgets(), 'FETCH_FAILED'],
      ['create', (r) => r.create({ label: 'Comida', amount_limit: 1000 }), 'CREATE_FAILED'],
      ['update', (r) => r.update('b1', { amount_spent: 10 }), 'UPDATE_FAILED'],
      ['delete', (r) => r.delete('b1'), 'DELETE_FAILED'],
      ['resetAll', (r) => r.resetAll(), 'RESET_FAILED'],
    ];

    it.each(casos)('%s deja pasar el codigo del servidor', async (_n, llamar) => {
      const res = await llamar(new HttpBudgetRepository(clienteQueFalla('BUDGET_NOT_FOUND')));
      expect(res.error?.code).toBe('BUDGET_NOT_FOUND');
    });

    it.each(casos)('%s cae a su codigo propio sin codigo del servidor', async (_n, llamar, propio) => {
      const res = await llamar(new HttpBudgetRepository(clienteSinCodigo));
      expect(res.error?.code).toBe(propio);
    });
  });

  describe('pagos fijos', () => {
    const casos: Array<[string, (r: HttpRecurringRepository) => Promise<{ error?: { code: string } }>, string]> = [
      ['getPayments', (r) => r.getPayments(), 'FETCH_FAILED'],
      ['create', (r) => r.create({ label: 'Luz', type: 'service', amount: 1, frequency: 'monthly', next_date: '2026-10-05' }), 'CREATE_FAILED'],
      ['update', (r) => r.update('p1', { amount: 10 }), 'UPDATE_FAILED'],
      ['delete', (r) => r.delete('p1'), 'DELETE_FAILED'],
      ['toggle', (r) => r.toggle('p1'), 'TOGGLE_FAILED'],
      ['markPaid', (r) => r.markPaid('p1'), 'MARK_PAID_FAILED'],
    ];

    it.each(casos)('%s deja pasar el codigo del servidor', async (_n, llamar) => {
      const res = await llamar(new HttpRecurringRepository(clienteQueFalla('RECURRING_NOT_FOUND')));
      expect(res.error?.code).toBe('RECURRING_NOT_FOUND');
    });

    it.each(casos)('%s cae a su codigo propio sin codigo del servidor', async (_n, llamar, propio) => {
      const res = await llamar(new HttpRecurringRepository(clienteSinCodigo));
      expect(res.error?.code).toBe(propio);
    });
  });

  describe('claves API y webhooks', () => {
    const casos: Array<[string, (r: HttpB2BRepository) => Promise<{ error?: { code: string } }>]> = [
      ['listKeys', (r) => r.listKeys()],
      ['createKey', (r) => r.createKey('Tienda')],
      ['revokeKey', (r) => r.revokeKey('k1')],
      ['listWebhooks', (r) => r.listWebhooks()],
      ['createWebhook', (r) => r.createWebhook('https://example.com/hook', '*')],
      ['deleteWebhook', (r) => r.deleteWebhook('w1')],
      ['listDeliveries', (r) => r.listDeliveries('w1')],
    ];

    it.each(casos)('%s deja pasar B2B_NOT_FOUND', async (_n, llamar) => {
      const res = await llamar(new HttpB2BRepository(clienteQueFalla('B2B_NOT_FOUND')));
      expect(res.error?.code).toBe('B2B_NOT_FOUND');
    });

    it.each(casos)('%s nunca queda sin codigo', async (_n, llamar) => {
      const res = await llamar(new HttpB2BRepository(clienteSinCodigo));
      expect(res.error?.code).toMatch(/^B2B_/);
    });
  });
});
