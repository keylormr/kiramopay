import { describe, expect, it } from 'vitest';
import type { PrepareSendPaymentResponse } from '@breeztech/breez-sdk-spark/web';
import { bitcoinConfigurado, comisionDe, opcionesDeEnvio } from '../bitcoin';

function preparado(paymentMethod: unknown): PrepareSendPaymentResponse {
  return { paymentMethod, amount: 1000n, feePolicy: 'feesExcluded' } as PrepareSendPaymentResponse;
}

const cotizacion = {
  id: 'q', expiresAt: 0, isEstimate: false,
  speedFast: { userFeeSat: 900, l1BroadcastFeeSat: 100 },
  speedMedium: { userFeeSat: 500, l1BroadcastFeeSat: 60 },
  speedSlow: { userFeeSat: 200, l1BroadcastFeeSat: 30 },
};

describe('bitcoin en la billetera propia', () => {
  it('sin la llave de Breez queda sin configurar', () => {
    expect(bitcoinConfigurado()).toBe(false);
  });

  it('en la red de bitcoin cobra y usa la velocidad media', () => {
    const r = preparado({ type: 'bitcoinAddress', address: {}, feeQuote: cotizacion });
    expect(comisionDe(r)).toBe(560);
    expect(opcionesDeEnvio(r)).toEqual({ type: 'bitcoinAddress', confirmationSpeed: 'medium' });
  });

  it('una factura de alguien en Spark sale por Spark con su comision', () => {
    const r = preparado({ type: 'bolt11Invoice', invoiceDetails: {}, sparkTransferFeeSats: 0, lightningFeeSats: 7 });
    expect(comisionDe(r)).toBe(0);
    expect(opcionesDeEnvio(r)).toEqual({ type: 'bolt11Invoice', preferSpark: true });
  });

  it('una factura de fuera de Spark sale por Lightning con su comision', () => {
    const r = preparado({ type: 'bolt11Invoice', invoiceDetails: {}, lightningFeeSats: 7 });
    expect(comisionDe(r)).toBe(7);
    expect(opcionesDeEnvio(r)).toEqual({ type: 'bolt11Invoice', preferSpark: false });
  });

  it('a una direccion Spark cobra la comision de Spark', () => {
    const r = preparado({ type: 'sparkAddress', address: 'sp1', fee: 3n });
    expect(comisionDe(r)).toBe(3);
    expect(opcionesDeEnvio(r)).toBeUndefined();
  });
});
