import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';
import { BusinessSettingsView } from '../BusinessSettingsView';

// Cerrar el comercio desde sus ajustes. Es una baja logica: el servidor marca
// la fila y conserva todo. La pantalla pide la contrasena (y el codigo del
// autenticador si la persona lo tiene), explica por que no se pudo cuando el
// servidor lo rechaza, y al cerrar vuelve a la cuenta personal.

const mockApi = vi.hoisted(() => ({ qrPayments: { updateMerchant: vi.fn(), closeMerchant: vi.fn() } }));
vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

vi.mock('../BusinessTeamSheet', () => ({ BusinessTeamSheet: () => null }));
vi.mock('../BusinessLocationsSheet', () => ({ BusinessLocationsSheet: () => null }));
vi.mock('../BusinessCatalogSheet', () => ({ BusinessCatalogSheet: () => null }));

const ID = '5b0e7c1e-2a3f-4d5b-9c8e-1f2a3b4c5d6e';

const comercio = (extra: Partial<QRMerchant> = {}): QRMerchant => ({
  id: ID, name: 'Cafeteria Central', description: '', category: 'restaurant', qrCode: 'MRC-1', active: true,
  cedula: '3101', cedulaType: 'juridica', legalName: 'Cafeteria Central SA', verificationStatus: 'verified',
  commissionBps: 50, comisionEfectivaBps: 50, promoHasta: null, plan: 'base', role: 'owner',
  ...extra,
});

function pintar(m: QRMerchant = comercio()) {
  const onBackToPersonal = vi.fn();
  const onUpdated = vi.fn();
  render(
    <LanguageProvider>
      <BusinessSettingsView merchant={m} onSwitchProfile={vi.fn()} onBackToPersonal={onBackToPersonal} onUpdated={onUpdated} />
    </LanguageProvider>,
  );
  return { onBackToPersonal, onUpdated };
}

async function abrirYConfirmar(user: ReturnType<typeof userEvent.setup>, clave = 'secreta') {
  await user.click(screen.getByRole('button', { name: 'Cerrar comercio' }));
  await user.type(await screen.findByLabelText('Tu contraseña'), clave);
  await user.click(screen.getByRole('button', { name: 'Cerrar definitivamente' }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mockApi.qrPayments.closeMerchant.mockReset();
});

describe('BusinessSettingsView: cerrar el comercio', () => {
  it('solo el dueno ve la accion', () => {
    pintar(comercio({ role: 'manager' }));
    expect(screen.queryByRole('button', { name: 'Cerrar comercio' })).toBeNull();
  });

  it('explica que pasa antes de pedir la contrasena, y sin ella no deja confirmar', async () => {
    const user = userEvent.setup();
    pintar();
    await user.click(screen.getByRole('button', { name: 'Cerrar comercio' }));

    expect(await screen.findByText(/Cafeteria Central dejará de cobrar/)).toBeInTheDocument();
    expect(screen.getByText(/el saldo del negocio tiene que estar en cero/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar definitivamente' })).toBeDisabled();
    expect(mockApi.qrPayments.closeMerchant).not.toHaveBeenCalled();
  });

  it('con la contrasena cierra y vuelve a la cuenta personal', async () => {
    mockApi.qrPayments.closeMerchant.mockResolvedValue({ success: true, data: comercio({ active: false, closedAt: '2026-10-18T20:00:00Z' }) });
    const user = userEvent.setup();
    const { onBackToPersonal, onUpdated } = pintar();

    await abrirYConfirmar(user);

    await waitFor(() => expect(mockApi.qrPayments.closeMerchant).toHaveBeenCalledWith(ID, { password: 'secreta' }));
    await waitFor(() => expect(onBackToPersonal).toHaveBeenCalled());
    expect(onUpdated).toHaveBeenCalled();
  });

  it('con saldo dice cuanto queda y no sale del comercio', async () => {
    mockApi.qrPayments.closeMerchant.mockResolvedValue({
      success: false,
      error: { code: 'MERCHANT_HAS_BALANCE', message: 'x', details: { balances: [{ currency: 'CRC', amount: 99500 }] } },
    });
    const user = userEvent.setup();
    const { onBackToPersonal } = pintar();

    await abrirYConfirmar(user);

    expect(await screen.findByText(/El negocio todavía tiene saldo/)).toBeInTheDocument();
    expect(screen.getByText('₡995.00')).toBeInTheDocument();
    expect(onBackToPersonal).not.toHaveBeenCalled();
  });

  it.each([
    ['MERCHANT_HAS_PENDING_CHARGES', /Hay cobros pendientes/],
    ['CURRENT_PASSWORD_INVALID', /Contraseña incorrecta/],
    ['MERCHANT_CLOSE_LOCKED', /Demasiados intentos/],
    ['DEMO_ACCOUNT', /Una cuenta de demostración no puede cerrar comercios/],
    ['MERCHANT_CLOSED', /Este comercio ya estaba cerrado/],
    ['CLOSE_FAILED', /No se pudo cerrar el comercio/],
  ])('%s se explica con su texto, no con el del servidor', async (codigo, texto) => {
    mockApi.qrPayments.closeMerchant.mockResolvedValue({ success: false, error: { code: codigo, message: 'server text' } });
    const user = userEvent.setup();
    pintar();

    await abrirYConfirmar(user);

    expect(await screen.findByText(texto)).toBeInTheDocument();
    expect(screen.queryByText('server text')).toBeNull();
  });

  it('si el servidor pide el segundo factor, muestra el campo y reintenta con el codigo', async () => {
    mockApi.qrPayments.closeMerchant
      .mockResolvedValueOnce({ success: false, error: { code: 'TOTP_REQUIRED', message: 'x' } })
      .mockResolvedValueOnce({ success: true, data: comercio({ active: false, closedAt: '2026-10-18T20:00:00Z' }) });
    const user = userEvent.setup();
    const { onBackToPersonal } = pintar();

    await abrirYConfirmar(user);
    await user.type(await screen.findByLabelText('Código de tu app de autenticación'), '123456');
    await user.click(screen.getByRole('button', { name: 'Cerrar definitivamente' }));

    await waitFor(() =>
      expect(mockApi.qrPayments.closeMerchant).toHaveBeenLastCalledWith(ID, { password: 'secreta', totpCode: '123456' }),
    );
    await waitFor(() => expect(onBackToPersonal).toHaveBeenCalled());
  });
});
