import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';
import { BusinessSettingsView } from '../BusinessSettingsView';

// Guardar los datos del negocio mostraba `res.error.message`: el texto del
// servidor, en ingles. Cada rechazo conocido sale con su texto en el idioma de
// la app; lo que no se conoce, con el generico de la pantalla.

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

const comercio: QRMerchant = {
  id: '5b0e7c1e-2a3f-4d5b-9c8e-1f2a3b4c5d6e', name: 'Soda Tica', description: '', category: 'restaurant',
  qrCode: 'MRC-1', active: true, cedula: '3101', cedulaType: 'juridica', legalName: 'Soda Tica SA',
  verificationStatus: 'verified', commissionBps: 50, comisionEfectivaBps: 50, promoHasta: null, plan: 'base',
  role: 'owner',
};

async function guardarConRechazo(rechazo: { code: string; message: string }) {
  mocks.updateMerchant.mockResolvedValue({ success: false, error: rechazo });
  const user = userEvent.setup();
  render(
    <LanguageProvider>
      <BusinessSettingsView merchant={comercio} onSwitchProfile={vi.fn()} onBackToPersonal={vi.fn()} onUpdated={vi.fn()} />
    </LanguageProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Editar datos del negocio' }));
  await user.click(await screen.findByRole('button', { name: 'Guardar' }));
  await waitFor(() => expect(mocks.updateMerchant).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.updateMerchant.mockReset();
});

describe('BusinessSettingsView: los rechazos al guardar se dicen en el idioma de la app', () => {
  it('INVALID_CATEGORY tiene su texto y no se muestra el del servidor', async () => {
    await guardarConRechazo({ code: 'INVALID_CATEGORY', message: 'invalid merchant category' });

    expect(await screen.findByText('Elige una de las categorías de la lista.')).toBeInTheDocument();
    expect(screen.queryByText('invalid merchant category')).toBeNull();
  });

  it.each([
    ['MERCHANT_CEDULA_TYPE_INVALID', 'invalid cedula type', 'Elige si la cédula es física o jurídica.'],
    ['MERCHANT_FIELD_TOO_LONG', 'a merchant field is too long', 'Alguno de los datos es demasiado largo. Acórtalo e inténtalo de nuevo.'],
    ['MERCHANT_CLOSED', 'merchant is closed', 'Este comercio está cerrado y ya no se puede modificar.'],
  ])('%s se dice con su texto', async (code, message, esperado) => {
    await guardarConRechazo({ code, message });

    expect(await screen.findByText(esperado)).toBeInTheDocument();
    expect(screen.queryByText(message)).toBeNull();
  });

  it('un fallo inesperado cae al texto de la pantalla y no al del servidor', async () => {
    await guardarConRechazo({ code: 'UPDATE_FAILED', message: 'ERROR: value too long for type character varying(200)' });

    expect(await screen.findByText('No se pudo completar la acción')).toBeInTheDocument();
    expect(screen.queryByText(/character varying/)).toBeNull();
  });
});
