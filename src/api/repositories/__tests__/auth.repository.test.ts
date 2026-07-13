import { HttpAuthRepository } from '../../adapters/http/auth.http';
import { HttpClient } from '../../adapters/http/client';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function createRepo() {
  const client = new HttpClient('http://localhost:8080');
  return new HttpAuthRepository(client);
}

function mockLoginSuccess(user = {
  id: 'user-001',
  cedula: '702650930',
  phone: '+506 8888-0000',
  first_name: 'Keilor',
  last_name: 'Martinez',
  email: 'keilor@kiramopay.com',
  kyc_level: 2,
  status: 'active',
}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        user,
        tokens: {
          access_token: 'test-access-token',
          refresh_token: 'test-refresh-token',
          expires_at: Date.now() + 3600000,
        },
      },
    }),
  });
}

function mockLoginFailure(code = 'AUTH_FAILED', message = 'Invalid credentials') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: async () => ({
      error: { code, message },
    }),
  });
}

describe('HttpAuthRepository', () => {
  let repo: HttpAuthRepository;

  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.clear();
    repo = createRepo();
  });

  describe('login', () => {
    it('should login with valid credentials', async () => {
      mockLoginSuccess();
      const result = await repo.login({ cedula: '702650930', password: 'Kiramopay2024!' });
      expect(result.success).toBe(true);
      expect(result.data?.user.firstName).toBe('Keilor');
      expect(result.data?.user.lastName).toBe('Martinez');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/auth/login',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ cedula: '702650930', password: 'Kiramopay2024!' }),
        }),
      );
    });

    it('should fail with invalid credentials', async () => {
      mockLoginFailure();
      const result = await repo.login({ cedula: '999999999', password: 'wrong' });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('AUTH_FAILED');
    });

    it('should login with admin credentials', async () => {
      mockLoginSuccess({
        id: 'user-002',
        cedula: '700000000',
        phone: '+506 7777-0000',
        first_name: 'Administrador',
        last_name: 'Sistema',
        email: 'admin@kiramopay.com',
        kyc_level: 2,
        status: 'active',
      });
      const result = await repo.login({ cedula: '700000000', password: 'Admin2024!' });
      expect(result.success).toBe(true);
      expect(result.data?.user.firstName).toBe('Administrador');
    });

    it('returns tokens in the response (kept in memory, never localStorage)', async () => {
      mockLoginSuccess();
      const result = await repo.login({ cedula: '702650930', password: 'Kiramopay2024!' });
      // Tokens are returned for the store to hold in memory — they must NOT be
      // written to localStorage (XSS exfiltration risk; Phase 20 hardening).
      expect(result.data?.tokens?.access_token).toBe('test-access-token');
      expect(result.data?.tokens?.refresh_token).toBe('test-refresh-token');
      expect(localStorage.getItem('kiramopay_access_token')).toBeNull();
      expect(localStorage.getItem('kiramopay_refresh_token')).toBeNull();
    });
  });

  describe('validatePassword', () => {
    it('should return valid for password >= 8 chars', async () => {
      const result = await repo.validatePassword('702650930', 'Kiramopay2024!');
      expect(result.success).toBe(true);
      expect(result.data?.valid).toBe(true);
    });

    it('should return invalid for short password', async () => {
      const result = await repo.validatePassword('702650930', 'short');
      expect(result.success).toBe(true);
      expect(result.data?.valid).toBe(false);
    });
  });

  describe('changePassword', () => {
    it('should change password with correct old password', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { changed: true } }),
      });
      const result = await repo.changePassword({
        cedula: '702650930',
        oldPassword: 'Kiramopay2024!',
        newPassword: 'NewPass2024!',
      });
      expect(result.success).toBe(true);
      expect(result.data?.changed).toBe(true);
    });

    it('should fail with wrong old password', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' },
        }),
      });
      const result = await repo.changePassword({
        cedula: '702650930',
        oldPassword: 'WrongPass1!',
        newPassword: 'NewPass2024!',
      });
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CHANGE_PASSWORD_FAILED');
    });
  });

  describe('forgotPassword', () => {
    it('returns the dev token when the backend (dev env) provides one', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ data: { message: 'ok', dev_token: 'reset-token-abc' } }),
      });
      const result = await repo.forgotPassword('702650930');
      expect(result.success).toBe(true);
      expect(result.data?.devToken).toBe('reset-token-abc');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/auth/forgot-password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ cedula: '702650930' }),
        }),
      );
    });

    it('succeeds without a token (anti-enumeration / production)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ data: { message: 'if the account exists, a reset link has been sent' } }),
      });
      const result = await repo.forgotPassword('999999999');
      expect(result.success).toBe(true);
      expect(result.data?.devToken).toBeUndefined();
    });
  });

  describe('resetPassword', () => {
    it('resets the password with a valid token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { message: 'Password reset successful' } }),
      });
      const result = await repo.resetPassword('valid-token', 'NewPass2024!');
      expect(result.success).toBe(true);
      expect(result.data?.reset).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8080/api/v1/auth/reset-password',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ token: 'valid-token', new_password: 'NewPass2024!' }),
        }),
      );
    });

    it('preserves RESET_FAILED for an invalid or expired token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 'RESET_FAILED', message: 'invalid or expired reset token' } }),
      });
      const result = await repo.resetPassword('bad-token', 'NewPass2024!');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('RESET_FAILED');
    });

    it('preserves VALIDATION_ERROR for a weak password', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 'VALIDATION_ERROR', message: 'password too weak' } }),
      });
      const result = await repo.resetPassword('valid-token', 'weak');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('register', () => {
    it('should register a new user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            user: {
              id: 'user-new',
              cedula: '111111111',
              phone: '+506 8888-1111',
              first_name: 'Test',
              last_name: 'User',
              email: '',
            },
            tokens: {
              access_token: 'new-access',
              refresh_token: 'new-refresh',
            },
          },
        }),
      });
      const result = await repo.register({
        cedula: '111111111',
        phone: '+506 8888-1111',
        firstName: 'Test',
        lastName: 'User',
        password: 'Test2024!',
      });
      expect(result.success).toBe(true);
      expect(result.data?.user.firstName).toBe('Test');
    });

    it('should fail for duplicate cédula', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          error: { code: 'USER_EXISTS', message: 'User already exists' },
        }),
      });
      const result = await repo.register({
        cedula: '702650930',
        phone: '+506 8888-2222',
        firstName: 'Dup',
        lastName: 'User',
        password: 'Test2024!',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('refresh', () => {
    it('exchanges a refresh token for a fresh pair', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            access_token: 'rotated-access',
            refresh_token: 'rotated-refresh',
            expires_at: 123,
          },
        }),
      });
      const result = await repo.refresh('old-refresh');
      expect(result.success).toBe(true);
      expect(result.data?.access_token).toBe('rotated-access');
      expect(result.data?.refresh_token).toBe('rotated-refresh');
    });

    it('fails on an invalid/expired refresh token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { code: 'REFRESH_FAILED', message: 'invalid refresh token' } }),
      });
      const result = await repo.refresh('bad-refresh');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('REFRESH_FAILED');
    });
  });
});
