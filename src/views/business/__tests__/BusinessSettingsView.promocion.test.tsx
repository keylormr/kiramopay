import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';
import { BusinessSettingsView } from '../BusinessSettingsView';

vi.mock('@/api', () => ({ getApiLayer: () => ({ qrPayments: { updateMerchant: vi.fn() } }) }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

// Las hojas de equipo, sucursales y catalogo no son parte de esta prueba.
vi.mock('../BusinessTeamSheet', () => ({ BusinessTeamSheet: () => null }));
vi.mock('../BusinessLocationsSheet', () => ({ BusinessLocationsSheet: () => null }));
vi.mock('../BusinessCatalogSheet', () => ({ BusinessCatalogSheet: () => null }));

const ID = '5b0e7c1e-2a3f-4d5b-9c8e-1f2a3b4c5d6e';

const comercio = (extra: Partial<QRMerchant>): QRMerchant => ({
  id: ID, name: 'Soda Tica', description: '', category: 'restaurant', qrCode: 'MRC-1', active: true,
  cedula: '3101', cedulaType: 'juridica', legalName: 'Soda Tica SA', verificationStatus: 'verified',
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

describe('BusinessSettingsView: la comision que se cobra hoy', () => {
  it('con la promocion vigente dice cuanto paga, hasta cuando y cuanto despues', () => {
    pintar(comercio({ comisionEfectivaBps: 25, promoHasta: '2099-12-13T12:00:00Z' }));

    expect(screen.getByText('0.25%')).toBeInTheDocument();
    expect(
      screen.getByText(/Promoción de entrada: pagas 0\.25% hasta el 13 de diciembre de 2099\. Después, 0\.5%\./),
    ).toBeInTheDocument();
  });

  it('con la promocion terminada muestra la comision fijada y cuando termino', () => {
    pintar(comercio({ comisionEfectivaBps: 50, promoHasta: '2020-01-10T12:00:00Z' }));

    expect(screen.getByText('0.5%')).toBeInTheDocument();
    expect(screen.getByText(/Tu promoción de entrada terminó el 10 de enero de 2020\./)).toBeInTheDocument();
    expect(screen.queryByText(/pagas/)).toBeNull();
  });

  it('un comercio que nunca tuvo promocion no la menciona', () => {
    pintar(comercio({}));

    expect(screen.getByText('0.5%')).toBeInTheDocument();
    expect(screen.queryByText(/Promoción de entrada/)).toBeNull();
  });

  it('si el administrador fijo una comision menor, se muestra esa y no una promocion que no cambia nada', () => {
    pintar(comercio({ commissionBps: 10, comisionEfectivaBps: 10, promoHasta: '2099-12-13T12:00:00Z' }));

    expect(screen.getByText('0.1%')).toBeInTheDocument();
    expect(screen.queryByText(/pagas/)).toBeNull();
  });

  it('muestra el plan del comercio', () => {
    pintar(comercio({ plan: 'analitica' }));
    expect(screen.getByText('Analítica')).toBeInTheDocument();
  });
});

describe('BusinessSettingsView: el identificador para un piloto', () => {
  it('el dueno ve el identificador y lo copia', async () => {
    // userEvent instala su propio portapapeles: se espia despues de crearlo.
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText');
    pintar(comercio({}));

    expect(screen.getByText(ID)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copiar Identificador del comercio' }));

    expect(writeText).toHaveBeenCalledWith(ID);
    expect(await screen.findByText('Identificador copiado')).toBeInTheDocument();
  });

  it('un cajero no lo ve', () => {
    pintar(comercio({ role: 'cashier' }));
    expect(screen.queryByText(ID)).toBeNull();
  });
});
