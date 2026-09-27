import { act, renderHook } from '@testing-library/react';
import { useApp } from '../useApp';
import { useTransactionStore } from '@/stores/transaction.store';
import type { SinpeTransaction } from '@/types';

// La fila que se anota al enviar o recibir un SINPE se titulaba "SINPE a
// <nombre>" / "SINPE de <nombre>", con el conector fijo en espanol en cualquier
// idioma, hasta que llegaba la lista del servidor, que la titula con el nombre
// de la contraparte. La fila local se titula igual que la del servidor.

const sinpe = (datos: Partial<SinpeTransaction>): SinpeTransaction => ({
  id: 's1',
  type: 'sent',
  amount: 1000,
  phone: '88881234',
  name: 'Juan Perez',
  date: 'Ahora',
  dateISO: '2026-09-27T15:00:00Z',
  status: 'completed',
  ...datos,
});

beforeEach(() => {
  useTransactionStore.setState({ transactions: [] });
});

describe('useApp — la fila local de un SINPE', () => {
  it('uno enviado se titula con el nombre de quien lo recibe, sin conector en espanol', () => {
    const { result } = renderHook(() => useApp());

    act(() => result.current.dispatch({ type: 'ADD_SINPE_TRANSACTION', payload: sinpe({ type: 'sent' }) }));

    expect(useTransactionStore.getState().transactions[0].title).toBe('Juan Perez');
  });

  it('uno recibido se titula con el nombre de quien lo manda', () => {
    const { result } = renderHook(() => useApp());

    act(() =>
      result.current.dispatch({ type: 'ADD_SINPE_TRANSACTION', payload: sinpe({ type: 'received', name: 'Ana Mora' }) }),
    );

    expect(useTransactionStore.getState().transactions[0].title).toBe('Ana Mora');
  });
});
