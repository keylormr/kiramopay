import { describe, it, expect } from 'vitest';
import { clasificarIdentificador } from './identificador';

describe('clasificarIdentificador', () => {
  it('clasifica cedulas con y sin formato', () => {
    expect(clasificarIdentificador('702650930')).toEqual({ tipo: 'cedula', canonico: '702650930' });
    expect(clasificarIdentificador('1-2345-6789')).toEqual({ tipo: 'cedula', canonico: '123456789' });
    expect(clasificarIdentificador(' 702650930 ')).toEqual({ tipo: 'cedula', canonico: '702650930' });
    expect(clasificarIdentificador('123456789012')).toEqual({ tipo: 'cedula', canonico: '123456789012' });
  });

  it('clasifica telefonos en todas sus formas', () => {
    expect(clasificarIdentificador('88880001')).toEqual({ tipo: 'telefono', canonico: '+50688880001' });
    expect(clasificarIdentificador('8888-0001')).toEqual({ tipo: 'telefono', canonico: '+50688880001' });
    expect(clasificarIdentificador('+50688880001')).toEqual({ tipo: 'telefono', canonico: '+50688880001' });
    expect(clasificarIdentificador('50688880001')).toEqual({ tipo: 'telefono', canonico: '+50688880001' });
    expect(clasificarIdentificador('506 8888 0001')).toEqual({ tipo: 'telefono', canonico: '+50688880001' });
  });

  it('clasifica correos y los canonicaliza a minusculas', () => {
    expect(clasificarIdentificador('Keilor@Example.COM')).toEqual({ tipo: 'correo', canonico: 'keilor@example.com' });
    expect(clasificarIdentificador('  a@b.co  ')).toEqual({ tipo: 'correo', canonico: 'a@b.co' });
  });

  it('once digitos que empiezan en 506 son telefono, no cedula (igual que el backend)', () => {
    expect(clasificarIdentificador('50688880001')?.tipo).toBe('telefono');
  });

  it('rechaza lo que no clasifica', () => {
    expect(clasificarIdentificador('')).toBeNull();
    expect(clasificarIdentificador('1234567')).toBeNull(); // 7 digitos
    expect(clasificarIdentificador('1234567890123')).toBeNull(); // 13 digitos
    expect(clasificarIdentificador('+123456789')).toBeNull(); // + sin 506
    expect(clasificarIdentificador('hola')).toBeNull();
    expect(clasificarIdentificador('roto@')).toBeNull();
    expect(clasificarIdentificador('9'.repeat(300))).toBeNull();
  });
});
