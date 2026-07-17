import { useAuthStore } from '../auth.store';

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
});
