import { render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';
import { BusinessSettingsView } from '../BusinessSettingsView';

// Los ajustes dicen quien eres en este comercio y, si no eres el dueno, quien
// es: a quien pedirle un permiso o un cambio.

vi.mock('@/api', () => ({ getApiLayer: () => ({ qrPayments: { updateMerchant: vi.fn() } }) }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

vi.mock('../BusinessTeamSheet', () => ({ BusinessTeamSheet: () => null }));
vi.mock('../BusinessLocationsSheet', () => ({ BusinessLocationsSheet: () => null }));
vi.mock('../BusinessCatalogSheet', () => ({ BusinessCatalogSheet: () => null }));

const comercio = (extra: Partial<QRMerchant>): QRMerchant => ({
  id: '5b0e7c1e-2a3f-4d5b-9c8e-1f2a3b4c5d6e', name: 'Super La Esquina', description: '', category: 'retail', qrCode: 'MRC-1',
  active: true, cedula: '3101', cedulaType: 'juridica', legalName: 'La Esquina SA', verificationStatus: 'verified',
  commissionBps: 50, comisionEfectivaBps: 50, promoHasta: null, plan: 'base', role: 'owner',
  ...extra,
});

const pintar = (m: QRMerchant) =>
  render(
    <LanguageProvider>
      <BusinessSettingsView merchant={m} onSwitchProfile={vi.fn()} onBackToPersonal={vi.fn()} onUpdated={vi.fn()} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
});

describe('BusinessSettingsView: tu rol y el dueno del comercio', () => {
  it('un cajero ve que es cajero, quien es el dueno y a quien pedirle los permisos', () => {
    pintar(comercio({ role: 'cashier', ownerName: 'Keilor Martinez' }));

    const rol = screen.getByRole('region', { name: 'Tu lugar en este comercio' });
    expect(within(rol).getByText('Tu rol')).toBeInTheDocument();
    expect(within(rol).getByText('Cajero')).toBeInTheDocument();
    expect(within(rol).getByText('Dueño del comercio')).toBeInTheDocument();
    expect(within(rol).getByText('Keilor Martinez')).toBeInTheDocument();
    expect(within(rol).getByText(/Para cambios o permisos, habla con el dueño/)).toBeInTheDocument();
  });

  it('un encargado ve su rol y al dueno', () => {
    pintar(comercio({ role: 'manager', ownerName: 'Keilor Martinez' }));

    const rol = screen.getByRole('region', { name: 'Tu lugar en este comercio' });
    expect(within(rol).getByText('Encargado')).toBeInTheDocument();
    expect(within(rol).getByText('Keilor Martinez')).toBeInTheDocument();
  });

  it('el dueno ve que es el dueno, y no se le muestra a si mismo como otra persona', () => {
    pintar(comercio({ role: 'owner', ownerName: 'Keilor Martinez' }));

    const rol = screen.getByRole('region', { name: 'Tu lugar en este comercio' });
    expect(within(rol).getByText('Dueño')).toBeInTheDocument();
    expect(within(rol).queryByText('Dueño del comercio')).toBeNull();
    expect(within(rol).queryByText(/habla con el dueño/)).toBeNull();
  });

  it('si el servidor no dio el nombre del dueno, lo dice en vez de dejar un hueco', () => {
    pintar(comercio({ role: 'cashier' }));

    const rol = screen.getByRole('region', { name: 'Tu lugar en este comercio' });
    expect(within(rol).getByText('Dueño del comercio')).toBeInTheDocument();
    expect(within(rol).getByText('No disponible')).toBeInTheDocument();
    expect(within(rol).queryByText('—')).toBeNull();
  });

  it('cada rol explica que puede hacer', () => {
    pintar(comercio({ role: 'cashier', ownerName: 'Keilor Martinez' }));
    expect(screen.getByText('Cobra para el negocio y ve las ventas')).toBeInTheDocument();
  });
});
