import { URL_APP, enlaceInvitacion, compartirEnlace } from '../compartir';

// jsdom no trae navigator.share ni navigator.clipboard: cada prueba define lo
// que necesita y lo retira al terminar.
function definir(nombre: 'share' | 'clipboard', valor: unknown) {
  Object.defineProperty(navigator, nombre, { value: valor, configurable: true, writable: true });
}

function quitar(nombre: 'share' | 'clipboard') {
  Reflect.deleteProperty(navigator, nombre);
}

describe('enlaceInvitacion', () => {
  it('arma el enlace con el código', () => {
    expect(enlaceInvitacion('K7PM3XQ2')).toBe('https://kiramopay.com/?ref=K7PM3XQ2');
  });

  it('sin código devuelve la portada', () => {
    expect(enlaceInvitacion()).toBe(URL_APP);
    expect(enlaceInvitacion('')).toBe(URL_APP);
  });
});

describe('compartirEnlace', () => {
  afterEach(() => {
    quitar('share');
    quitar('clipboard');
  });

  it('usa la hoja nativa cuando navigator.share existe', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    definir('share', share);

    await expect(compartirEnlace('Prueba', 'https://kiramopay.com/?ref=K7PM3XQ2')).resolves.toBe('compartido');
    expect(share).toHaveBeenCalledWith({
      title: 'KiramoPay',
      text: 'Prueba',
      url: 'https://kiramopay.com/?ref=K7PM3XQ2',
    });
  });

  it('cae al portapapeles cuando navigator.share no existe', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    definir('clipboard', { writeText });

    await expect(compartirEnlace('Prueba', 'https://kiramopay.com')).resolves.toBe('copiado');
    expect(writeText).toHaveBeenCalledWith('Prueba https://kiramopay.com');
  });

  it('cae al portapapeles cuando el usuario cancela la hoja nativa', async () => {
    definir('share', vi.fn().mockRejectedValue(new Error('AbortError')));
    const writeText = vi.fn().mockResolvedValue(undefined);
    definir('clipboard', { writeText });

    await expect(compartirEnlace('Prueba', 'https://kiramopay.com')).resolves.toBe('copiado');
  });

  it("devuelve 'nada' sin hoja nativa ni portapapeles", async () => {
    await expect(compartirEnlace('Prueba', 'https://kiramopay.com')).resolves.toBe('nada');
  });
});
