// Los avisos del APK van por FCM. La regla que mas importa aqui: sin el
// archivo de Firebase en el build, PushNotifications.register() cierra la app
// en Android. Por eso nada toca register ni unregister si el APK no se compilo
// con VITE_PUSH_NATIVO=1, ni si la persona no activo los avisos.

const falso = vi.hoisted(() => {
  const s = {
    nativa: true,
    plataforma: 'android',
    permiso: 'granted' as string,
    permisoAlPedir: 'granted' as string,
    token: 'fcm-token-1' as string | null,
    escuchas: {} as Record<string, (x: { value?: string; error?: string }) => void>,
  };
  const PushNotifications = {
    checkPermissions: vi.fn(async () => ({ receive: s.permiso })),
    requestPermissions: vi.fn(async () => ({ receive: s.permisoAlPedir })),
    createChannel: vi.fn(async () => undefined),
    addListener: vi.fn(async (evento: string, cb: (x: { value?: string }) => void) => {
      s.escuchas[evento] = cb;
      return { remove: vi.fn(async () => { delete s.escuchas[evento]; }) };
    }),
    register: vi.fn(async () => {
      // FCM entrega el token por evento, despues de resolver register().
      if (s.token) setTimeout(() => s.escuchas.registration?.({ value: s.token! }), 0);
    }),
    unregister: vi.fn(async () => undefined),
  };
  const api = {
    pushNativo: vi.fn(),
    registrarDispositivo: vi.fn(),
    olvidarDispositivo: vi.fn(),
    pushPublicKey: vi.fn(),
    subscribePush: vi.fn(),
    unsubscribePush: vi.fn(),
  };
  return { s, PushNotifications, api };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => falso.s.nativa,
    getPlatform: () => falso.s.plataforma,
  },
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: falso.PushNotifications }));
vi.mock('@/api', () => ({ getApiLayer: () => ({ notifications: falso.api }) }));

const {
  activarAvisos,
  desactivarAvisos,
  leerEstadoAvisos,
  modoDeAvisos,
  sincronizarAvisos,
  soltarAvisosAlSalir,
} = await import('../avisosPush');
const { reiniciarNativoParaPruebas } = await import('../avisosNativos');

const MARCA = 'kiramopay_avisos_push';
const { s, PushNotifications: pn, api } = falso;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  reiniciarNativoParaPruebas();
  Object.assign(s, {
    nativa: true,
    plataforma: 'android',
    permiso: 'granted',
    permisoAlPedir: 'granted',
    token: 'fcm-token-1',
    escuchas: {},
  });
  vi.stubEnv('VITE_PUSH_NATIVO', '1');
  api.pushNativo.mockResolvedValue({ success: true, data: { habilitado: true } });
  api.registrarDispositivo.mockResolvedValue({ success: true });
  api.olvidarDispositivo.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('modoDeAvisos', () => {
  it('el APK con Firebase usa FCM', () => {
    expect(modoDeAvisos()).toBe('nativo');
  });

  it('el APK sin Firebase no tiene avisos, y no toca el plugin', async () => {
    vi.stubEnv('VITE_PUSH_NATIVO', '');
    expect(modoDeAvisos()).toBe('ninguno');
    await expect(leerEstadoAvisos('u1')).resolves.toEqual({ estado: 'no_soportado', clave: '' });
    await expect(activarAvisos('', 'u1')).resolves.toBe('no_soportado');
    await sincronizarAvisos('u1');
    soltarAvisosAlSalir();
    expect(pn.register).not.toHaveBeenCalled();
    expect(pn.unregister).not.toHaveBeenCalled();
    expect(api.pushNativo).not.toHaveBeenCalled();
  });

  it('iOS todavia no: necesita APNs y la cuenta de Apple', () => {
    s.plataforma = 'ios';
    expect(modoDeAvisos()).toBe('ninguno');
  });
});

