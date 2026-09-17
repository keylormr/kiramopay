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

  // El adaptador HTTP no conoce los iconos: ponia "btc" dentro del circulo.
  it('de la tenencia toma el saldo y el costo; la cara es la del catalogo', () => {
    const btc = fusionarConCatalogo([tenencia('BTC', 0.5)]).find((a) => a.symbol === 'BTC')!;
    expect(btc).toMatchObject({ balance: 0.5, avgBuyPrice: 100, icon: '₿', color: '#F7931A', name: 'Bitcoin' });
  });

  it('una estable que vuelve de una posicion vieja de staking tambien tiene cara', () => {
    const usdt = fusionarConCatalogo([tenencia('USDT', 25)]).find((a) => a.symbol === 'USDT')!;
    expect(usdt).toMatchObject({ balance: 25, icon: '₮', name: 'Tether' });
    const doge = fusionarConCatalogo([tenencia('DOGE', 1)]).find((a) => a.symbol === 'DOGE')!;
    expect(doge.icon).toBe('doge');
  });
});
