import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { ProfileView } from '../ProfileView';

// Hallazgo QA n=62: la hoja de biometria pedia una "contrasena actual" que
// nadie verificaba; cualquier texto la activaba. Ahora encenderla pide la
// huella o el rostro al dispositivo, y donde no hay sensor (la web) la fila no
// se ofrece.

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  settings: { biometricEnabled: false },
  nativo: false,
  checkAvailability: vi.fn(),
  authenticate: vi.fn(),
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => ({
    kyc: { getStatus: vi.fn().mockResolvedValue({ success: false }), verifyIdentity: vi.fn() },
    loyalty: { getReferralSummary: vi.fn().mockResolvedValue({ success: false }) },
    mfa: { totpStatus: vi.fn().mockResolvedValue({ success: false }) },
  }),
}));

vi.mock('@/services/biometric', () => ({
  biometricService: {
    checkAvailability: mocks.checkAvailability,
    authenticate: mocks.authenticate,
  },
}));

vi.mock('@capacitor/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@capacitor/core')>();
  return {
    ...real,
    Capacitor: { ...real.Capacitor, isNativePlatform: () => mocks.nativo },
  };
});

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0, rateToUsd: 0.0019 }],
      baseCurrency: 'CRC',
      user: { id: 'u1', firstName: 'Ana', lastName: 'Mora', kycLevel: 0, email: 'a@b.co' },
      settings: { ...mocks.settings, notifications: true, language: 'es' },
      transactions: [],
      theme: 'light',
    },
    dispatch: mocks.dispatch,
  }),
}));

const FILA = /Autenticación biométrica/;

const pintar = (props: Parameters<typeof ProfileView>[0] = {}) =>
  render(
    <LanguageProvider>
      <ProfileView {...props} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  mocks.dispatch.mockReset();
  mocks.authenticate.mockReset();
  mocks.checkAvailability.mockReset();
  mocks.settings.biometricEnabled = false;
  mocks.nativo = false;
});
afterEach(cleanup);

describe('ProfileView: biometria', () => {
  it('en la web, sin sensor, la fila no se ofrece aunque la preferencia quedara encendida', async () => {
    mocks.checkAvailability.mockResolvedValue({ isAvailable: false, biometryType: 'none' });
    mocks.settings.biometricEnabled = true;
    pintar();

    await waitFor(() => expect(mocks.checkAvailability).toHaveBeenCalled());
    expect(screen.queryByRole('switch', { name: FILA })).toBeNull();
    // La etiqueta "Biometria" del encabezado tampoco promete lo que no hay.
    expect(screen.queryByText('Biometría')).toBeNull();
  });

  it('encenderla pide la huella al dispositivo y solo se activa si responde', async () => {
    mocks.checkAvailability.mockResolvedValue({ isAvailable: true, biometryType: 'fingerprint' });
    mocks.authenticate.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    pintar();

    const fila = await screen.findByRole('switch', { name: FILA });
    expect(fila).toHaveAttribute('aria-checked', 'false');
    await user.click(fila);

    await waitFor(() => expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_BIOMETRIC' }));
    expect(mocks.authenticate).toHaveBeenCalledWith('Confirma que eres tú para activar el ingreso con huella o rostro');
    // Ya no existe el campo de contrasena que nadie verificaba.
    expect(screen.queryByLabelText('Contraseña actual')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('si el sensor no confirma, no se activa y se dice', async () => {
    mocks.checkAvailability.mockResolvedValue({ isAvailable: true, biometryType: 'face' });
    mocks.authenticate.mockResolvedValue({ success: false, error: 'cancelado' });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('switch', { name: FILA }));

    expect(await screen.findByText('No se confirmó tu huella o rostro. La biometría sigue desactivada.')).toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('apagarla no pide el sensor ni una contrasena: una hoja explica y confirma', async () => {
    mocks.checkAvailability.mockResolvedValue({ isAvailable: true, biometryType: 'fingerprint' });
    mocks.settings.biometricEnabled = true;
    const user = userEvent.setup();
    pintar();

    const fila = await screen.findByRole('switch', { name: FILA });
    expect(fila).toHaveAttribute('aria-checked', 'true');
    await user.click(fila);

    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText(/Tu próximo ingreso te pedirá la contraseña o el PIN/)).toBeInTheDocument();
    expect(hoja.querySelector('input')).toBeNull();
    expect(mocks.dispatch).not.toHaveBeenCalled();

    await user.click(within(hoja).getByRole('button', { name: 'Desactivar biometría' }));

    expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'TOGGLE_BIOMETRIC' });
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it('en el telefono sin sensor disponible, si estaba encendida, se puede apagar', async () => {
    mocks.nativo = true;
    mocks.checkAvailability.mockResolvedValue({ isAvailable: false, biometryType: 'none' });
    mocks.settings.biometricEnabled = true;
    pintar();

    expect(await screen.findByRole('switch', { name: FILA })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('ProfileView: presupuestos y pagos fijos tienen entrada', () => {
  it('las dos filas abren su pantalla', async () => {
    mocks.checkAvailability.mockResolvedValue({ isAvailable: false, biometryType: 'none' });
    const onOpenBudget = vi.fn();
    const onOpenRecurring = vi.fn();
    const user = userEvent.setup();
    pintar({ onOpenBudget, onOpenRecurring });

    expect(screen.getByRole('heading', { name: 'Organiza tu dinero' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Presupuestos/ }));
    await user.click(screen.getByRole('button', { name: /Pagos fijos/ }));

    expect(onOpenBudget).toHaveBeenCalledTimes(1);
    expect(onOpenRecurring).toHaveBeenCalledTimes(1);
  });
});
