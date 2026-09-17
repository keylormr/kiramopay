import { describe, it, expect } from 'vitest';
import { txTitle } from '../txTitle';
import type { Transaction } from '@/types';

const t = (key: string) => {
  const claves: Record<string, string> = {
    tx_title_sinpe_receive: 'SINPE recibido',
    tx_title_generic_in: 'Dinero recibido',
    tx_title_generic_out: 'Dinero enviado',
    tx_title_savings_deposit: 'Depósito a ahorro',
    tx_title_savings_withdraw: 'Retiro de ahorro',
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

  // Hallazgo QA (17-09): el backend escribe la descripcion de los movimientos
  // de ahorro SIEMPRE en ingles y sin traducir ("savings deposit: <meta>"), y
  // como nunca viene vacia, la prioridad "propio > tipo" la dejaba pasar tal
  // cual en cualquier idioma. El tipo del movimiento manda aca, y el nombre de
  // la meta que trae la descripcion se conserva en el titulo traducido.
  describe('movimientos de ahorro: el tipo manda sobre la descripcion cruda del backend', () => {
    it('un deposito a una meta arma el titulo traducido con el nombre de la meta', () => {
      const tx: Transaction = {
        ...base,
        kind: 'savings_deposit',
        title: 'savings deposit: Meta prueba QA',
        description: 'savings deposit: Meta prueba QA',
      };
      expect(txTitle(tx, t)).toBe('Depósito a ahorro: Meta prueba QA');
    });

    it('un retiro de una meta arma el titulo traducido con el nombre de la meta', () => {
      const tx: Transaction = {
        ...base,
        kind: 'savings_withdraw',
        title: 'savings withdraw: Meta prueba QA',
        description: 'savings withdraw: Meta prueba QA',
      };
      expect(txTitle(tx, t)).toBe('Retiro de ahorro: Meta prueba QA');
    });

    it('sin el nombre de la meta (prefijo sin nada detras) usa solo el titulo generico', () => {
      const tx: Transaction = {
        ...base,
        kind: 'savings_deposit',
        title: 'savings deposit: ',
        description: 'savings deposit: ',
      };
      expect(txTitle(tx, t)).toBe('Depósito a ahorro');
    });
  });
});
