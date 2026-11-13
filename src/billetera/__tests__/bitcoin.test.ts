import { describe, expect, it } from 'vitest';
import type { PrepareSendPaymentResponse } from '@breeztech/breez-sdk-spark/web';
import { bitcoinConfigurado, carpetaDeDatos, comisionDe, depositoSinSumar, opcionesDeEnvio } from '../bitcoin';

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

  it('guarda los datos de cada cuenta y de cada semilla aparte', () => {
    const hardhat = 'test test test test test test test test test test test junk';
    const cero = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    expect(carpetaDeDatos('u1', hardhat)).toBe('kiramopay-btc-u1-f39fd6e51a');
    expect(carpetaDeDatos('u1', cero)).not.toBe(carpetaDeDatos('u1', hardhat));
    expect(carpetaDeDatos('u2', hardhat)).not.toBe(carpetaDeDatos('u1', hardhat));
  });

  it('explica por que un deposito por la red de bitcoin no se sumo', () => {
    const base = { txid: 't', vout: 1, amountSats: 5000, isMature: true };
    expect(depositoSinSumar({ ...base, claimError: { type: 'maxDepositClaimFeeExceeded', tx: 't', vout: 1, requiredFeeSats: 700 } }))
      .toEqual({ txid: 't', vout: 1, sats: 5000, motivo: 'comision-alta', comisionSats: 700 });
    expect(depositoSinSumar({ ...base, claimError: { type: 'depositTooSmall', tx: 't', vout: 1 } }).motivo).toBe('muy-chico');
    expect(depositoSinSumar({ ...base, isMature: false }).motivo).toBe('esperando');
  });
});
