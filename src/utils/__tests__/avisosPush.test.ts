// Los avisos del sistema estuvieron muertos desde el principio: la suscripcion
// salia sin sesion y con una forma que el servidor no leia, y nada la creaba.
// Estas pruebas fijan el recorrido entero contra un navegador de mentira: el
// permiso dentro del gesto, la forma que viaja al servidor, la baja al cerrar
// sesion con el token vivo, y que otra cuenta no herede avisos que no pidio.

const api = vi.hoisted(() => ({
  pushPublicKey: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ notifications: api }),
}));

const {
  activarAvisos,
  claveABytes,
  desactivarAvisos,
  leerEstadoAvisos,
  reiniciarAvisosParaPruebas,
  sincronizarAvisos,
  soltarAvisosAlSalir,
} = await import('../avisosPush');

const CLAVE = 'AQIDBA'; // base64url de [1, 2, 3, 4]
const MARCA = 'kiramopay_avisos_push';

interface SuscripcionFalsa {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON: () => { endpoint: string; keys: { auth: string; p256dh: string } };
  unsubscribe: ReturnType<typeof vi.fn>;
}

function suscripcion(endpoint: string, clave: number[] = [1, 2, 3, 4]): SuscripcionFalsa {
  return {
    endpoint,
    options: { applicationServerKey: new Uint8Array(clave).buffer },
    toJSON: () => ({ endpoint, keys: { auth: 'auth-' + endpoint, p256dh: 'p256-' + endpoint } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

let permiso: NotificationPermission;
let actual: SuscripcionFalsa | null;
const pushManager = {
  getSubscription: vi.fn(async () => actual),
  subscribe: vi.fn(async (_opciones: PushSubscriptionOptionsInit) => {
    actual = suscripcion('https://push.example.test/nueva');
    return actual;
  }),
};
const registro = { pushManager };

function instalarNavegador() {
  class NotificationFalsa {
    static get permission() {
      return permiso;
    }
    static requestPermission = vi.fn(async () => permiso);
  }
  vi.stubGlobal('Notification', NotificationFalsa);
  vi.stubGlobal('PushManager', class {});
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve(registro), getRegistration: vi.fn(async () => registro) },
  });
}

beforeEach(() => {
  permiso = 'default';
  actual = null;
  localStorage.clear();
  reiniciarAvisosParaPruebas();
  vi.clearAllMocks();
  api.pushPublicKey.mockResolvedValue({ success: true, data: { publicKey: CLAVE, habilitado: true } });
  api.subscribePush.mockResolvedValue({ success: true });
  api.unsubscribePush.mockResolvedValue({ success: true });
  instalarNavegador();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // @ts-expect-error se quita la propiedad que puso la prueba
  delete navigator.serviceWorker;
});

describe('claveABytes', () => {
  it('decodifica base64url, con los dos caracteres que cambian respecto de base64', () => {
    expect(Array.from(claveABytes('-_8'))).toEqual([0xfb, 0xff]);
    expect(Array.from(claveABytes(CLAVE))).toEqual([1, 2, 3, 4]);
  });
});

describe('activarAvisos', () => {
  it('pide el permiso en el mismo instante del toque, antes de cualquier espera', () => {
    permiso = 'default';
    void activarAvisos(CLAVE, 'u1');
    // Sin un solo await de por medio: Safari y Firefox solo lo conceden dentro
    // del gesto del usuario.
    expect(Notification.requestPermission).toHaveBeenCalledTimes(1);
    expect(api.pushPublicKey).not.toHaveBeenCalled();
  });

  it('suscribe con la clave del servidor y manda al servidor la forma plana', async () => {
    permiso = 'default';
    (Notification.requestPermission as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      permiso = 'granted';
      return 'granted';
    });

    await expect(activarAvisos(CLAVE, 'u1')).resolves.toBe('activo');

    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    const opciones = pushManager.subscribe.mock.calls[0][0];
    expect(opciones.userVisibleOnly).toBe(true);
    expect(Array.from(opciones.applicationServerKey as Uint8Array)).toEqual([1, 2, 3, 4]);
    expect(api.subscribePush).toHaveBeenCalledWith({
      endpoint: 'https://push.example.test/nueva',
      auth: 'auth-https://push.example.test/nueva',
      p256dh: 'p256-https://push.example.test/nueva',
    });
    expect(localStorage.getItem(MARCA)).toBe('u1');
  });

  it('con el permiso denegado no suscribe ni llama al servidor', async () => {
    permiso = 'denied';
    await expect(activarAvisos(CLAVE, 'u1')).resolves.toBe('bloqueado');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.subscribePush).not.toHaveBeenCalled();
  });

  it('si el servidor no la guarda, suelta la suscripcion y no dice activado', async () => {
    permiso = 'granted';
    api.subscribePush.mockResolvedValue({ success: false, error: { code: 'MISSING_KEYS' } });

    await expect(activarAvisos(CLAVE, 'u1')).resolves.toBe('fallo');
    expect(actual?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MARCA)).toBeNull();
  });

  it('rehace la suscripcion si el servidor cambio de clave', async () => {
    permiso = 'granted';
    const vieja = suscripcion('https://push.example.test/vieja', [9, 9, 9, 9]);
    actual = vieja;

    await expect(activarAvisos(CLAVE, 'u1')).resolves.toBe('activo');
    expect(vieja.unsubscribe).toHaveBeenCalledTimes(1);
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(api.subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example.test/nueva' }),
    );
  });

  it('reusa la suscripcion que ya existe con la misma clave', async () => {
    permiso = 'granted';
    actual = suscripcion('https://push.example.test/existente');

    await expect(activarAvisos(CLAVE, 'u1')).resolves.toBe('activo');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.subscribePush).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example.test/existente' }),
    );
  });
});

