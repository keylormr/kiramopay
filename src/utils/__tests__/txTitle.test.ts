import { describe, it, expect } from 'vitest';
import { txTitle } from '../txTitle';
import type { Transaction } from '@/types';

const t = (key: string) => {
  const claves: Record<string, string> = {
    tx_title_sinpe_receive: 'SINPE recibido',
    tx_title_generic_in: 'Dinero recibido',
    tx_title_generic_out: 'Dinero enviado',
  };
  return claves[key] || key;
};

const base: Transaction = {
  id: 't1',
  title: '',
  type: 'debit',
  amount: -1,
  ccy: 'CRC',
  description: '',
  date: '20/7/2026',
  status: 'completed',
  category: 'transfers',
};

describe('txTitle', () => {
  it('usa el titulo de la contraparte cuando existe', () => {
    expect(txTitle({ ...base, title: 'Victor Lobo' }, t)).toBe('Victor Lobo');
  });

  it('un UUID no es un titulo: cae al respaldo por tipo', () => {
    // El bug real: filas viejas guardaron el UUID en la descripcion y la
    // lista mostraba "b5f43f1a-..." como nombre del movimiento.
    const conUuid = {
      ...base,
      title: 'b5f43f1a-1f10-48a3-b516-e5bbeb69f832',
      description: 'b5f43f1a-1f10-48a3-b516-e5bbeb69f832',
    };
    expect(txTitle(conUuid, t)).toBe('Dinero enviado');
  });

  it('con UUID en titulo pero descripcion legible, gana la descripcion', () => {
    const tx = {
      ...base,
      title: 'b5f43f1a-1f10-48a3-b516-e5bbeb69f832',
      description: 'Pago de prueba',
    };
    expect(txTitle(tx, t)).toBe('Pago de prueba');
  });

  it('sin nada legible usa el tipo del movimiento', () => {
    expect(txTitle({ ...base, kind: 'sinpe_receive', type: 'credit' }, t)).toBe('SINPE recibido');
  });
});
