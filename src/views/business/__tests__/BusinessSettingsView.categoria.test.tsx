import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';
import { BusinessSettingsView } from '../BusinessSettingsView';

// El servidor guardaba cualquier categoria. Un comercio con una que la app no
// traduce (por ejemplo "other") mostraba la clave de traduccion cruda en su
// propio panel, y al editarlo el selector parecia ofrecer otra categoria
// mientras el formulario conservaba la vieja.

const mocks = vi.hoisted(() => ({ updateMerchant: vi.fn() }));

vi.mock('@/api', () => ({ getApiLayer: () => ({ qrPayments: { updateMerchant: mocks.updateMerchant } }) }));

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
  id: '5b0e7c1e-2a3f-4d5b-9c8e-1f2a3b4c5d6e', name: 'Soda Tica', description: '', category: 'restaurant',
  qrCode: 'MRC-1', active: true, cedula: '3101', cedulaType: 'juridica', legalName: 'Soda Tica SA',
  verificationStatus: 'verified', commissionBps: 50, comisionEfectivaBps: 50, promoHasta: null, plan: 'base',
  role: 'owner',
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
  mocks.updateMerchant.mockReset();
});

describe('BusinessSettingsView: categoria sin traduccion', () => {
  it('muestra Otro y no la clave cruda', () => {
    pintar(comercio({ category: 'other' }));

    expect(screen.getByText('Otro')).toBeInTheDocument();
    expect(screen.queryByText(/merchant_cat_/)).toBeNull();
  });

  it('una categoria conocida se sigue mostrando traducida', () => {
    pintar(comercio({ category: 'market' }));

    expect(screen.getByText('Mercado')).toBeInTheDocument();
  });

  it('al editar, el selector muestra la categoria que el comercio tiene de verdad', async () => {
    mocks.updateMerchant.mockResolvedValue({ success: true, data: comercio({ category: 'other' }) });
    const user = userEvent.setup();
    pintar(comercio({ category: 'other' }));

    await user.click(screen.getByRole('button', { name: 'Editar datos del negocio' }));

    // Sin esto el selector mostraba "Restaurante" mientras el formulario seguia
    // mandando "other": se guardaba una categoria distinta de la que se veia.
    expect(await screen.findByDisplayValue('Otro')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Restaurante')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(mocks.updateMerchant).toHaveBeenCalledTimes(1));
    expect(mocks.updateMerchant.mock.calls[0][1]).toMatchObject({ category: 'other' });
  });

  it('elegir otra categoria manda la elegida', async () => {
    mocks.updateMerchant.mockResolvedValue({ success: true, data: comercio({ category: 'retail' }) });
    const user = userEvent.setup();
    pintar(comercio({ category: 'other' }));

    await user.click(screen.getByRole('button', { name: 'Editar datos del negocio' }));
    await user.selectOptions(await screen.findByDisplayValue('Otro'), 'retail');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(mocks.updateMerchant).toHaveBeenCalledTimes(1));
    expect(mocks.updateMerchant.mock.calls[0][1]).toMatchObject({ category: 'retail' });
  });
});
