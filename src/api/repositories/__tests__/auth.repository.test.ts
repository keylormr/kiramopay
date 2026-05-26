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

    it('should store tokens on successful login', async () => {
      mockLoginSuccess();
      await repo.login({ cedula: '702650930', password: 'Kiramopay2024!' });
      expect(localStorage.getItem('kiramopay_access_token')).toBe('test-access-token');
      expect(localStorage.getItem('kiramopay_refresh_token')).toBe('test-refresh-token');
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
});
