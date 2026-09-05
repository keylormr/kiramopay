import { olvidarUltimoAcceso, CLAVE_ULTIMO_IDENTIFICADOR, CLAVE_ULTIMO_NOMBRE } from '../olvidarUltimoAcceso';

// La pantalla de login recuerda quien entro por ultima vez para ofrecer el
// acceso rapido. Es deliberado, pero NADA lo borraba nunca: ni cerrar sesion,
// ni el cierre forzado, ni la limpieza de datos de usuario. En un telefono
// compartido, el siguiente en abrir la aplicacion veia el nombre del anterior,
// y la contrasena seguia guardada en el llavero del sistema.
const mocks = vi.hoisted(() => ({ deleteCredentials: vi.fn().mockResolvedValue(true) }));

vi.mock('@/services/biometric', () => ({
  biometricService: { deleteCredentials: mocks.deleteCredentials },
}));

describe('olvidarUltimoAcceso', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.deleteCredentials.mockClear();
  });

  it('borra el identificador y el nombre guardados', () => {
    localStorage.setItem(CLAVE_ULTIMO_IDENTIFICADOR, 'keilor');
    localStorage.setItem(CLAVE_ULTIMO_NOMBRE, 'Keilor Martinez');

    olvidarUltimoAcceso();

    expect(localStorage.getItem(CLAVE_ULTIMO_IDENTIFICADOR)).toBeNull();
    expect(localStorage.getItem(CLAVE_ULTIMO_NOMBRE)).toBeNull();
  });

  // La regla del proyecto: quitar el acceso no borra registros, pero la
  // credencial SI se destruye. En el llavero esta la contrasena en claro.
  it('destruye tambien la credencial del llavero', () => {
    olvidarUltimoAcceso();
    expect(mocks.deleteCredentials).toHaveBeenCalledWith('kiramopay');
  });

  // Ventana privada o almacenamiento bloqueado: no puede tumbar el cierre de
  // sesion que lo esta llamando.
  it('no revienta si el almacenamiento no deja borrar', () => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = () => {
      throw new Error('almacenamiento bloqueado');
    };
    try {
      expect(() => olvidarUltimoAcceso()).not.toThrow();
      // Y la credencial se borra igual: un fallo no puede saltarse el otro.
      expect(mocks.deleteCredentials).toHaveBeenCalled();
    } finally {
      Storage.prototype.removeItem = original;
    }
  });

  // Y que un llavero que falle tampoco tumbe nada.
  it('no revienta si el llavero rechaza', () => {
    mocks.deleteCredentials.mockRejectedValueOnce(new Error('sin llavero'));
    localStorage.setItem(CLAVE_ULTIMO_NOMBRE, 'Keilor');
    expect(() => olvidarUltimoAcceso()).not.toThrow();
    expect(localStorage.getItem(CLAVE_ULTIMO_NOMBRE)).toBeNull();
  });
});
