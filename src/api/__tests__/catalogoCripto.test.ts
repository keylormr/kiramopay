import { describe, it, expect } from 'vitest';
import { catalogoCripto, fusionarConCatalogo } from '../catalogoCripto';
import type { CryptoAsset } from '@/types';

function tenencia(symbol: string, balance: number): CryptoAsset {
  return {
    id: symbol.toLowerCase(),
    symbol,
    name: symbol,
    icon: symbol.toLowerCase(),
    color: '#000000',
    balance,
    avgBuyPrice: 100,
    currentPrice: 0,
    priceChange24h: 0,
    priceHistory: [],
  };
}

describe('catalogoCripto', () => {
  it('trae las 10 monedas del backend con saldo cero', () => {
    const cat = catalogoCripto();
    expect(cat.map((c) => c.symbol)).toEqual([
      'BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'AVAX', 'LINK', 'MATIC', 'UNI', 'ATOM',
    ]);
    expect(cat.every((c) => c.balance === 0)).toBe(true);
  });
});

describe('fusionarConCatalogo', () => {
  it('con tenencias vacias el catalogo completo queda disponible (el caso del usuario nuevo)', () => {
    const resultado = fusionarConCatalogo([]);
    expect(resultado).toHaveLength(10);
    expect(resultado.find((a) => a.symbol === 'BTC')).toBeTruthy();
  });

  it('una tenencia real reemplaza a su entrada del catalogo', () => {
    const resultado = fusionarConCatalogo([tenencia('BTC', 0.5)]);
    expect(resultado).toHaveLength(10);
    expect(resultado.find((a) => a.symbol === 'BTC')?.balance).toBe(0.5);
    expect(resultado.find((a) => a.symbol === 'ETH')?.balance).toBe(0);
  });

  it('nunca esconde una tenencia de un simbolo fuera del catalogo', () => {
    const resultado = fusionarConCatalogo([tenencia('DOGE', 1000)]);
    expect(resultado).toHaveLength(11);
    expect(resultado.find((a) => a.symbol === 'DOGE')?.balance).toBe(1000);
  });
});
