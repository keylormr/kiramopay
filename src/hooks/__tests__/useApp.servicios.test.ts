import { act, renderHook } from '@testing-library/react';
import { useApp } from '../useApp';
import { useTransactionStore } from '@/stores/transaction.store';
import type { Bill, Recharge } from '@/types';

// La fila que se anota al pagar un servicio o recargar un telefono se titulaba
// "Pago <proveedor>" / "Recarga <telefono>", con la palabra fija en espanol en
// cualquier idioma, y no llevaba fecha de maquina: la lista la mostraba
// "Ahora" para siempre. Se titula con la contraparte, como la fila del servidor,
// lleva su tipo (la lista lo traduce) y su fecha.

beforeEach(() => {
  useTransactionStore.setState({ transactions: [] });
});

const factura: Bill = {
  id: 'b1', providerId: 'ice', providerName: 'ICE', clientId: '123', amount: 1500,
  dueDate: '2026-10-30', period: '2026-10', status: 'paid',
};

const recarga: Recharge = {
  id: 'r1', operatorId: 'kolbi', phone: '88881234', amount: 2000,
  date: 'Ahora', dateISO: '2026-10-15T12:00:00.000Z', status: 'completed',
};

describe('useApp — la fila local de un pago de servicio y de una recarga', () => {
  it('el pago de un servicio se titula con el proveedor, dice su tipo y su fecha', () => {
    const { result } = renderHook(() => useApp());
    act(() => result.current.dispatch({ type: 'ADD_BILL_PAYMENT', payload: factura }));
    const fila = useTransactionStore.getState().transactions[0];
    expect(fila.title).toBe('ICE');
    expect(fila.kind).toBe('bill_payment');
    expect(Number.isNaN(Date.parse(fila.dateISO ?? ''))).toBe(false);
  });

  it('la recarga se titula con el telefono, dice su tipo y lleva la fecha de la recarga', () => {
    const { result } = renderHook(() => useApp());
    act(() => result.current.dispatch({ type: 'ADD_RECHARGE', payload: recarga }));
    const fila = useTransactionStore.getState().transactions[0];
    expect(fila.title).toBe('88881234');
    expect(fila.kind).toBe('recharge');
    expect(fila.dateISO).toBe('2026-10-15T12:00:00.000Z');
  });
});
