import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ProfileView } from '../ProfileView';

// Las entradas del administrador (verificar comercios, usuarios, disputas del
// escrow, fondo de promociones) estaban dentro de "Herramientas de comercio",
// mezcladas con las del dueno de un negocio. Tienen su propia seccion, con su
// encabezado, y solo la ve un administrador.

const mocks = vi.hoisted(() => ({ listPendingMerchants: vi.fn() }));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => ({
    kyc: { getStatus: vi.fn().mockResolvedValue({ success: false }), verifyIdentity: vi.fn() },
    loyalty: { getReferralSummary: vi.fn().mockResolvedValue({ success: false }) },
    mfa: { totpStatus: vi.fn().mockResolvedValue({ success: false }) },
    qrPayments: {
      listPendingMerchants: mocks.listPendingMerchants,
      listClosedMerchants: vi.fn().mockResolvedValue({ success: true, data: [] }),
    },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      user: { id: 'u1', firstName: 'Ana', lastName: 'Mora', kycLevel: 1, email: 'a@b.co' },
      settings: { biometricEnabled: false, notifications: true, language: 'es' },
      transactions: [],
      theme: 'light',
    },
    dispatch: vi.fn(),
  }),
}));

const ENTRADAS_DE_ADMINISTRADOR = ['Verificar comercios', 'Usuarios', 'Disputas de escrow', 'Fondo de promociones'];

// El encabezado y su lista comparten el contenedor.
const seccion = (encabezado: string) => {
  const contenedor = screen.getByRole('heading', { name: encabezado }).parentElement;
  if (!contenedor) throw new Error(`sin seccion ${encabezado}`);
  return contenedor;
};

function pintar(props: Parameters<typeof ProfileView>[0] = {}) {
  return render(
    <LanguageProvider>
      <ProfileView {...props} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  mocks.listPendingMerchants.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ProfileView: seccion de administracion', () => {
  it('un administrador ve su propia seccion con las cuatro entradas', async () => {
    mocks.listPendingMerchants.mockResolvedValue({ success: true, data: [] });
    pintar();

    await screen.findByRole('heading', { name: 'Administración' });
    const admin = within(seccion('Administración'));
    for (const entrada of ENTRADAS_DE_ADMINISTRADOR) {
      expect(admin.getByText(entrada)).toBeInTheDocument();
    }
  });

  it('las entradas del administrador ya no estan en Herramientas de comercio', async () => {
    mocks.listPendingMerchants.mockResolvedValue({ success: true, data: [] });
    pintar();

    await screen.findByRole('heading', { name: 'Administración' });
    const comercio = within(seccion('Herramientas de comercio'));
    for (const entrada of ENTRADAS_DE_ADMINISTRADOR) {
      expect(comercio.queryByText(entrada)).toBeNull();
    }
    // Lo del dueno de un negocio se queda donde estaba.
    expect(comercio.getByText('Modo negocio')).toBeInTheDocument();
  });

  it('sigue abriendo cada pantalla', async () => {
    mocks.listPendingMerchants.mockResolvedValue({ success: true, data: [] });
    const onOpenAdminDisputas = vi.fn();
    const onOpenAdminMerchants = vi.fn();
    const user = userEvent.setup();
    pintar({ onOpenAdminDisputas, onOpenAdminMerchants });

    await screen.findByRole('heading', { name: 'Administración' });
    await user.click(screen.getByRole('button', { name: /Disputas de escrow/ }));
    await user.click(screen.getByRole('button', { name: /Verificar comercios/ }));

    expect(onOpenAdminDisputas).toHaveBeenCalledTimes(1);
    expect(onOpenAdminMerchants).toHaveBeenCalledTimes(1);
  });

  it('quien no es administrador no ve la seccion ni sus entradas', async () => {
    mocks.listPendingMerchants.mockResolvedValue({ success: false, error: { code: 'FORBIDDEN', message: 'x' } });
    pintar();

    await waitFor(() => expect(mocks.listPendingMerchants).toHaveBeenCalled());
    // La consulta ya contesto: se espera una vuelta para que React pinte.
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('heading', { name: 'Administración' })).toBeNull();
    for (const entrada of ENTRADAS_DE_ADMINISTRADOR) {
      expect(screen.queryByText(entrada)).toBeNull();
    }
    expect(screen.getByRole('heading', { name: 'Herramientas de comercio' })).toBeInTheDocument();
  });
});
