import { esHojaSuperior, registrarCapa, retroceder } from '../pilaDeCapas';

// La aplicacion no usaba el historial: Atras del navegador sacaba del sitio
// desde cualquier pantalla (a una pagina en blanco), incluso con la
// confirmacion de un envio abierta. Estas pruebas fijan el contrato de la pila.

const esperar = (ms = 60) => new Promise((resolver) => setTimeout(resolver, ms));

const profundidad = (): number =>
  (window.history.state as { kiramopayCapas?: number } | null)?.kiramopayCapas ?? 0;

describe('pilaDeCapas', () => {
  afterEach(async () => {
    // Cada prueba deja la pila vacia; se espera a que el historial vuelva a la base.
    await esperar();
  });

  it('abrir una capa empuja una entrada y cerrarla por su cuenta la consume', async () => {
    const capa = registrarCapa('hoja', vi.fn());
    await esperar();
    expect(profundidad()).toBe(1);

    capa.quitar();
    await esperar();
    expect(profundidad()).toBe(0);
  });

  it('Atras cierra solo la capa de arriba', async () => {
    const cerrarPantalla = vi.fn();
    const cerrarHoja = vi.fn();
    const pantalla = registrarCapa('pantalla', cerrarPantalla);
    const hoja = registrarCapa('hoja', () => {
      cerrarHoja();
      hoja.quitar();
    });
    await esperar();
    expect(profundidad()).toBe(2);

    window.history.back();
    await esperar();
    expect(cerrarHoja).toHaveBeenCalledTimes(1);
    expect(cerrarPantalla).not.toHaveBeenCalled();
    expect(profundidad()).toBe(1);

    pantalla.quitar();
    await esperar();
    expect(profundidad()).toBe(0);
  });

  it('una capa con una operacion en vuelo no se cierra y repone su entrada', async () => {
    const cerrar = vi.fn();
    const capa = registrarCapa('hoja', cerrar, () => false);
    await esperar();

    window.history.back();
    await esperar();
    expect(cerrar).not.toHaveBeenCalled();
    expect(profundidad()).toBe(1);

    capa.quitar();
    await esperar();
    expect(profundidad()).toBe(0);
  });

  it('cerrar una hoja y abrir otra en el mismo toque no mueve el historial', async () => {
    const confirmar = registrarCapa('hoja', vi.fn());
    await esperar();
    const entradas = window.history.length;

    confirmar.quitar();
    const exito = registrarCapa('hoja', vi.fn());
    await esperar();
    expect(profundidad()).toBe(1);
    expect(window.history.length).toBe(entradas);

    exito.quitar();
    await esperar();
    expect(profundidad()).toBe(0);
  });

  it('Escape cierra la hoja de arriba y deja las pestanas para Atras', async () => {
    const cerrarSeccion = vi.fn();
    const cerrarHoja = vi.fn();
    const seccion = registrarCapa('seccion', cerrarSeccion);
    const hoja = registrarCapa('hoja', () => {
      cerrarHoja();
      hoja.quitar();
    });
    await esperar();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await esperar();
    expect(cerrarHoja).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    await esperar();
    expect(cerrarSeccion).not.toHaveBeenCalled();

    seccion.quitar();
  });

  it('solo la hoja mas reciente es la superior', async () => {
    const abajo = registrarCapa('hoja', vi.fn());
    const arriba = registrarCapa('hoja', vi.fn());
    expect(esHojaSuperior(arriba.id)).toBe(true);
    expect(esHojaSuperior(abajo.id)).toBe(false);

    arriba.quitar();
    expect(esHojaSuperior(abajo.id)).toBe(true);
    abajo.quitar();
  });

  it('sin nada abierto, el atras programatico avisa que no hizo nada', () => {
    expect(retroceder()).toBe(false);
  });
});
