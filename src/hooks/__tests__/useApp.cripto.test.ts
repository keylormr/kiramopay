import { act, renderHook } from '@testing-library/react';
import { useApp } from '../useApp';
import { useCryptoStore } from '@/stores/crypto.store';
import { useAccountStore } from '@/stores/account.store';
import type { Account, CryptoAsset, CryptoTransaction } from '@/types';

// Comprar, vender y convertir anotan en el estado el movimiento que devolvio el
// servidor. Antes armaban uno propio con el estimado de la pantalla y un id
// inventado ("ctx-..."): la fila y los saldos mostraban otra cantidad hasta que
// llegaba la lista del servidor, y si esa carga fallaba, se quedaban asi.

const activo = (symbol: string, balance: number, precio: number): CryptoAsset => ({
  id: symbol.toLowerCase(),
  symbol,
  name: symbol,
  icon: symbol[0],
  color: '#123456',
  balance,
  avgBuyPrice: precio,
  currentPrice: precio,
  priceChange24h: 0,
  priceHistory: [],
});

const cuenta = (ccy: string, balance: number): Account => ({
  ccy,
  balance,
  symbol: ccy,
  flag: '',
  iban: '',
  name: ccy,
  type: 'fiat',
});

const movimiento = (datos: Partial<CryptoTransaction>): CryptoTransaction => ({
  id: 'sin-id',
  type: 'buy',
  fromAsset: '',
  fromAmount: 0,
  price: 0,
  priceCurrency: 'USD',
  fee: 0,
  date: '2026-09-23T13:00:00Z',
  status: 'completed',
  ...datos,
});

const saldoCripto = (symbol: string) =>
  useCryptoStore.getState().assets.find((a) => a.symbol === symbol)?.balance;
const saldoFiat = (ccy: string) =>
  useAccountStore.getState().accounts.find((a) => a.ccy === ccy)?.balance;

beforeEach(() => {
  useCryptoStore.setState({
    assets: [activo('BTC', 0.5, 40000), activo('ETH', 2, 2500)],
    transactions: [],
  });
  useAccountStore.setState({ accounts: [cuenta('USD', 100), cuenta('CRC', 1_000_000)] });
});

describe('el estado anota el movimiento del servidor', () => {
  it('compra: la fila es la del servidor y el saldo sube lo que el servidor dio', () => {
    const compra = movimiento({
      id: '6f1c2a90-0000-4000-8000-000000000001', type: 'buy', fromAsset: 'USD', fromAmount: 10,
      toAsset: 'BTC', toAmount: 0.00024938, price: 40100,
    });
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'BUY_CRYPTO', payload: compra }));

    expect(useCryptoStore.getState().transactions[0]).toEqual(compra);
    expect(saldoCripto('BTC')).toBeCloseTo(0.50024938, 10);
    expect(saldoFiat('USD')).toBe(90);
  });

  it('venta: la cuenta recibe lo que acredito el servidor', () => {
    const venta = movimiento({
      id: '6f1c2a90-0000-4000-8000-000000000002', type: 'sell', fromAsset: 'BTC', fromAmount: 0.1,
      toAsset: 'CRC', toAmount: 2_060_000, price: 20_600_000, priceCurrency: 'CRC',
    });
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'SELL_CRYPTO', payload: venta }));

    expect(useCryptoStore.getState().transactions[0]).toEqual(venta);
    expect(saldoCripto('BTC')).toBeCloseTo(0.4, 10);
    expect(saldoFiat('CRC')).toBe(3_060_000);
  });

  it('conversion: el destino sube lo que el servidor dio', () => {
    const conversion = movimiento({
      id: '6f1c2a90-0000-4000-8000-000000000003', type: 'convert', fromAsset: 'BTC', fromAmount: 0.1,
      toAsset: 'ETH', toAmount: 1.58, price: 2531.65,
    });
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'CONVERT_CRYPTO', payload: conversion }));

    expect(useCryptoStore.getState().transactions[0]).toEqual(conversion);
    expect(saldoCripto('BTC')).toBeCloseTo(0.4, 10);
    expect(saldoCripto('ETH')).toBeCloseTo(3.58, 10);
  });
});
