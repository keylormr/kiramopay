import { useAuthStore, ESPERAS_REINTENTO_RESTAURACION_MS } from '../auth.store';
import { HttpClient, ESPERAS_REINTENTO_REFRESCO_MS } from '@/api/adapters/http/client';
import { traducirFueraDeReact } from '@/i18n/mensajesDeError';
import { secureTokenStore } from '@/services/secureTokenStore';

// Stable mock for the refresh call so bootstrap tests can drive its result.
const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    auth: {
      refresh: mockRefresh,
      getProfile: vi.fn().mockResolvedValue({
        success: true,
        data: {
          id: 'user-001',
          cedula: '702650930',
          firstName: 'Keilor',
          lastName: 'Martinez',
          phone: '+506 8888-0000',
          email: 'keilor@kiramopay.com',
          kycLevel: 2,
          avatar: '',
          createdAt: '2024-01-15',
        },
      }),
      login: vi.fn().mockImplementation(async ({ cedula, password }: { cedula: string; password: string }) => {
        if (cedula === '702650930' && password === 'Kiramopay2024!') {
          return {
            success: true,
            data: {
              user: {
                cedula: '702650930',
                firstName: 'Keilor',
                lastName: 'Martinez',
                phone: '+506 8888-0000',
                email: 'keilor@kiramopay.com',
                kycLevel: 2,
                createdAt: '2024-01-15',
              },
              tokens: {
                access_token: 'fake-access',
                refresh_token: 'fake-refresh',
                expires_at: Math.floor(Date.now() / 1000) + 900,
              },
            },
          };
        }
        return { success: false, error: { code: 'AUTH_FAILED', message: 'Invalid credentials' } };
      }),
      logout: vi.fn().mockResolvedValue({ success: true }),
      changePassword: vi.fn().mockImplementation(async ({ oldPassword }: { oldPassword: string }) => {
        if (oldPassword === 'Kiramopay2024!') {
          return { success: true, data: { changed: true } };
        }
        return { success: false, error: { code: 'INVALID_PASSWORD', message: 'Wrong password' } };
      }),
    },
  }),
}));

vi.mock('@/services/dataSync', () => ({
  syncAllData: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/lockKdf', () => ({
  clearLockPin: vi.fn(),
}));

