import { takeReferralCode, normalizarCodigoInvitacion, clearReferralCode } from '../referralCode';

function irA(url: string) {
  window.history.replaceState(null, '', url);
}

describe('takeReferralCode', () => {
  beforeEach(() => {
    sessionStorage.clear();
    irA('/');
  });

  it('devuelve el código y lo borra de la URL', () => {
    irA('/?ref=K7PM3XQ2');

    expect(takeReferralCode()).toBe('K7PM3XQ2');
    expect(window.location.search).toBe('');
    expect(window.location.href).not.toContain('K7PM3XQ2');
  });

  it('conserva los demás parámetros', () => {
    irA('/?lang=es&ref=K7PM3XQ2&utm=correo');

    expect(takeReferralCode()).toBe('K7PM3XQ2');
    expect(window.location.search).toContain('lang=es');
    expect(window.location.search).toContain('utm=correo');
    expect(window.location.search).not.toContain('ref=');
  });

  it('conserva el hash de la ruta', () => {
    irA('/?ref=K7PM3XQ2#seccion');

    expect(takeReferralCode()).toBe('K7PM3XQ2');
    expect(window.location.hash).toBe('#seccion');
  });

  it('normaliza a mayúsculas', () => {
    irA('/?ref=k7pm3xq2');

    expect(takeReferralCode()).toBe('K7PM3XQ2');
  });

  it('devuelve cadena vacía cuando no hay código', () => {
    irA('/?lang=es');

    expect(takeReferralCode()).toBe('');
    expect(window.location.search).toBe('?lang=es');
  });

  // El invitado pasa por Login (y a veces recarga) antes de "Crear cuenta":
  // la copia en sessionStorage es lo que hace que el código sobreviva.
  it('persiste en sessionStorage y sobrevive a una segunda lectura sin URL', () => {
    irA('/?ref=K7PM3XQ2');

    expect(takeReferralCode()).toBe('K7PM3XQ2');
    expect(sessionStorage.getItem('kiramopay-ref-pendiente')).toBe('K7PM3XQ2');

    irA('/');
    expect(takeReferralCode()).toBe('K7PM3XQ2');
  });

  it('clearReferralCode lo borra', () => {
    irA('/?ref=K7PM3XQ2');
    takeReferralCode();

    clearReferralCode();

    expect(sessionStorage.getItem('kiramopay-ref-pendiente')).toBeNull();
    expect(takeReferralCode()).toBe('');
  });

  it('rechaza un formato inválido y no lo guarda', () => {
    irA('/?ref=abc');

    expect(takeReferralCode()).toBe('');
    expect(window.location.search).toBe('');
    expect(sessionStorage.getItem('kiramopay-ref-pendiente')).toBeNull();
  });

  it('un ref malformado no pisa el código válido guardado', () => {
    irA('/?ref=K7PM3XQ2');
    takeReferralCode();

    irA('/?ref=malo');
    expect(takeReferralCode()).toBe('K7PM3XQ2');
  });
});

describe('normalizarCodigoInvitacion', () => {
  it('recorta y pasa a mayúsculas', () => {
    expect(normalizarCodigoInvitacion(' k7pm3xq2 ')).toBe('K7PM3XQ2');
  });

  it('devuelve vacío si no cumple el formato', () => {
    expect(normalizarCodigoInvitacion('')).toBe('');
    expect(normalizarCodigoInvitacion('ABC')).toBe('');
    expect(normalizarCodigoInvitacion('K7PM3XQ2Z')).toBe('');
    expect(normalizarCodigoInvitacion('K7PM-XQ2')).toBe('');
  });
});
