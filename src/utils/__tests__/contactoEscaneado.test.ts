import { describe, expect, it } from 'vitest';
import { avisoDeHomonimo, evaluarContactoEscaneado } from '../contactoEscaneado';
import type { SinpeContact } from '@/types/sinpe.types';

// El nombre de un QR de contacto lo escribe quien lo creo y nadie lo comprueba:
// un QR "de Mama" con el numero de otra persona llega igual por chat que uno
// de verdad. Lo unico que la app puede contrastar sin servidor es lo que la
// persona YA guardo.

const guardado = (name: string, phone: string): SinpeContact => ({
  id: name,
  name,
  phone,
  bank: 'BAC',
  isFavorite: false,
});

describe('evaluarContactoEscaneado', () => {
  it('un contacto desconocido queda con el nombre del QR, marcado sin verificar', () => {
    const r = evaluarContactoEscaneado({ name: 'Ana Solís', phone: '+506 8888-7777' }, [
      guardado('Pedro', '+506 7000-1111'),
    ]);

    expect(r.nombre).toBe('Ana Solís');
    expect(r.nombreSinVerificar).toBe(true);
    expect(r.homonimo).toBeUndefined();
  });

  it('un QR con el nombre de un contacto guardado y OTRO numero se marca como homonimo', () => {
    const mama = guardado('Mamá', '+506 7000-1111');
    const r = evaluarContactoEscaneado({ name: 'Mamá', phone: '+506 8888-7777' }, [mama]);

    expect(r.homonimo).toBe(mama);
    expect(r.nombreSinVerificar).toBe(true);
  });

  it('el homonimo no distingue mayusculas, tildes ni espacios de mas', () => {
    const mama = guardado('Mamá', '+506 7000-1111');
    const r = evaluarContactoEscaneado({ name: '  MAMA  ', phone: '+506 8888-7777' }, [mama]);
    expect(r.homonimo).toBe(mama);

    const rosa = guardado('María  José', '+506 7000-2222');
    const r2 = evaluarContactoEscaneado({ name: 'maria jose', phone: '+506 8888-7777' }, [rosa]);
    expect(r2.homonimo).toBe(rosa);
  });

  // Un nombre que se ve IGUAL en pantalla pero no lo es para el codigo: un
  // espacio de ancho cero, un guion suave o letras de ancho completo cuestan un
  // caracter y evitarian el aviso que existe justo para frenar la suplantacion.
  it('el homonimo tampoco se evade con caracteres invisibles ni de ancho completo', () => {
    const mama = guardado('Mamá', '+506 7000-1111');
    const disfraces = [
      'Mam​á', // espacio de ancho cero
      'Ma­má', // guion suave
      'Ma⁠má', // union de palabras
      '﻿Mamá', // marca de orden de bytes
      'M‌amá', // sin union de ancho cero
      'ＭＡＭＡ', // ancho completo
      'Mamá', // tilde como marca combinante: ya se toleraba
    ];
    for (const nombre of disfraces) {
      const r = evaluarContactoEscaneado({ name: nombre, phone: '+506 8888-7777' }, [mama]);
      expect(r.homonimo, JSON.stringify(nombre)).toBe(mama);
    }
  });

  it('un nombre distinto sigue siendo distinto aunque se parezca', () => {
    const mama = guardado('Mamá', '+506 7000-1111');
    for (const nombre of ['Mamá de Ana', 'Mama2', 'Mamas', 'Papá']) {
      const r = evaluarContactoEscaneado({ name: nombre, phone: '+506 8888-7777' }, [mama]);
      expect(r.homonimo, nombre).toBeUndefined();
    }
  });

  it('un numero ya guardado muestra el nombre GUARDADO, no el que traiga el QR', () => {
    const pedro = guardado('Pedro', '+506 8888-7777');
    // El QR dice otro nombre para un numero que la persona ya conoce como Pedro.
    const r = evaluarContactoEscaneado({ name: 'Banco Nacional', phone: '88887777' }, [pedro]);

    expect(r.nombre).toBe('Pedro');
    expect(r.nombreSinVerificar).toBe(false);
    expect(r.homonimo).toBeUndefined();
  });

  it('el mismo nombre con el MISMO numero no es homonimo: es el contacto de siempre', () => {
    const mama = guardado('Mamá', '+506 7000-1111');
    const r = evaluarContactoEscaneado({ name: 'Mamá', phone: '70001111' }, [mama]);

    expect(r.homonimo).toBeUndefined();
    expect(r.nombre).toBe('Mamá');
    expect(r.nombreSinVerificar).toBe(false);
  });

  describe('avisoDeHomonimo', () => {
    const plantilla = 'Ya tienes un contacto llamado «{nombre}» con otro número ({telefono}).';

    it('pone el nombre guardado y el numero con formato', () => {
      expect(avisoDeHomonimo(plantilla, guardado('Mamá', '+50670001111'))).toBe(
        'Ya tienes un contacto llamado «Mamá» con otro número (+506 7000-1111).',
      );
    });

    it('un nombre con simbolos de reemplazo o con otro marcador sale tal cual', () => {
      const nombre = "Tienda $& $' $$ {telefono}";
      expect(avisoDeHomonimo(plantilla, guardado(nombre, '+50670001111'))).toBe(
        `Ya tienes un contacto llamado «${nombre}» con otro número (+506 7000-1111).`,
      );
    });
  });

  it('con la lista de contactos vacia no hay nada que contrastar', () => {
    const r = evaluarContactoEscaneado({ name: 'Mamá', phone: '+506 8888-7777' }, []);
    expect(r).toEqual({ nombre: 'Mamá', nombreSinVerificar: true, homonimo: undefined });
  });
});