describe('activar en el APK', () => {
  it('pide permiso, crea el canal privado, registra y le da el token al servidor', async () => {
    await expect(activarAvisos('', 'u1')).resolves.toBe('activo');
    expect(pn.requestPermissions).toHaveBeenCalledTimes(1);
    // Privado: con la pantalla bloqueada el aviso no muestra montos.
    expect(pn.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: 'avisos', visibility: 0 }));
    // Las escuchas antes que register(): el token llega por evento.
    expect(pn.addListener.mock.invocationCallOrder[0]).toBeLessThan(pn.register.mock.invocationCallOrder[0]);
    expect(api.registrarDispositivo).toHaveBeenCalledWith({ token: 'fcm-token-1', plataforma: 'android' });
    expect(localStorage.getItem(MARCA)).toBe('u1');
  });

  it('con el permiso denegado no registra nada', async () => {
    s.permisoAlPedir = 'denied';
    await expect(activarAvisos('', 'u1')).resolves.toBe('bloqueado');
    expect(pn.register).not.toHaveBeenCalled();
    expect(api.registrarDispositivo).not.toHaveBeenCalled();
  });

  it('si el servidor no tiene FCM lo dice como no disponible, no como fallo', async () => {
    api.registrarDispositivo.mockResolvedValue({ success: false, error: { code: 'NATIVE_PUSH_DISABLED' } });
    await expect(activarAvisos('', 'u1')).resolves.toBe('sin_configurar');
    expect(localStorage.getItem(MARCA)).toBeNull();
  });

  it('si FCM nunca entrega el token, falla con cota en vez de girar para siempre', async () => {
    vi.useFakeTimers();
    s.token = null;
    const resultado = activarAvisos('', 'u1');
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(resultado).resolves.toBe('fallo');
    expect(api.registrarDispositivo).not.toHaveBeenCalled();
  });
});

describe('desactivar y salir en el APK', () => {
  it('desactivar da de baja en el servidor y borra el token en FCM', async () => {
    await activarAvisos('', 'u1');
    await expect(desactivarAvisos()).resolves.toBe('inactivo');
    expect(api.olvidarDispositivo).toHaveBeenCalledWith('fcm-token-1');
    expect(pn.unregister).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MARCA)).toBeNull();
  });

  it('al cerrar sesion la baja sale en la misma llamada, con el token de sesion vivo', async () => {
    await activarAvisos('', 'u1');
    soltarAvisosAlSalir();
    expect(api.olvidarDispositivo).toHaveBeenCalledWith('fcm-token-1');
    expect(pn.unregister).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MARCA)).toBeNull();
  });

  it('a quien nunca activo los avisos no se le toca FCM al salir', () => {
    soltarAvisosAlSalir();
    expect(pn.unregister).not.toHaveBeenCalled();
    expect(api.olvidarDispositivo).not.toHaveBeenCalled();
  });

  it('con la cuenta bloqueada solo borra el token en FCM', async () => {
    await activarAvisos('', 'u1');
    soltarAvisosAlSalir(false);
    expect(api.olvidarDispositivo).not.toHaveBeenCalled();
    expect(pn.unregister).toHaveBeenCalledTimes(1);
  });
});

describe('arranque y estado en el APK', () => {
  it('al entrar le da al servidor el token vigente de quien los activo', async () => {
    localStorage.setItem(MARCA, 'u1');
    s.token = 'fcm-token-rotado';
    await sincronizarAvisos('u1');
    expect(api.registrarDispositivo).toHaveBeenCalledWith({ token: 'fcm-token-rotado', plataforma: 'android' });
  });

  it('otra cuenta en el mismo telefono no hereda los avisos ni despierta a FCM', async () => {
    localStorage.setItem(MARCA, 'u1');
    await sincronizarAvisos('u2');
    expect(pn.register).not.toHaveBeenCalled();
    expect(api.registrarDispositivo).not.toHaveBeenCalled();
  });

  it('el estado refleja el servidor, el permiso y la cuenta', async () => {
    api.pushNativo.mockResolvedValueOnce({ success: true, data: { habilitado: false } });
    await expect(leerEstadoAvisos('u1')).resolves.toMatchObject({ estado: 'sin_configurar' });

    s.permiso = 'denied';
    await expect(leerEstadoAvisos('u1')).resolves.toMatchObject({ estado: 'bloqueado' });

    s.permiso = 'granted';
    await expect(leerEstadoAvisos('u1')).resolves.toMatchObject({ estado: 'inactivo' });
    localStorage.setItem(MARCA, 'u1');
    await expect(leerEstadoAvisos('u1')).resolves.toMatchObject({ estado: 'activo' });
    // Leer el estado nunca registra: register() solo con el toque o la marca.
    expect(pn.register).not.toHaveBeenCalled();
  });
});
