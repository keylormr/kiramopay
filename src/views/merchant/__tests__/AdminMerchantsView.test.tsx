import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminMerchantsView } from '../AdminMerchantsView';

const mockApi = vi.hoisted(() => ({
  qrPayments: {
    listPendingMerchants: vi.fn(),
    approveMerchant: vi.fn(),
    rejectMerchant: vi.fn(),
    setMerchantPlan: vi.fn(),
  },
}));

const UUID = '5b0e7c1e-2a3f-4d5b-9c8e-1f2a3b4c5d6e';

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
  mockApi.qrPayments.setMerchantPlan.mockReset();
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

describe('AdminMerchantsView - plan de un comercio', () => {
  beforeEach(() => {
    mockApi.qrPayments.listPendingMerchants.mockResolvedValue({ success: true, data: [] });
  });

  it('asigna el plan por identificador solo despues de confirmar', async () => {
    mockApi.qrPayments.setMerchantPlan.mockResolvedValue({
      success: true,
      data: { ...pending, id: UUID, plan: 'analitica', comisionEfectivaBps: 25 },
    });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('tab', { name: 'Plan de un comercio' }));
    await user.type(screen.getByLabelText('Identificador del comercio'), UUID);
    await user.click(screen.getByRole('radio', { name: /Analítica/ }));
    await user.click(screen.getByRole('button', { name: 'Revisar y asignar' }));

    expect(mockApi.qrPayments.setMerchantPlan).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Sí, asignar Analítica' }));

    await waitFor(() => expect(mockApi.qrPayments.setMerchantPlan).toHaveBeenCalledWith(UUID, 'analitica'));
    expect(mockApi.qrPayments.setMerchantPlan).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('status')).toHaveTextContent('Soda Tica quedó con el plan Analítica.');
    expect(screen.getByRole('status')).toHaveTextContent('0.25%');
  });

  it('un identificador mal escrito no llega al servidor', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('tab', { name: 'Plan de un comercio' }));
    await user.type(screen.getByLabelText('Identificador del comercio'), 'soda-tica');
    await user.click(screen.getByRole('button', { name: 'Revisar y asignar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Ese identificador no tiene el formato correcto.');
    expect(mockApi.qrPayments.setMerchantPlan).not.toHaveBeenCalled();
  });

  it('dice cuando el comercio no existe', async () => {
    mockApi.qrPayments.setMerchantPlan.mockResolvedValue({ success: false, error: { code: 'MERCHANT_NOT_FOUND', message: 'no' } });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('tab', { name: 'Plan de un comercio' }));
    await user.type(screen.getByLabelText('Identificador del comercio'), UUID);
    await user.click(screen.getByRole('button', { name: 'Revisar y asignar' }));
    await user.click(await screen.findByRole('button', { name: 'Sí, asignar Analítica' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No existe un comercio con ese identificador.');
  });
});
