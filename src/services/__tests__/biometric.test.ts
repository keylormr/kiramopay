import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Esta prueba comparaba constantes que ella misma definia (un umbral y unos
// textos de error que el servicio no tiene), y su "respaldo web" afirmaba un
// exito simulado que el servicio quito a proposito: en web la biometria fingida
// abria sola el candado del PIN. Ahora prueba el servicio de verdad, con el
// plugin nativo simulado, en web y en el telefono.

const nativo = vi.hoisted(() => ({
  isAvailable: vi.fn(),
  verifyIdentity: vi.fn(),
  setCredentials: vi.fn(),
  getCredentials: vi.fn(),
  deleteCredentials: vi.fn(),
}));

vi.mock('capacitor-native-biometric', () => ({
  NativeBiometric: nativo,
  BiometryType: {
    NONE: 0,
    TOUCH_ID: 1,
    FACE_ID: 2,
    FINGERPRINT: 3,
    FACE_AUTHENTICATION: 4,
    IRIS_AUTHENTICATION: 5,
    MULTIPLE: 6,
  },
}));

// El servicio decide si es nativo al crearse, asi que cada prueba lo importa de
// nuevo con el entorno que le toca.
async function servicio(enElTelefono: boolean) {
  vi.resetModules();
  const win = window as unknown as Record<string, unknown>;
  if (enElTelefono) win.Capacitor = { isNativePlatform: () => true };
  else delete win.Capacitor;
  return (await import('../biometric')).biometricService;
}

beforeEach(() => {
  Object.values(nativo).forEach((f) => f.mockReset());
  localStorage.clear();
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).Capacitor;
});

describe('biometria en web', () => {
  it('no esta disponible y no le pregunta al plugin', async () => {
    const bio = await servicio(false);
    await expect(bio.checkAvailability()).resolves.toEqual({
      isAvailable: false,
      biometryType: 'none',
      errorMessage: undefined,
    });
    expect(nativo.isAvailable).not.toHaveBeenCalled();
  });

  it('nunca finge una autenticacion exitosa', async () => {
    const bio = await servicio(false);
    const res = await bio.authenticate('Confirmar el envio');
    expect(res.success).toBe(false);
    expect(nativo.verifyIdentity).not.toHaveBeenCalled();
  });

  it('no guarda la contrasena en el navegador', async () => {
    const bio = await servicio(false);
    await expect(bio.setCredentials('kiramopay', 'ana', 'la-contrasena')).resolves.toBe(false);
    const guardado = Object.keys(localStorage).map((k) => localStorage.getItem(k) ?? '');
    expect(guardado.some((v) => v.includes('la-contrasena'))).toBe(false);
  });

  it('borra lo que una version anterior hubiera dejado en texto plano', async () => {
    localStorage.setItem('bio_cred_kiramopay', JSON.stringify({ username: 'ana', password: 'vieja' }));
    const bio = await servicio(false);
    await expect(bio.getCredentials('kiramopay')).resolves.toBeNull();
    expect(localStorage.getItem('bio_cred_kiramopay')).toBeNull();
  });
});

describe('biometria en el telefono', () => {
  it.each([
    [1, 'fingerprint'],
    [3, 'fingerprint'],
    [2, 'face'],
    [4, 'face'],
    [5, 'iris'],
  ])('el tipo %i del plugin es %s', async (tipo, esperado) => {
    nativo.isAvailable.mockResolvedValue({ isAvailable: true, biometryType: tipo });
    const bio = await servicio(true);
    await expect(bio.checkAvailability()).resolves.toEqual({ isAvailable: true, biometryType: esperado });
  });

  it('si el plugin falla, no esta disponible', async () => {
    nativo.isAvailable.mockRejectedValue(new Error('sin sensor'));
    const bio = await servicio(true);
    const res = await bio.checkAvailability();
    expect(res.isAvailable).toBe(false);
    expect(res.biometryType).toBe('none');
  });

  it('autentica con el motivo de la pantalla, tres intentos y el boton en el idioma de la app', async () => {
    nativo.verifyIdentity.mockResolvedValue(undefined);
    const bio = await servicio(true);
    await expect(bio.authenticate('Confirmar el envio')).resolves.toEqual({ success: true });
    expect(nativo.verifyIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'Confirmar el envio', maxAttempts: 3, negativeButtonText: 'Cancelar' }),
    );
  });

  it('una lectura rechazada no es un exito', async () => {
    nativo.verifyIdentity.mockRejectedValue(new Error('no coincide'));
    const bio = await servicio(true);
    const res = await bio.authenticate('Confirmar el envio');
    expect(res.success).toBe(false);
  });

  it('las credenciales van al almacen seguro del sistema', async () => {
    nativo.setCredentials.mockResolvedValue(undefined);
    nativo.getCredentials.mockResolvedValue({ username: 'ana', password: 'la-contrasena' });
    const bio = await servicio(true);
    await expect(bio.setCredentials('kiramopay', 'ana', 'la-contrasena')).resolves.toBe(true);
    expect(nativo.setCredentials).toHaveBeenCalledWith({ username: 'ana', password: 'la-contrasena', server: 'kiramopay' });
    await expect(bio.getCredentials('kiramopay')).resolves.toEqual({ username: 'ana', password: 'la-contrasena' });
  });
});
