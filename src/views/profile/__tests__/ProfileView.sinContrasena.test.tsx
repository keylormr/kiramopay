import { cleanup, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import es from '@/i18n/languages/es';
import en from '@/i18n/languages/en';
import fr from '@/i18n/languages/fr';
import pt from '@/i18n/languages/pt';
import zh from '@/i18n/languages/zh-cn';
import ja from '@/i18n/languages/ja';
import hi from '@/i18n/languages/hi';
import { ProfileView } from '../ProfileView';

// Las cuentas que entran sin contrasena (las de demostracion, con la bandera del
// servidor encendida) veian "Cambiar contrasena" y "Eliminar cuenta", y las dos
// fallaban porque piden la contrasena actual. El servidor dice cuales son
// (passwordless_login); en esas cuentas las dos opciones no se ofrecen y una
// linea explica por que. El servidor sigue rechazando las dos si alguien las
// llama directo.

const BASE = { id: 'u1', firstName: 'Keilor', lastName: 'Mora', kycLevel: 1, email: '' };

const mocks = vi.hoisted(() => ({ usuario: {} as Record<string, unknown> }));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => ({
    kyc: { getStatus: vi.fn().mockResolvedValue({ success: false }), verifyIdentity: vi.fn() },
    loyalty: { getReferralSummary: vi.fn().mockResolvedValue({ success: false }) },
    mfa: { totpStatus: vi.fn().mockResolvedValue({ success: false }) },
    qrPayments: {
      listPendingMerchants: vi.fn().mockResolvedValue({ success: false }),
      listClosedMerchants: vi.fn().mockResolvedValue({ success: true, data: [] }),
    },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      user: mocks.usuario,
      settings: { biometricEnabled: false, notifications: true, language: 'es' },
      transactions: [],
      theme: 'light',
    },
    dispatch: vi.fn(),
  }),
}));

function pintar() {
  return render(
    <LanguageProvider>
      <ProfileView />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  mocks.usuario = { ...BASE };
});

afterEach(() => {
  cleanup();
});

describe('ProfileView: cuenta que entra sin contrasena', () => {
  it('no ofrece cambiar la contrasena ni eliminar la cuenta, y dice por que', () => {
    mocks.usuario = { ...BASE, passwordlessLogin: true };
    pintar();

    expect(screen.queryByRole('button', { name: /Cambiar contraseña/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Eliminar mi cuenta/ })).toBeNull();
    expect(screen.getByText(/cuenta de demostración que entra sin contraseña/i)).toBeInTheDocument();
  });

  // Lo que no se debe romper: una cuenta con contrasena sigue viendo las dos
  // opciones y no ve el aviso.
  it('una cuenta con contrasena conserva las dos opciones y no ve el aviso', () => {
    mocks.usuario = { ...BASE, passwordlessLogin: false };
    pintar();

    expect(screen.getByRole('button', { name: /Cambiar contraseña/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Eliminar mi cuenta/ })).toBeInTheDocument();
    expect(screen.queryByText(/cuenta de demostración que entra sin contraseña/i)).toBeNull();
  });

  // Un servidor viejo no manda el dato: se trata como cuenta normal.
  it('si el servidor no dice nada, se comporta como una cuenta normal', () => {
    pintar();

    expect(screen.getByRole('button', { name: /Cambiar contraseña/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Eliminar mi cuenta/ })).toBeInTheDocument();
    expect(screen.queryByText(/cuenta de demostración que entra sin contraseña/i)).toBeNull();
  });
});

describe('profile_demo_account: el aviso existe en los siete idiomas', () => {
  const idiomas: Array<[string, Record<string, string>]> = [
    ['es', es as unknown as Record<string, string>],
    ['en', en as unknown as Record<string, string>],
    ['fr', fr as unknown as Record<string, string>],
    ['pt', pt as unknown as Record<string, string>],
    ['zh-cn', zh as unknown as Record<string, string>],
    ['ja', ja as unknown as Record<string, string>],
    ['hi', hi as unknown as Record<string, string>],
  ];

  it.each(idiomas)('%s', (_idioma, d) => {
    expect(d.profile_demo_account?.trim()).toBeTruthy();
  });

  it('los idiomas distintos del espanol no repiten el texto en espanol', () => {
    const textoEs = (es as unknown as Record<string, string>).profile_demo_account;
    for (const [idioma, d] of idiomas.filter(([i]) => i !== 'es')) {
      expect(d.profile_demo_account, idioma).not.toBe(textoEs);
    }
  });
});
