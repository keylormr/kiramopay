// Tocar un aviso en el telefono abria la app y nada mas: no habia ningun
// manejador de pushNotificationActionPerformed. Ahora el toque lleva a la
// pantalla del aviso. Y escuchar el toque no puede tocar Firebase: sin el
// archivo de Firebase, register() cierra la app (ver avisosNativos.test.ts).

const falso = vi.hoisted(() => {
  const s = {
    nativa: true,
    plataforma: 'android',
    escuchas: {} as Record<string, (x: unknown) => void>,
  };
  const quitar = vi.fn(async () => undefined);
  const PushNotifications = {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    createChannel: vi.fn(),
    register: vi.fn(),
    unregister: vi.fn(),
    addListener: vi.fn(async (evento: string, cb: (x: unknown) => void) => {
      s.escuchas[evento] = cb;
      return { remove: quitar };
    }),
  };
  return { s, PushNotifications, quitar };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => falso.s.nativa,
    getPlatform: () => falso.s.plataforma,
  },
}));
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: falso.PushNotifications }));
vi.mock('@/api', () => ({ getApiLayer: () => ({ notifications: {} }) }));

const { escucharToquesDeAvisosDelSistema } = await import('../avisosPush');
const { suscribirToqueDeAviso, reiniciarToquesParaPruebas } = await import('../destinoDeAviso');

const { s, PushNotifications: pn, quitar } = falso;
const EVENTO = 'pushNotificationActionPerformed';

/** Lo que entrega el plugin de Android al tocar el aviso (handleOnNewIntent). */
function tocar(data: Record<string, unknown>) {
  s.escuchas[EVENTO]?.({ actionId: 'tap', notification: { id: 'msg-1', data } });
}

beforeEach(() => {
  vi.clearAllMocks();
  reiniciarToquesParaPruebas();
  Object.assign(s, { nativa: true, plataforma: 'android', escuchas: {} });
  vi.stubEnv('VITE_PUSH_NATIVO', '1');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('el toque de un aviso en el telefono', () => {
  it('una alerta de precio abre Cripto en su moneda y se marca leida', async () => {
    const atendidos = vi.fn();
    suscribirToqueDeAviso(atendidos);
    escucharToquesDeAvisosDelSistema();
    await vi.waitFor(() => expect(s.escuchas[EVENTO]).toBeDefined());

    tocar({ url: '/', tipo: 'price_alert', activo: 'BTC', aviso: 'aviso-1', from: '123' });

    expect(atendidos).toHaveBeenCalledWith({ destino: { pantalla: 'cripto', simbolo: 'BTC' }, aviso: 'aviso-1' });
  });

  it('un SINPE recibido abre su movimiento', async () => {
    const atendidos = vi.fn();
    suscribirToqueDeAviso(atendidos);
    escucharToquesDeAvisosDelSistema();
    await vi.waitFor(() => expect(s.escuchas[EVENTO]).toBeDefined());

    tocar({ url: '/', tipo: 'transaction', movimiento: 'tx-9', aviso: 'aviso-2' });

    expect(atendidos).toHaveBeenCalledWith({ destino: { pantalla: 'movimiento', id: 'tx-9' }, aviso: 'aviso-2' });
  });

  it('con la app cerrada, el toque espera a la pantalla que lo atiende', async () => {
    escucharToquesDeAvisosDelSistema();
    await vi.waitFor(() => expect(s.escuchas[EVENTO]).toBeDefined());
    tocar({ url: '/', tipo: 'security', aviso: 'aviso-3' });

    const atendidos = vi.fn();
    suscribirToqueDeAviso(atendidos);
    expect(atendidos).toHaveBeenCalledWith({ destino: { pantalla: 'seguridad' }, aviso: 'aviso-3' });
  });

  it('un aviso sin pantalla no lleva a nada (abre la app, como antes)', async () => {
    const atendidos = vi.fn();
    suscribirToqueDeAviso(atendidos);
    escucharToquesDeAvisosDelSistema();
    await vi.waitFor(() => expect(s.escuchas[EVENTO]).toBeDefined());

    tocar({ url: '/', tipo: 'qr_cobro', aviso: 'aviso-4' });

    expect(atendidos).not.toHaveBeenCalled();
  });

  it('escuchar no toca Firebase ni pide permisos', async () => {
    escucharToquesDeAvisosDelSistema();
    await vi.waitFor(() => expect(pn.addListener).toHaveBeenCalledWith(EVENTO, expect.any(Function)));
    expect(pn.register).not.toHaveBeenCalled();
    expect(pn.requestPermissions).not.toHaveBeenCalled();
    expect(pn.checkPermissions).not.toHaveBeenCalled();
  });

  it('al soltar, deja de escuchar', async () => {
    const soltar = escucharToquesDeAvisosDelSistema();
    await vi.waitFor(() => expect(s.escuchas[EVENTO]).toBeDefined());
    soltar();
    expect(quitar).toHaveBeenCalledTimes(1);
  });

  it('el APK sin Firebase y el navegador no escuchan: no les llegan estos avisos', () => {
    vi.stubEnv('VITE_PUSH_NATIVO', '');
    escucharToquesDeAvisosDelSistema();
    s.nativa = false;
    escucharToquesDeAvisosDelSistema();
    expect(pn.addListener).not.toHaveBeenCalled();
  });
});