describe('desactivarAvisos', () => {
  it('da de baja en el servidor y en el navegador, y borra la marca', async () => {
    permiso = 'granted';
    localStorage.setItem(MARCA, 'u1');
    const sub = suscripcion('https://push.example.test/activa');
    actual = sub;

    await expect(desactivarAvisos()).resolves.toBe('inactivo');
    expect(api.unsubscribePush).toHaveBeenCalledWith('https://push.example.test/activa');
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(MARCA)).toBeNull();
  });
});

describe('sincronizarAvisos', () => {
  it('rehace la suscripcion perdida de quien la habia activado', async () => {
    // Una recarga de version desregistro el service worker: no hay suscripcion.
    permiso = 'granted';
    localStorage.setItem(MARCA, 'u1');

    await sincronizarAvisos('u1');
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(api.subscribePush).toHaveBeenCalledTimes(1);
  });

  it('no suscribe a otra cuenta que entra en el mismo navegador', async () => {
    permiso = 'granted';
    localStorage.setItem(MARCA, 'u1');

    await sincronizarAvisos('u2');
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(api.subscribePush).not.toHaveBeenCalled();
  });

  it('sin permiso concedido no hace nada', async () => {
    permiso = 'default';
    localStorage.setItem(MARCA, 'u1');

    await sincronizarAvisos('u1');
    expect(api.pushPublicKey).not.toHaveBeenCalled();
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });
});

describe('soltarAvisosAlSalir', () => {
  it('manda la baja al servidor en la misma llamada, antes de que se borre el token', async () => {
    permiso = 'granted';
    await activarAvisos(CLAVE, 'u1');
    const sub = actual!;

    soltarAvisosAlSalir();
    // Sincronico: el cierre de sesion borra el token justo despues.
    expect(api.unsubscribePush).toHaveBeenCalledWith('https://push.example.test/nueva');
    expect(localStorage.getItem(MARCA)).toBeNull();
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledTimes(1));
  });

  it('con la cuenta bloqueada solo corta en el navegador', async () => {
    permiso = 'granted';
    await activarAvisos(CLAVE, 'u1');
    const sub = actual!;

    soltarAvisosAlSalir(false);
    expect(api.unsubscribePush).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sub.unsubscribe).toHaveBeenCalledTimes(1));
  });
});

describe('leerEstadoAvisos', () => {
  it('sin claves en el servidor la opcion no se ofrece', async () => {
    api.pushPublicKey.mockResolvedValue({ success: true, data: { publicKey: '', habilitado: false } });
    await expect(leerEstadoAvisos('u1')).resolves.toEqual({ estado: 'sin_configurar', clave: '' });
  });

  it('sin Push API (la WebView de Android) dice que no se puede', async () => {
    vi.unstubAllGlobals();
    await expect(leerEstadoAvisos('u1')).resolves.toEqual({ estado: 'no_soportado', clave: '' });
    expect(api.pushPublicKey).not.toHaveBeenCalled();
  });

  it('con el permiso denegado lo dice', async () => {
    permiso = 'denied';
    await expect(leerEstadoAvisos('u1')).resolves.toMatchObject({ estado: 'bloqueado' });
  });

  it('activo solo si la suscripcion es de esta cuenta', async () => {
    permiso = 'granted';
    actual = suscripcion('https://push.example.test/activa');
    localStorage.setItem(MARCA, 'u1');

    await expect(leerEstadoAvisos('u1')).resolves.toEqual({ estado: 'activo', clave: CLAVE });
    await expect(leerEstadoAvisos('u2')).resolves.toEqual({ estado: 'inactivo', clave: CLAVE });
  });
});
