import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Cada prueba carga el modulo de nuevo: guarda en memoria si el almacenamiento
// fallo, y eso no tiene que pasar de una prueba a otra.
type Modulo = typeof import('../intentoPendiente');
let m: Modulo;

async function cargar(): Promise<Modulo> {
  vi.resetModules();
  return import('../intentoPendiente');
}

let contador = 0;
const nueva = () => `llave-${++contador}`;

beforeEach(async () => {
  localStorage.clear();
  m = await cargar();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('intentoPendiente', () => {
  it('reintentar lo mismo da la misma llave; otra firma da otra', () => {
    const primera = m.llaveDelIntento('ana', 'sinpe', '+50688887777|5000', nueva);
    expect(primera).toMatch(/\S/);
    expect(m.llaveDelIntento('ana', 'sinpe', '+50688887777|5000', nueva)).toBe(primera);
    expect(m.llaveDelIntento('ana', 'sinpe', '+50688887777|6000', nueva)).not.toBe(primera);
  });

  // Había una sola casilla por ámbito: otro envío en medio —otra tarjeta del
  // asistente, un SINPE desde otra pantalla— reemplazaba la llave del que se
  // cortó, y reintentar ese con los mismos datos lo mandaba dos veces.
  it('otro intento en medio no pisa el pendiente: volver a él da su llave', () => {
    const deAna = m.llaveDelIntento('ana', 'sinpe', '+50688887777|5000', nueva);
    const deBeto = m.llaveDelIntento('ana', 'sinpe', '+50677776666|3000', nueva);
    m.soltarIntento('ana', 'sinpe', deBeto);
    expect(m.llaveDelIntento('ana', 'sinpe', '+50688887777|5000', nueva)).toBe(deAna);
  });

  it('guarda unos pocos por ámbito: pasado el tope se olvida el más viejo', () => {
    const primera = m.llaveDelIntento('ana', 'sinpe', 'firma-0', nueva);
    let ultima = '';
    for (let i = 1; i <= 30; i++) ultima = m.llaveDelIntento('ana', 'sinpe', `firma-${i}`, nueva);
    expect(m.llaveDelIntento('ana', 'sinpe', 'firma-30', nueva)).toBe(ultima);
    expect(m.llaveDelIntento('ana', 'sinpe', 'firma-0', nueva)).not.toBe(primera);
  });

  it('va por persona: otra persona con la misma firma no recibe la llave', () => {
    const deAna = m.llaveDelIntento('ana', 'sinpe', '+50688887777|5000', nueva);
    expect(m.llaveDelIntento('beto', 'sinpe', '+50688887777|5000', nueva)).not.toBe(deAna);
    expect(m.llaveDelIntento('ana', 'sinpe', '+50688887777|5000', nueva)).toBe(deAna);
  });

  it('va por ambito: el retiro de un comercio no toca el envio SINPE', () => {
    const envio = m.llaveDelIntento('ana', 'sinpe', 'x', nueva);
    m.llaveDelIntento('ana', 'retiro|m1', 'y', nueva);
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).toBe(envio);
  });

  it('sobrevive a recargar la app', async () => {
    const antes = m.llaveDelIntento('ana', 'sinpe', 'x', nueva);
    const recargado = await cargar();
    expect(recargado.llaveDelIntento('ana', 'sinpe', 'x', nueva)).toBe(antes);
  });

  it('soltar con la llave suelta solo ese intento', () => {
    const llave = m.llaveDelIntento('ana', 'sinpe', 'x', nueva);
    m.soltarIntento('ana', 'sinpe', 'otra-llave');
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).toBe(llave);

    m.soltarIntento('ana', 'sinpe', llave);
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).not.toBe(llave);
  });

  it('cerrar sesion los olvida todos', () => {
    const llave = m.llaveDelIntento('ana', 'sinpe', 'x', nueva);
    m.olvidarIntentos();
    expect(localStorage.getItem('kiramopay-intentos-pendientes')).toBeNull();
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).not.toBe(llave);
  });

  it('sin almacenamiento sigue funcionando en memoria', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqueado');
    });
    const llave = m.llaveDelIntento('ana', 'sinpe', 'x', nueva);
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).toBe(llave);
  });

  it('con la cuota llena sigue funcionando en memoria', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const llave = m.llaveDelIntento('ana', 'sinpe', 'x', nueva);
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).toBe(llave);
  });

  it('un valor ilegible cuenta como vacio y se pisa', () => {
    localStorage.setItem('kiramopay-intentos-pendientes', '{roto');
    const llave = m.llaveDelIntento('ana', 'sinpe', 'x', nueva);
    expect(llave).toMatch(/\S/);
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).toBe(llave);
  });

  it('una forma que no se entiende cuenta como vacía y se pisa', () => {
    localStorage.setItem('kiramopay-intentos-pendientes', JSON.stringify({ 'ana|sinpe': 42 }));
    const llave = m.llaveDelIntento('ana', 'sinpe', 'x', nueva);
    expect(llave).toMatch(/\S/);
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).toBe(llave);
  });
});
