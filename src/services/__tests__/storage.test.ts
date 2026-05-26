import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { storageService, DEFAULT_USERS } from '../storage';
import type { StoredUser, UserSession } from '../storage';

describe('StorageService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('initializeDefaultUsers', () => {
    it('stores default users when localStorage is empty', () => {
      storageService.initializeDefaultUsers();

      const stored = localStorage.getItem('kiramopay_users');
      expect(stored).not.toBeNull();

      const users: StoredUser[] = JSON.parse(stored!);
      expect(users).toHaveLength(2);
      expect(users[0].cedula).toBe('702650930');
      expect(users[1].cedula).toBe('700000000');
    });

    it('does not overwrite existing users', () => {
      const customUsers = [
        { ...DEFAULT_USERS[0], firstName: 'Custom' },
      ];
      localStorage.setItem('kiramopay_users', JSON.stringify(customUsers));

      storageService.initializeDefaultUsers();

      const stored = JSON.parse(localStorage.getItem('kiramopay_users')!);
      expect(stored).toHaveLength(1);
      expect(stored[0].firstName).toBe('Custom');
    });
  });

  describe('getRegisteredUsers', () => {
    it('returns empty array when no users stored', () => {
      const users = storageService.getRegisteredUsers();
      expect(users).toEqual([]);
    });

    it('returns stored users', () => {
      localStorage.setItem('kiramopay_users', JSON.stringify(DEFAULT_USERS));
      const users = storageService.getRegisteredUsers();
      expect(users).toHaveLength(2);
      expect(users[0].firstName).toBe('Keilor');
      expect(users[1].firstName).toBe('Administrador');
    });

    it('returns empty array on corrupted JSON', () => {
      localStorage.setItem('kiramopay_users', 'not-valid-json{{{');
      const users = storageService.getRegisteredUsers();
      expect(users).toEqual([]);
    });
  });

  describe('findUserByCedula', () => {
    beforeEach(() => {
      localStorage.setItem('kiramopay_users', JSON.stringify(DEFAULT_USERS));
    });

    it('finds user by exact cedula', () => {
      const user = storageService.findUserByCedula('702650930');
      expect(user).toBeDefined();
      expect(user!.firstName).toBe('Keilor');
    });

    it('finds user by cedula with dashes (strips them)', () => {
      const user = storageService.findUserByCedula('7-0265-0930');
      expect(user).toBeDefined();
      expect(user!.cedula).toBe('702650930');
    });

    it('returns undefined for non-existent cedula', () => {
      const user = storageService.findUserByCedula('999999999');
      expect(user).toBeUndefined();
    });
  });

  describe('getUserByCedula (alias)', () => {
    it('delegates to findUserByCedula', () => {
      localStorage.setItem('kiramopay_users', JSON.stringify(DEFAULT_USERS));
      const user = storageService.getUserByCedula('702650930');
      expect(user).toBeDefined();
      expect(user!.firstName).toBe('Keilor');
    });
  });

  describe('saveSession / getSession / clearSession', () => {
    const session: UserSession = {
      userId: 'user-001',
      cedula: '702650930',
      isAuthenticated: true,
      lastLogin: '2026-02-16T10:00:00Z',
    };

    it('saves and retrieves a session', () => {
      storageService.saveSession(session);
      const loaded = storageService.getSession();
      expect(loaded).toEqual(session);
    });

    it('returns null when no session stored', () => {
      expect(storageService.getSession()).toBeNull();
    });

    it('returns null on corrupted session JSON', () => {
      localStorage.setItem('kiramopay_session', '{bad json');
      expect(storageService.getSession()).toBeNull();
    });

    it('clears session from localStorage', () => {
      storageService.saveSession(session);
      expect(storageService.getSession()).not.toBeNull();

      storageService.clearSession();
      expect(storageService.getSession()).toBeNull();
      expect(localStorage.getItem('kiramopay_session')).toBeNull();
    });

    it('saves session with optional biometricToken', () => {
      const sessionWithBio: UserSession = { ...session, biometricToken: 'bio-token-123' };
      storageService.saveSession(sessionWithBio);
      const loaded = storageService.getSession();
      expect(loaded!.biometricToken).toBe('bio-token-123');
    });
  });

  describe('saveAppState / loadAppState', () => {
    it('saves and loads app state', () => {
      const state = { activeTab: 'home', theme: 'dark' };
      storageService.saveAppState(state);
      const loaded = storageService.loadAppState();
      expect(loaded!.activeTab).toBe('home');
      expect(loaded!.theme).toBe('dark');
    });

    it('strips passwordHash from saved state for security', () => {
      const state = { activeTab: 'home', passwordHash: 'secret-hash-123' };
      storageService.saveAppState(state);

      const raw = JSON.parse(localStorage.getItem('kiramopay_state')!);
      expect(raw.passwordHash).toBeUndefined();
      expect(raw.activeTab).toBe('home');
    });

    it('returns null when no state stored', () => {
      expect(storageService.loadAppState()).toBeNull();
    });

    it('returns null on corrupted state JSON', () => {
      localStorage.setItem('kiramopay_state', 'corrupted');
      expect(storageService.loadAppState()).toBeNull();
    });
  });

  describe('updateUser', () => {
    beforeEach(() => {
      localStorage.setItem('kiramopay_users', JSON.stringify(DEFAULT_USERS));
    });

    it('updates existing user and returns true', () => {
      const result = storageService.updateUser('702650930', { firstName: 'Updated' });
      expect(result).toBe(true);

      const user = storageService.findUserByCedula('702650930');
      expect(user!.firstName).toBe('Updated');
    });

    it('handles cedula with dashes', () => {
      const result = storageService.updateUser('7-0265-0930', { email: 'new@email.com' });
      expect(result).toBe(true);

      const user = storageService.findUserByCedula('702650930');
      expect(user!.email).toBe('new@email.com');
    });

    it('returns false for non-existent cedula', () => {
      const result = storageService.updateUser('999999999', { firstName: 'Ghost' });
      expect(result).toBe(false);
    });

    it('preserves other user fields when updating', () => {
      storageService.updateUser('702650930', { firstName: 'NewName' });
      const user = storageService.findUserByCedula('702650930');
      expect(user!.firstName).toBe('NewName');
      expect(user!.lastName).toBe('Martinez');
      expect(user!.phone).toBe('+506 8888-0000');
    });
  });

  describe('toggleBiometric', () => {
    beforeEach(() => {
      localStorage.setItem('kiramopay_users', JSON.stringify(DEFAULT_USERS));
    });

    it('disables biometric for user', () => {
      const result = storageService.toggleBiometric('702650930', false);
      expect(result).toBe(true);

      const user = storageService.findUserByCedula('702650930');
      expect(user!.biometricEnabled).toBe(false);
    });

    it('enables biometric for user', () => {
      storageService.toggleBiometric('702650930', false);
      storageService.toggleBiometric('702650930', true);

      const user = storageService.findUserByCedula('702650930');
      expect(user!.biometricEnabled).toBe(true);
    });

    it('returns false for non-existent user', () => {
      const result = storageService.toggleBiometric('000000000', true);
      expect(result).toBe(false);
    });
  });

  describe('DEFAULT_USERS', () => {
    it('contains exactly 2 test users', () => {
      expect(DEFAULT_USERS).toHaveLength(2);
    });

    it('has Keilor with correct cedula', () => {
      const keilor = DEFAULT_USERS.find(u => u.cedula === '702650930');
      expect(keilor).toBeDefined();
      expect(keilor!.firstName).toBe('Keilor');
      expect(keilor!.kycLevel).toBe(2);
    });

    it('has Admin with correct cedula', () => {
      const admin = DEFAULT_USERS.find(u => u.cedula === '700000000');
      expect(admin).toBeDefined();
      expect(admin!.firstName).toBe('Administrador');
      expect(admin!.kycLevel).toBe(2);
    });

    it('does not contain password fields (auth goes through backend)', () => {
      for (const user of DEFAULT_USERS) {
        expect((user as unknown as Record<string, unknown>).password).toBeUndefined();
        expect((user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();
        expect((user as unknown as Record<string, unknown>).pin).toBeUndefined();
        expect((user as unknown as Record<string, unknown>).pinHash).toBeUndefined();
      }
    });
  });
});
