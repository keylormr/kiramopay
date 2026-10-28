import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminMerchantsView } from '../AdminMerchantsView';

const mockApi = vi.hoisted(() => ({
  qrPayments: {
    listPendingMerchants: vi.fn(),
    approveMerchant: vi.fn(),
    rejectMerchant: vi.fn(),
    setMerchantCommission: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const pending = {
  id: 'm1', name: 'Soda Tica', description: 'Comidas', category: 'restaurant',
  qrCode: 'MRC-ABC', active: true, cedula: '3-101', cedulaType: 'juridica',
  legalName: 'Soda Tica SA', verificationStatus: 'pending', commissionBps: 50,
};

// commissionBps no multiplo de 10: al pasarlo a porcentaje trae 2 decimales
// (573 -> "5.73"), como puede ocurrir con cualquier comercio real.
const pendingConDosDecimales = {
  ...pending, id: 'm2', name: 'Cafe Central', commissionBps: 573,
};

function setup() {
  return render(
    <LanguageProvider>
      <AdminMerchantsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mockApi.qrPayments.listPendingMerchants.mockReset();
  mockApi.qrPayments.approveMerchant.mockReset();
  mockApi.qrPayments.rejectMerchant.mockReset();
  mockApi.qrPayments.setMerchantCommission.mockReset();
});

describe('AdminMerchantsView', () => {
  it('shows the empty state when there are no pending merchants', async () => {
    mockApi.qrPayments.listPendingMerchants.mockResolvedValue({ success: true, data: [] });
    setup();
    expect(await screen.findByText('No hay comercios pendientes')).toBeInTheDocument();
  });

  it('approves a pending merchant', async () => {
    mockApi.qrPayments.listPendingMerchants
      .mockResolvedValueOnce({ success: true, data: [pending] })
      .mockResolvedValueOnce({ success: true, data: [] });
    mockApi.qrPayments.approveMerchant.mockResolvedValue({ success: true, data: { ...pending, verificationStatus: 'verified' } });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Aprobar' }));
    await waitFor(() => expect(mockApi.qrPayments.approveMerchant).toHaveBeenCalledWith('m1'));
  });

  it('no trunca el segundo decimal de una comision existente al editar el campo', async () => {
    mockApi.qrPayments.listPendingMerchants.mockResolvedValue({ success: true, data: [pendingConDosDecimales] });
    const user = userEvent.setup();
    setup();

    const input = await screen.findByLabelText<HTMLInputElement>('Comisión');
    expect(input.value).toBe('5.73');

    // Cualquier edicion del campo (aca, insertar un digito al inicio) no debe
    // descartar el segundo decimal ya cargado.
    await user.click(input);
    input.setSelectionRange(0, 0);
    await user.keyboard('1');

    expect(input.value).toBe('15.73');
  });
});

// El servidor guardaba cualquier categoria y la pantalla armaba la clave de
// traduccion con ella: un comercio con "other" mostraba `merchant_cat_other`
// tal cual al administrador que lo verifica.
describe('AdminMerchantsView - categoria sin traduccion', () => {
  it('un comercio con una categoria desconocida muestra Otro y no la clave cruda', async () => {
    mockApi.qrPayments.listPendingMerchants.mockResolvedValue({
      success: true,
      data: [{ ...pending, category: 'other' }],
    });
    setup();

    expect(await screen.findByText(/Otro · Soda Tica SA/)).toBeInTheDocument();
    expect(screen.queryByText(/merchant_cat_/)).toBeNull();
  });

  it('una categoria conocida sigue mostrando su traduccion', async () => {
    mockApi.qrPayments.listPendingMerchants.mockResolvedValue({ success: true, data: [pending] });
    setup();

    expect(await screen.findByText(/Restaurante · Soda Tica SA/)).toBeInTheDocument();
  });
});

// El servidor responde COMMISSION_OUT_OF_RANGE cuando la comision cae fuera de
// 0..100 %. Antes salia como SET_COMMISSION_FAILED y la pantalla pintaba el
// texto del servidor, en ingles.
describe('AdminMerchantsView - comision fuera de rango', () => {
  it('lo dice en el idioma de la app y no aprueba el comercio', async () => {
    mockApi.qrPayments.listPendingMerchants.mockResolvedValue({ success: true, data: [pending] });
    mockApi.qrPayments.setMerchantCommission.mockResolvedValue({
      success: false,
      error: { code: 'COMMISSION_OUT_OF_RANGE', message: 'commission must be between 0 and 10000 bps' },
    });
    const user = userEvent.setup();
    setup();

    const campo = await screen.findByLabelText('Comisión');
    await user.clear(campo);
    await user.type(campo, '150');
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));

    expect(await screen.findByText('La comisión debe estar entre 0 % y 100 %.')).toBeInTheDocument();
    expect(screen.queryByText('commission must be between 0 and 10000 bps')).toBeNull();
    expect(mockApi.qrPayments.approveMerchant).not.toHaveBeenCalled();
  });
});
