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

  it('clasifica nombres de usuario y los pasa a minusculas', () => {
    expect(clasificarIdentificador('keilor')).toEqual({ tipo: 'usuario', canonico: 'keilor' });
    expect(clasificarIdentificador('Victor')).toEqual({ tipo: 'usuario', canonico: 'victor' });
    expect(clasificarIdentificador('  Demo  ')).toEqual({ tipo: 'usuario', canonico: 'demo' });
    expect(clasificarIdentificador('a.b_c-1')).toEqual({ tipo: 'usuario', canonico: 'a.b_c-1' });
    expect(clasificarIdentificador('kei')).toEqual({ tipo: 'usuario', canonico: 'kei' }); // el minimo
  });

  // Los cuatro espacios son disjuntos: si no lo fueran, alguien podria
  // registrar el usuario '702650930' y chocar con la cedula de otro.
  it('un nombre de usuario nunca invade el espacio de los otros tres', () => {
    for (const entrada of ['702650930', '1-2345-6789', '88880001', '+50688880001', 'a@b.co']) {
      expect(clasificarIdentificador(entrada)?.tipo).not.toBe('usuario');
    }
  });

  it('rechaza lo que no clasifica', () => {
    expect(clasificarIdentificador('')).toBeNull();
    expect(clasificarIdentificador('1234567')).toBeNull(); // 7 digitos
    expect(clasificarIdentificador('1234567890123')).toBeNull(); // 13 digitos
    expect(clasificarIdentificador('+123456789')).toBeNull(); // + sin 506
    expect(clasificarIdentificador('roto@')).toBeNull();
    expect(clasificarIdentificador('ab')).toBeNull(); // bajo el minimo de usuario
    expect(clasificarIdentificador('a' + 'b'.repeat(20))).toBeNull(); // sobre el maximo
    expect(clasificarIdentificador('1usuario')).toBeNull(); // no empieza por letra
    expect(clasificarIdentificador('con espacio')).toBeNull();
    expect(clasificarIdentificador('9'.repeat(300))).toBeNull();
  });
});
