// Servicio de almacenamiento local persistente

const STORAGE_KEYS = {
  APP_STATE: 'kiramopay_state',
  USER_SESSION: 'kiramopay_session',
  REGISTERED_USERS: 'kiramopay_users',
} as const;

// Usuarios de prueba predefinidos (datos de perfil solamente — la autenticación va por el backend DB)
export const DEFAULT_USERS = [
  {
    id: 'user-001',
    cedula: '702650930',
    phone: '+506 8888-0000',
    firstName: 'Keilor',
    lastName: 'Martinez',
    email: 'keilor@kiramopay.com',
    kycLevel: 2 as const,
    createdAt: '2024-01-15',
    biometricEnabled: true,
  },
  {
    id: 'user-002',
    cedula: '700000000',
    phone: '+506 7777-0000',
    firstName: 'Administrador',
    lastName: 'Sistema',
    email: 'admin@kiramopay.com',
    kycLevel: 2 as const,
    createdAt: '2024-01-01',
    biometricEnabled: true,
  },
];

export interface StoredUser {
  id: string;
  cedula: string;
  phone: string;
  firstName: string;
  lastName: string;
  email?: string;
  kycLevel: 0 | 1 | 2;
  createdAt: string;
  biometricEnabled: boolean;
}

export interface UserSession {
  userId: string;
  cedula: string;
  isAuthenticated: boolean;
  lastLogin: string;
  biometricToken?: string;
}

class StorageService {
  // Inicializar usuarios por defecto si no existen
  initializeDefaultUsers(): void {
    const existingUsers = this.getRegisteredUsers();
    if (existingUsers.length === 0) {
      localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(DEFAULT_USERS));
    }
  }

  // Obtener usuarios registrados
  getRegisteredUsers(): StoredUser[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.REGISTERED_USERS);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  // Buscar usuario por cédula
  findUserByCedula(cedula: string): StoredUser | undefined {
    const users = this.getRegisteredUsers();
    return users.find(u => u.cedula === cedula.replace(/-/g, ''));
  }

  // Alias para compatibilidad
  getUserByCedula(cedula: string): StoredUser | undefined {
    return this.findUserByCedula(cedula);
  }

  // Guardar sesión
  saveSession(session: UserSession): void {
    localStorage.setItem(STORAGE_KEYS.USER_SESSION, JSON.stringify(session));
  }

  // Obtener sesión
  getSession(): UserSession | null {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.USER_SESSION);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  // Cerrar sesión
  clearSession(): void {
    localStorage.removeItem(STORAGE_KEYS.USER_SESSION);
  }

  // Guardar estado de la app
  saveAppState(state: Record<string, unknown>): void {
    try {
      // Excluir datos sensibles del almacenamiento
      const stateToSave = {
        ...state,
        passwordHash: undefined, // No guardar hash en localStorage por seguridad
      };
      localStorage.setItem(STORAGE_KEYS.APP_STATE, JSON.stringify(stateToSave));
    } catch {
      // Silently fail — localStorage may be full or unavailable
    }
  }

  // Cargar estado de la app
  loadAppState(): Record<string, unknown> | null {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.APP_STATE);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  // Actualizar usuario
  updateUser(cedula: string, updates: Partial<StoredUser>): boolean {
    try {
      const users = this.getRegisteredUsers();
      const index = users.findIndex(u => u.cedula === cedula.replace(/-/g, ''));
      if (index !== -1) {
        users[index] = { ...users[index], ...updates };
        localStorage.setItem(STORAGE_KEYS.REGISTERED_USERS, JSON.stringify(users));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Habilitar/deshabilitar biometría
  toggleBiometric(cedula: string, enabled: boolean): boolean {
    return this.updateUser(cedula, { biometricEnabled: enabled });
  }
}

export const storageService = new StorageService();
