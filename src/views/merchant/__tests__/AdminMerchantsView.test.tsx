import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminMerchantsView } from '../AdminMerchantsView';

const mockApi = vi.hoisted(() => ({
  qrPayments: {
    listPendingMerchants: vi.fn(),
    approveMerchant: vi.fn(),
    rejectMerchant: vi.fn(),
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
