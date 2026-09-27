import es from '@/i18n/languages/es';
import en from '@/i18n/languages/en';
import { fijarDiccionarioActivo } from '@/i18n/mensajesDeError';
import { biometricService } from '../biometric';

// El dialogo nativo de la huella escribia el subtitulo, la descripcion y el
// boton "Cancelar" fijos en espanol: con la app en ingles, el telefono lo
// mostraba en espanol. Salen en el idioma activo, igual que los avisos que arma
// el cliente HTTP.

const { verifyIdentity } = vi.hoisted(() => {
  // El servicio decide al crearse si corre en el telefono: la marca tiene que
  // estar puesta antes de importarlo.
  (window as unknown as Record<string, unknown>).Capacitor = { isNativePlatform: () => true };
  return { verifyIdentity: vi.fn() };
});

vi.mock('capacitor-native-biometric', () => ({
  NativeBiometric: { verifyIdentity },
  BiometryType: {},
}));

beforeEach(() => {
  verifyIdentity.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  fijarDiccionarioActivo(es);
});

describe('biometricService.authenticate — los textos del dialogo nativo', () => {
  it('con la app en ingles, el dialogo sale en ingles', async () => {
    fijarDiccionarioActivo(en);

    const r = await biometricService.authenticate('Unlock KiramoPay');

    expect(r.success).toBe(true);
    expect(verifyIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'Unlock KiramoPay',
        subtitle: 'Verify your identity',
        description: 'Use your fingerprint or Face ID to continue',
        negativeButtonText: 'Cancel',
      }),
    );
  });

  it('en espanol conserva los textos de siempre', async () => {
    await biometricService.authenticate('Desbloquear KiramoPay');

    expect(verifyIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        subtitle: 'Verifica tu identidad',
        description: 'Usa tu huella digital o Face ID para continuar',
        negativeButtonText: 'Cancelar',
      }),
    );
  });
});
