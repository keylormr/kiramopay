import { takeResetToken } from '../resetToken';

function irA(url: string) {
  window.history.replaceState(null, '', url);
}

describe('takeResetToken', () => {
  it('devuelve el token y lo borra de la URL', () => {
    irA('/?reset_token=abc123');

    expect(takeResetToken()).toBe('abc123');
    expect(window.location.search).toBe('');
    expect(window.location.href).not.toContain('abc123');
  });

  it('conserva los demás parámetros', () => {
    irA('/?lang=es&reset_token=abc123&ref=correo');

    expect(takeResetToken()).toBe('abc123');
    expect(window.location.search).toContain('lang=es');
    expect(window.location.search).toContain('ref=correo');
    expect(window.location.search).not.toContain('reset_token');
  });

  it('conserva el hash de la ruta', () => {
    irA('/?reset_token=abc123#seccion');

    expect(takeResetToken()).toBe('abc123');
    expect(window.location.hash).toBe('#seccion');
  });

  it('devuelve cadena vacía cuando no hay token', () => {
    irA('/?lang=es');

    expect(takeResetToken()).toBe('');
    expect(window.location.search).toBe('?lang=es');
  });

  // Una segunda lectura no puede recuperarlo: es la prueba de que la limpieza
  // ocurrió, y la razón por la que el componente lo guarda en estado.
  it('no lo devuelve dos veces', () => {
    irA('/?reset_token=abc123');

    expect(takeResetToken()).toBe('abc123');
    expect(takeResetToken()).toBe('');
  });

  // Un token con caracteres que se codifican en la URL debe llegar intacto al
  // backend; decodificarlo mal daría un "código inválido" engañoso.
  it('decodifica el token tal como viaja en la URL', () => {
    irA('/?reset_token=' + encodeURIComponent('a+b/c=d'));

    expect(takeResetToken()).toBe('a+b/c=d');
  });
});