describe('useAuthStore', () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    useAuthStore.setState({
      isAuthenticated: false,
      isOnboarded: false,
      sessionHint: false,
      user: null,
      accessToken: null,
      refreshToken: null,
      logoutReason: null,
      restauracion: 'normal',
    });
  });

  it('starts unauthenticated', () => {
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
  });

  it('logs in with valid credentials and stores tokens in memory', async () => {
    const ok = await useAuthStore.getState().login('702650930', 'Kiramopay2024!');
    expect(ok.success).toBe(true);
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.user?.firstName).toBe('Keilor');
    expect(s.accessToken).toBe('fake-access');
    expect(s.refreshToken).toBe('fake-refresh');
  });

  it('does NOT persist any password derivative', async () => {
    await useAuthStore.getState().login('702650930', 'Kiramopay2024!');
    const persisted = localStorage.getItem('kiramopay-auth');
    expect(persisted).not.toBeNull();
    const parsed = JSON.parse(persisted!);
    // SECURITY: no hash, no password equivalent should ever be persisted.
    expect(parsed.state.passwordHash).toBeUndefined();
    expect(parsed.state.accessToken).toBeUndefined();
    expect(parsed.state.refreshToken).toBeUndefined();
  });

  it('fails login with invalid credentials', async () => {
    const ok = await useAuthStore.getState().login('702650930', 'WrongPass1!');
    expect(ok.success).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('logs out and clears tokens', async () => {
    await useAuthStore.getState().login('702650930', 'Kiramopay2024!');
    useAuthStore.getState().logout();
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
  });

  it('completes onboarding', () => {
    useAuthStore.getState().completeOnboarding();
    expect(useAuthStore.getState().isOnboarded).toBe(true);
  });

  it('changes password via backend', async () => {
    await useAuthStore.getState().login('702650930', 'Kiramopay2024!');
    const ok = await useAuthStore.getState().changePassword('Kiramopay2024!', 'NewPass2024!');
    expect(ok).toBe(true);
  });

  it('bootstrap restores the session when the refresh cookie is valid', async () => {
    mockRefresh.mockResolvedValue({
      success: true,
      data: { access_token: 'fresh-access', refresh_token: 'fresh-refresh' },
    });
    await useAuthStore.getState().bootstrap();
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(true);
    expect(s.accessToken).toBe('fresh-access');
    expect(s.refreshToken).toBe('fresh-refresh');
    // Profile is re-fetched from the backend (not persisted PII).
    expect(s.user?.firstName).toBe('Keilor');
    expect(s.sessionHint).toBe(true);
  });

  it('bootstrap stays logged out when there is no valid cookie', async () => {
    mockRefresh.mockResolvedValue({
      success: false,
      error: { code: 'REFRESH_FAILED', message: 'invalid refresh token' },
    });
    await useAuthStore.getState().bootstrap();
    const s = useAuthStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.accessToken).toBeNull();
  });

  // Recargar la pagina con la red caida (o con el cupo de peticiones agotado,
  // que el navegador entrega como fallo de red) cerraba la sesion sin decir
  // nada. Solo una respuesta definitiva del servidor la cierra ahora.
  describe('restauracion ante fallos pasajeros', () => {
    const sinRed = { success: false, error: { code: 'NETWORK_ERROR', message: 'sin red' } };
    const limitado = { success: false, error: { code: 'RATE_LIMITED', message: 'espera' } };
    const restaurada = {
      success: true,
      data: { access_token: 'fresh-access', refresh_token: 'fresh-refresh' },
    };
    const totalEsperas = ESPERAS_REINTENTO_RESTAURACION_MS.reduce((a, b) => a + b, 0);

    beforeEach(() => {
      vi.useFakeTimers();
      useAuthStore.setState({ sessionHint: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('reintenta y restaura la sesion cuando vuelve la conexion', async () => {
      mockRefresh.mockResolvedValueOnce(sinRed).mockResolvedValueOnce(limitado).mockResolvedValueOnce(restaurada);

      const arranque = useAuthStore.getState().bootstrap();
      await vi.advanceTimersByTimeAsync(0);
      expect(useAuthStore.getState().restauracion).toBe('reintentando');
      expect(useAuthStore.getState().isAuthenticated).toBe(false);

      await vi.advanceTimersByTimeAsync(totalEsperas);
      await arranque;

      const s = useAuthStore.getState();
      expect(mockRefresh).toHaveBeenCalledTimes(3);
      expect(s.isAuthenticated).toBe(true);
      expect(s.accessToken).toBe('fresh-access');
      expect(s.restauracion).toBe('normal');
    });

    it('si no se recupera, no cierra la sesion: avisa y deja reintentar', async () => {
      mockRefresh.mockResolvedValue(sinRed);

      const arranque = useAuthStore.getState().bootstrap();
      await vi.advanceTimersByTimeAsync(totalEsperas);
      await arranque;

      const s = useAuthStore.getState();
      // Un intento y un reintento por cada espera, ni uno mas.
      expect(mockRefresh).toHaveBeenCalledTimes(ESPERAS_REINTENTO_RESTAURACION_MS.length + 1);
      expect(s.isAuthenticated).toBe(false);
      expect(s.sessionHint).toBe(true);
      expect(s.restauracion).toBe('sin_conexion');
      expect(s.logoutReason).toBeNull();

      // El boton del aviso: se ve reintentando de inmediato y, con red, entra.
      mockRefresh.mockReset();
      mockRefresh.mockResolvedValue(restaurada);
      const reintento = useAuthStore.getState().bootstrap();
      expect(useAuthStore.getState().restauracion).toBe('reintentando');
      await reintento;
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().restauracion).toBe('normal');
    });

    it('un 5xx tambien es pasajero', async () => {
      mockRefresh.mockResolvedValue({ success: false, error: { code: 'INTERNAL_ERROR', message: 'x' } });
      const arranque = useAuthStore.getState().bootstrap();
      await vi.advanceTimersByTimeAsync(totalEsperas);
      await arranque;
      expect(useAuthStore.getState().sessionHint).toBe(true);
      expect(useAuthStore.getState().restauracion).toBe('sin_conexion');
    });

    it.each(['REFRESH_FAILED', 'INVALID_BODY'])('%s cierra la sesion sin reintentar', async (codigo) => {
      mockRefresh.mockResolvedValue({ success: false, error: { code: codigo, message: 'x' } });
      await useAuthStore.getState().bootstrap();
      const s = useAuthStore.getState();
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(s.isAuthenticated).toBe(false);
      expect(s.sessionHint).toBe(false);
      expect(s.restauracion).toBe('normal');
      expect(s.logoutReason).toBeNull();
    });

    it('una cuenta bloqueada no se reintenta y el login dice por que', async () => {
      mockRefresh.mockResolvedValue({ success: false, error: { code: 'ACCOUNT_BLOCKED', message: 'account blocked' } });
      await useAuthStore.getState().bootstrap();
      const s = useAuthStore.getState();
      expect(mockRefresh).toHaveBeenCalledTimes(1);
      expect(s.sessionHint).toBe(false);
      expect(s.logoutReason).toBe('blocked');
    });

    it('dos arranques a la vez hacen un solo refresh', async () => {
      mockRefresh.mockResolvedValue(restaurada);
      const uno = useAuthStore.getState().bootstrap();
      const dos = useAuthStore.getState().bootstrap();
      expect(dos).toBe(uno);
      await Promise.all([uno, dos]);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it('un login durante los reintentos no queda pisado', async () => {
      mockRefresh.mockResolvedValue(sinRed);
      const arranque = useAuthStore.getState().bootstrap();
      await vi.advanceTimersByTimeAsync(0);

      const ok = await useAuthStore.getState().login('702650930', 'Kiramopay2024!');
      expect(ok.success).toBe(true);

      await vi.advanceTimersByTimeAsync(totalEsperas);
      await arranque;
      const s = useAuthStore.getState();
      expect(s.isAuthenticated).toBe(true);
      expect(s.accessToken).toBe('fake-access');
      expect(s.restauracion).toBe('normal');
      // El arranque dejo de reintentar al ver la sesion nueva.
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it('el aviso se puede descartar y no se persiste', async () => {
      mockRefresh.mockResolvedValue(sinRed);
      const arranque = useAuthStore.getState().bootstrap();
      await vi.advanceTimersByTimeAsync(totalEsperas);
      await arranque;
      expect(useAuthStore.getState().restauracion).toBe('sin_conexion');

      const persistido = JSON.parse(localStorage.getItem('kiramopay-auth')!);
      expect(persistido.state.restauracion).toBeUndefined();

      useAuthStore.getState().descartarAvisoRestauracion();
      expect(useAuthStore.getState().restauracion).toBe('normal');
      // Descartar el aviso no cierra la sesion guardada.
      expect(useAuthStore.getState().sessionHint).toBe(true);
    });
  });

  // A mitad de sesion, un 401 pide renovar. Antes cualquier fallo de esa
  // renovacion (sin red, un 429, un 5xx) cerraba la sesion sin explicacion.
  describe('renovacion a mitad de sesion', () => {
    const sinRed = { success: false, error: { code: 'NETWORK_ERROR', message: 'sin red' } };
    const renovada = { success: true, data: { access_token: 'nuevo-access', refresh_token: 'nuevo-refresh' } };

    async function entrar() {
      await useAuthStore.getState().login('702650930', 'Kiramopay2024!');
      expect(useAuthStore.getState().refreshToken).toBe('fake-refresh');
    }

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('renueva los tokens y guarda el rotado en el almacen seguro', async () => {
      await entrar();
      const guardar = vi.spyOn(secureTokenStore, 'setRefreshToken');
      mockRefresh.mockResolvedValue(renovada);

      await expect(useAuthStore.getState().refresh()).resolves.toBe('renovada');

      expect(mockRefresh).toHaveBeenCalledWith('fake-refresh');
      expect(useAuthStore.getState().accessToken).toBe('nuevo-access');
      expect(useAuthStore.getState().refreshToken).toBe('nuevo-refresh');
      // Sin esto, en el telefono el proximo arranque presentaba el token ya
      // consumido y el servidor cerraba la sesion por reuso.
      expect(guardar).toHaveBeenCalledWith('nuevo-refresh');
    });

    it.each([
      ['NETWORK_ERROR', 'pasajero'],
      ['RATE_LIMITED', 'pasajero'],
      ['INTERNAL_ERROR', 'pasajero'],
      ['HTTP_ERROR', 'pasajero'],
      ['REFRESH_FAILED', 'rechazada'],
      ['INVALID_BODY', 'rechazada'],
      ['ACCOUNT_BLOCKED', 'bloqueada'],
    ])('un fallo %s es %s y no toca la sesion por si solo', async (codigo, esperado) => {
      await entrar();
      mockRefresh.mockResolvedValue({ success: false, error: { code: codigo, message: 'x' } });

      await expect(useAuthStore.getState().refresh()).resolves.toBe(esperado);

      // Quien decide cerrar es el cliente HTTP; el store solo informa.
      expect(useAuthStore.getState().isAuthenticated).toBe(true);
      expect(useAuthStore.getState().accessToken).toBe('fake-access');
    });

    it('sin token en memoria la renovacion es un rechazo', async () => {
      await expect(useAuthStore.getState().refresh()).resolves.toBe('rechazada');
      expect(mockRefresh).not.toHaveBeenCalled();
    });

    it('si la persona sale mientras se renueva, el resultado se descarta', async () => {
      await entrar();
      let responder: (r: unknown) => void = () => {};
      mockRefresh.mockReturnValue(new Promise((r) => { responder = r; }));

      const renovacion = useAuthStore.getState().refresh();
      useAuthStore.getState().logout();
      responder(renovada);

      await expect(renovacion).resolves.toBe('descartada');
      expect(useAuthStore.getState().accessToken).toBeNull();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
    });

    describe('con el cliente HTTP real', () => {
      const fetch401 = () =>
        ({ status: 401, ok: false, json: async () => ({ error: { code: 'TOKEN_EXPIRED', message: 'x' } }) }) as unknown as Response;
      const totalEsperas = ESPERAS_REINTENTO_REFRESCO_MS.reduce((a, b) => a + b, 0);

      beforeEach(() => {
        vi.useFakeTimers();
      });

      it('un fallo pasajero que no se recupera deja a la persona dentro con un aviso traducido', async () => {
        await entrar();
        const fetchMock = vi.fn().mockResolvedValue(fetch401());
        vi.stubGlobal('fetch', fetchMock);
        mockRefresh.mockResolvedValue(sinRed);

        const pendiente = new HttpClient('http://x').get('/api/v1/wallets/me');
        await vi.advanceTimersByTimeAsync(totalEsperas);
        const r = await pendiente;

        expect(r.success).toBe(false);
        expect(r.error?.code).toBe('SESSION_UNCONFIRMED');
        expect(r.error?.message).toBe(traducirFueraDeReact('err_session_unconfirmed'));
        // Un intento y un reintento por espera; la peticion no se repitio.
        expect(mockRefresh).toHaveBeenCalledTimes(ESPERAS_REINTENTO_REFRESCO_MS.length + 1);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const s = useAuthStore.getState();
        expect(s.isAuthenticated).toBe(true);
        expect(s.sessionHint).toBe(true);
        expect(s.accessToken).toBe('fake-access');
      });

      it('si la red vuelve durante los reintentos, la peticion se repite con el token nuevo', async () => {
        await entrar();
        const fetchMock = vi
          .fn()
          .mockResolvedValueOnce(fetch401())
          .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ data: { ok: 1 } }) });
        vi.stubGlobal('fetch', fetchMock);
        mockRefresh.mockResolvedValueOnce(sinRed).mockResolvedValueOnce(renovada);

        const pendiente = new HttpClient('http://x').get<{ ok: number }>('/api/v1/wallets/me');
        await vi.advanceTimersByTimeAsync(ESPERAS_REINTENTO_REFRESCO_MS[0]);
        const r = await pendiente;

        expect(r).toEqual({ success: true, data: { ok: 1 } });
        expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer nuevo-access');
        expect(useAuthStore.getState().isAuthenticated).toBe(true);
      });

      it('un rechazo definitivo si cierra la sesion', async () => {
        await entrar();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetch401()));
        mockRefresh.mockResolvedValue({ success: false, error: { code: 'REFRESH_FAILED', message: 'x' } });

        const r = await new HttpClient('http://x').get('/api/v1/wallets/me');

        expect(r.error?.code).toBe('SESSION_EXPIRED');
        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(useAuthStore.getState().isAuthenticated).toBe(false);
        expect(useAuthStore.getState().logoutReason).toBeNull();
      });

      it('una cuenta bloqueada cierra la sesion y el login dice por que', async () => {
        await entrar();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fetch401()));
        mockRefresh.mockResolvedValue({ success: false, error: { code: 'ACCOUNT_BLOCKED', message: 'x' } });

        const r = await new HttpClient('http://x').get('/api/v1/wallets/me');

        expect(r.error?.code).toBe('ACCOUNT_BLOCKED');
        expect(useAuthStore.getState().isAuthenticated).toBe(false);
        expect(useAuthStore.getState().logoutReason).toBe('blocked');
      });
    });
  });

  describe('expulsion por bloqueo remoto (logoutReason)', () => {
    it("forceLogout('blocked') cierra la sesion y deja el motivo", async () => {
      await useAuthStore.getState().login('702650930', 'Kiramopay2024!');
      useAuthStore.getState().forceLogout('blocked');
      const s = useAuthStore.getState();
      expect(s.isAuthenticated).toBe(false);
      expect(s.user).toBeNull();
      expect(s.accessToken).toBeNull();
      expect(s.refreshToken).toBeNull();
      expect(s.logoutReason).toBe('blocked');
    });

    it('forceLogout() sin motivo deja logoutReason en null', async () => {
      await useAuthStore.getState().login('702650930', 'Kiramopay2024!');
      useAuthStore.getState().forceLogout();
      expect(useAuthStore.getState().isAuthenticated).toBe(false);
      expect(useAuthStore.getState().logoutReason).toBeNull();
    });

    it('clearLogoutReason() descarta el motivo', () => {
      useAuthStore.getState().forceLogout('blocked');
      expect(useAuthStore.getState().logoutReason).toBe('blocked');
      useAuthStore.getState().clearLogoutReason();
      expect(useAuthStore.getState().logoutReason).toBeNull();
    });

    it('un login exitoso limpia el motivo de la expulsion anterior', async () => {
      useAuthStore.getState().forceLogout('blocked');
      const ok = await useAuthStore.getState().login('702650930', 'Kiramopay2024!');
      expect(ok.success).toBe(true);
      expect(useAuthStore.getState().logoutReason).toBeNull();
    });

    it('el motivo NO se persiste: vive solo en memoria', () => {
      useAuthStore.getState().forceLogout('blocked');
      const persisted = localStorage.getItem('kiramopay-auth');
      expect(persisted).not.toBeNull();
      const parsed = JSON.parse(persisted!);
      expect(parsed.state.logoutReason).toBeUndefined();
    });
  });
});
