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

  it('guarda unos pocos por ámbito: pasado el tope se olvida el que lleva más sin usarse', () => {
    const primera = m.llaveDelIntento('ana', 'sinpe', 'firma-0', nueva);
    let ultima = '';
    for (let i = 1; i <= 30; i++) ultima = m.llaveDelIntento('ana', 'sinpe', `firma-${i}`, nueva);
    expect(m.llaveDelIntento('ana', 'sinpe', 'firma-30', nueva)).toBe(ultima);
    expect(m.llaveDelIntento('ana', 'sinpe', 'firma-0', nueva)).not.toBe(primera);
  });

  // El desalojo era por creación: una llave reintentada seguía siendo la más
  // vieja, y con diez intentos distintos después se olvidaba aunque se acabara
  // de reintentar. El siguiente reintento llevaba otra llave y mandaba la
  // plata dos veces.
  it('reintentar un pendiente lo renueva: no es el primero en olvidarse', () => {
    const cortado = m.llaveDelIntento('ana', 'sinpe', '+50688887777|5000', nueva);
    for (let i = 0; i < 5; i++) m.llaveDelIntento('ana', 'sinpe', `+5067777000${i}|1000`, nueva);
    expect(m.llaveDelIntento('ana', 'sinpe', '+50688887777|5000', nueva)).toBe(cortado);
    for (let i = 5; i < 10; i++) m.llaveDelIntento('ana', 'sinpe', `+5067777000${i}|1000`, nueva);
    expect(m.llaveDelIntento('ana', 'sinpe', '+50688887777|5000', nueva)).toBe(cortado);
  });

  it('guarda varios pendientes a la vez: los cinco siguen', () => {
    const llaves = Array.from({ length: 5 }, (_, i) =>
      m.llaveDelIntento('ana', 'sinpe', `f-${i}`, nueva),
    );
    llaves.forEach((llave, i) =>
      expect(m.llaveDelIntento('ana', 'sinpe', `f-${i}`, nueva)).toBe(llave),
    );
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

  // La llave sobrevive a cerrar sesión (ver limpiarDatosDeUsuario), así que
  // lo que queda en el aparato no puede decir nada: ni quién, ni a qué número,
  // ni cuánto. Antes se borraba al salir porque guardaba todo eso tal cual.
  it('no guarda nada legible: ni la persona, ni el número, ni el monto', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    m.llaveDelIntento('persona-7f3a', 'sinpe', '+50688881234|73519', nueva);
    m.llaveDelIntento('persona-7f3a', 'retiro|comercio-9c1', 'comercio-9c1|300|CRC', nueva);
    const guardado = localStorage.getItem('kiramopay-intentos-pendientes') ?? '';
    expect(guardado).not.toBe('');
    for (const rastro of ['persona-7f3a', '88881234', '73519', 'comercio-9c1', 'sinpe', 'retiro']) {
      expect(guardado).not.toContain(rastro);
    }
  });

  // Dura un día desde su último uso: alcanza para reintentar después de
  // volver a entrar, y no se queda para siempre en el aparato.
  it('vence: un día sin usarse, la misma firma lleva otra llave', () => {
    const ahora = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const llave = m.llaveDelIntento('ana', 'sinpe', 'x', nueva);
    ahora.mockReturnValue(1_700_000_000_000 + 24 * 3_600_000 + 1);
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).not.toBe(llave);
  });

  // Un reloj que se atrasa no borra lo pendiente: se fecha de nuevo en el
  // ahora del aparato. Descartarlo perdía la llave de un envío cortado, y el
  // reintento lo mandaba dos veces.
  it('con el reloj atrasado más de un día, la llave se conserva', () => {
    const ahora = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const llave = m.llaveDelIntento('ana', 'sinpe', 'x', nueva);
    ahora.mockReturnValue(1_700_000_000_000 - 3 * 24 * 3_600_000);
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).toBe(llave);
  });

  it('reintentar renueva el plazo', () => {
    const ahora = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const llave = m.llaveDelIntento('ana', 'sinpe', 'x', nueva);
    ahora.mockReturnValue(1_700_000_000_000 + 23 * 3_600_000);
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).toBe(llave);
    ahora.mockReturnValue(1_700_000_000_000 + 46 * 3_600_000);
    expect(m.llaveDelIntento('ana', 'sinpe', 'x', nueva)).toBe(llave);
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

  // La forma de antes guardaba la persona y la firma tal cual. Si una version
  // la dejo escrita, no se usa y la siguiente escritura la borra.
  it('la forma de antes, legible, no se usa y desaparece al escribir', () => {
    localStorage.setItem(
      'kiramopay-intentos-pendientes',
      JSON.stringify({ 'ana|sinpe': [{ firma: '+50688881234|73519', llave: 'vieja' }] }),
    );
    expect(m.llaveDelIntento('ana', 'sinpe', '+50688881234|73519', nueva)).not.toBe('vieja');
    const guardado = localStorage.getItem('kiramopay-intentos-pendientes') ?? '';
    expect(guardado).not.toContain('88881234');
    expect(guardado).not.toContain('ana');
  });
});
