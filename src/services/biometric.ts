// Servicio de autenticación biométrica
import { NativeBiometric, BiometryType } from 'capacitor-native-biometric';

export interface BiometricResult {
  success: boolean;
  error?: string;
}

export interface BiometricAvailability {
  isAvailable: boolean;
  biometryType: 'fingerprint' | 'face' | 'iris' | 'none';
  errorMessage?: string;
}

class BiometricService {
  private isNative: boolean;

  constructor() {
    // Detectar si estamos en un entorno nativo o web
    const win = window as unknown as Record<string, { isNativePlatform: () => boolean } | undefined>;
    this.isNative = typeof win.Capacitor !== 'undefined' &&
                    !!win.Capacitor?.isNativePlatform();
  }

  // Verificar disponibilidad de biometría
  async checkAvailability(): Promise<BiometricAvailability> {
    if (!this.isNative) {
      // En web, simular que está disponible para demo
      return {
        isAvailable: true,
        biometryType: 'fingerprint',
        errorMessage: undefined,
      };
    }

    try {
      const result = await NativeBiometric.isAvailable();

      let biometryType: 'fingerprint' | 'face' | 'iris' | 'none' = 'none';

      switch (result.biometryType) {
        case BiometryType.FINGERPRINT:
        case BiometryType.TOUCH_ID:
          biometryType = 'fingerprint';
          break;
        case BiometryType.FACE_ID:
        case BiometryType.FACE_AUTHENTICATION:
          biometryType = 'face';
          break;
        case BiometryType.IRIS_AUTHENTICATION:
          biometryType = 'iris';
          break;
        default:
          biometryType = 'fingerprint'; // Default
      }

      return {
        isAvailable: result.isAvailable,
        biometryType,
      };
    } catch (error: unknown) {
      return {
        isAvailable: false,
        biometryType: 'none',
        errorMessage: error instanceof Error ? error.message : 'Error checking biometric availability',
      };
    }
  }

  // Autenticar con biometría
  async authenticate(reason?: string): Promise<BiometricResult> {
    if (!this.isNative) {
      // En web, simular autenticación exitosa para demo
      return new Promise((resolve) => {
        // Simular un delay como si fuera real
        setTimeout(() => {
          resolve({ success: true });
        }, 500);
      });
    }

    try {
      await NativeBiometric.verifyIdentity({
        reason: reason || 'Autenticación requerida',
        title: 'KiramoPay',
        subtitle: 'Verifica tu identidad',
        description: 'Usa tu huella digital o Face ID para continuar',
        negativeButtonText: 'Cancelar',
      });

      return { success: true };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Autenticación biométrica fallida',
      };
    }
  }

  // Guardar credenciales de forma segura (solo nativo)
  async setCredentials(server: string, username: string, password: string): Promise<boolean> {
    if (!this.isNative) {
      // En web, usar localStorage como fallback
      try {
        localStorage.setItem(`bio_cred_${server}`, JSON.stringify({ username, password }));
        return true;
      } catch {
        return false;
      }
    }

    try {
      await NativeBiometric.setCredentials({
        username,
        password,
        server,
      });
      return true;
    } catch {
      return false;
    }
  }

  // Obtener credenciales guardadas
  async getCredentials(server: string): Promise<{ username: string; password: string } | null> {
    if (!this.isNative) {
      try {
        const data = localStorage.getItem(`bio_cred_${server}`);
        return data ? JSON.parse(data) : null;
      } catch {
        return null;
      }
    }

    try {
      const credentials = await NativeBiometric.getCredentials({ server });
      return {
        username: credentials.username,
        password: credentials.password,
      };
    } catch {
      return null;
    }
  }

  // Eliminar credenciales
  async deleteCredentials(server: string): Promise<boolean> {
    if (!this.isNative) {
      try {
        localStorage.removeItem(`bio_cred_${server}`);
        return true;
      } catch {
        return false;
      }
    }

    try {
      await NativeBiometric.deleteCredentials({ server });
      return true;
    } catch {
      return false;
    }
  }

  // Obtener nombre legible del tipo de biometría
  getBiometryTypeName(type: 'fingerprint' | 'face' | 'iris' | 'none'): string {
    switch (type) {
      case 'fingerprint':
        return 'Huella digital';
      case 'face':
        return 'Reconocimiento facial';
      case 'iris':
        return 'Reconocimiento de iris';
      default:
        return 'No disponible';
    }
  }
}

export const biometricService = new BiometricService();
