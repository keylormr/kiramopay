import { describe, it, expect } from 'vitest';
import { fusionConArrays, comoLista } from '../fusionPersistida';

interface Estado {
  transactions: number[];
  contactos: string[];
  moneda: string;
}

const inicial: Estado = { transactions: [], contactos: [], moneda: 'CRC' };

describe('fusionConArrays', () => {
  const fusion = fusionConArrays<Estado>(['transactions', 'contactos']);

  it('respeta lo guardado cuando tiene la forma esperada', () => {
    const r = fusion({ transactions: [1, 2], contactos: ['a'], moneda: 'USD' }, inicial);
    expect(r.transactions).toEqual([1, 2]);
    expect(r.contactos).toEqual(['a']);
    expect(r.moneda).toBe('USD');
  });

  // El caso que tumbaba la aplicacion: una porcion vieja o a medias devuelve
  // algo que no es arreglo, y la vista que la recorre lanza en el render.
  it('descarta un campo que no rehidrata como arreglo', () => {
    const corruptos: unknown[] = [null, undefined, {}, 'no soy un arreglo', 42, { 0: 'a', length: 1 }];
    for (const valor of corruptos) {
      const r = fusion({ transactions: valor } as Partial<Estado>, inicial);
      expect(Array.isArray(r.transactions), `con ${JSON.stringify(valor)}`).toBe(true);
      expect(r.transactions).toEqual([]);
    }
  });

  it('no toca los campos que no son de arreglo', () => {
    const r = fusion({ moneda: 'USD' }, inicial);
    expect(r.moneda).toBe('USD');
  });

  it('aguanta que no haya nada guardado', () => {
    expect(fusion(undefined, inicial)).toEqual(inicial);
    expect(fusion(null, inicial)).toEqual(inicial);
  });

  it('deja pasar el resto de lo guardado sin inventarse nada', () => {
    const r = fusion({ moneda: 'EUR', transactions: 'rota' } as unknown as Partial<Estado>, inicial);
    expect(r.moneda).toBe('EUR');
    expect(r.transactions).toEqual([]);
  });
});

describe('comoLista', () => {
  it('devuelve lo que ya es un arreglo', () => {
    const xs = [1, 2, 3];
    expect(comoLista(xs)).toBe(xs);
  });

  it('convierte en arreglo vacio cualquier otra cosa', () => {
    expect(comoLista(null)).toEqual([]);
    expect(comoLista(undefined)).toEqual([]);
    expect(comoLista({ length: 2 } as unknown as number[])).toEqual([]);
    expect(comoLista('texto' as unknown as string[])).toEqual([]);
  });
});
