import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminMerchantsView } from '../AdminMerchantsView';

// La vista de administracion lista a todos los comercios, cerrados incluidos y
// con su estado, y un administrador cierra uno con un motivo.

const mockApi = vi.hoisted(() => ({
  qrPayments: {
    listPendingMerchants: vi.fn(),
    listAllMerchants: vi.fn(),
    closeMerchantAsAdmin: vi.fn(),
    approveMerchant: vi.fn(),
    rejectMerchant: vi.fn(),
    setMerchantPlan: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const abierto = {
  id: 'm1', name: 'Cafeteria Central', description: '', category: 'restaurant',
  qrCode: 'MRC-ABC', active: true, cedula: '3-101', cedulaType: 'juridica',
  legalName: 'Cafeteria Central SA', verificationStatus: 'verified', commissionBps: 50,
  closedAt: null, ownerName: 'Victor Prueba',
};

const cerrado = {
  ...abierto, id: 'm2', name: 'Soda Vieja', legalName: 'Soda Vieja SA', active: false,
  closedAt: '2026-10-18T20:00:00Z', closedBy: 'admin-1', closureReason: 'Datos de prueba',
};

const cerradoPorSuDueno = {
  ...abierto, id: 'm3', name: 'Panaderia', legalName: 'Panaderia SA', active: false,
  closedAt: '2026-10-17T15:00:00Z', closedBy: 'u1', closureReason: 'owner_request',
};

function setup() {
  return render(
    <LanguageProvider>
      <AdminMerchantsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

const tarjeta = (nombre: string) => screen.getByText(nombre).closest('[data-comercio]') as HTMLElement;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mockApi.qrPayments).forEach((f) => f.mockReset());
  mockApi.qrPayments.listPendingMerchants.mockResolvedValue({ success: true, data: [] });
  mockApi.qrPayments.listAllMerchants.mockResolvedValue({ success: true, data: [abierto, cerrado, cerradoPorSuDueno] });
});

describe('AdminMerchantsView: todos los comercios', () => {
  it('muestra a los cerrados con su estado, su motivo y sin la accion de cerrar', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: 'Todos' }));

    await screen.findByText('Soda Vieja');
    expect(mockApi.qrPayments.listAllMerchants).toHaveBeenCalledWith('');

    const delCerrado = tarjeta('Soda Vieja');
    expect(within(delCerrado).getByText('Cerrado')).toBeInTheDocument();
    expect(within(delCerrado).getByText(/Motivo: Datos de prueba/)).toBeInTheDocument();
    expect(within(delCerrado).queryByRole('button', { name: 'Cerrar' })).toBeNull();

    expect(within(tarjeta('Panaderia')).getByText(/Lo cerró su dueño/)).toBeInTheDocument();

    const delAbierto = tarjeta('Cafeteria Central');
    expect(within(delAbierto).getByText('Verificado')).toBeInTheDocument();
    expect(within(delAbierto).getByText(/Victor Prueba/)).toBeInTheDocument();
    expect(within(delAbierto).getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
  });

  it('busca por lo que escribe el administrador', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: 'Todos' }));
    await screen.findByText('Soda Vieja');

    await user.type(screen.getByLabelText('Buscar un comercio'), 'cafeteria');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    await waitFor(() => expect(mockApi.qrPayments.listAllMerchants).toHaveBeenLastCalledWith('cafeteria'));
  });

  it('cierra con motivo, solo despues de escribirlo, y vuelve a cargar la lista', async () => {
    mockApi.qrPayments.closeMerchantAsAdmin.mockResolvedValue({ success: true, data: { ...abierto, active: false, closedAt: '2026-10-18T21:00:00Z' } });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: 'Todos' }));
    await screen.findByText('Cafeteria Central');

    await user.click(within(tarjeta('Cafeteria Central')).getByRole('button', { name: 'Cerrar' }));
    expect(await screen.findByText(/Cafeteria Central dejará de cobrar/)).toBeInTheDocument();
    const confirmar = screen.getByRole('button', { name: 'Cerrar Cafeteria Central' });
    expect(confirmar).toBeDisabled();

    await user.type(screen.getByLabelText('Motivo del cierre'), '  Datos de prueba  ');
    await user.click(confirmar);

    await waitFor(() => expect(mockApi.qrPayments.closeMerchantAsAdmin).toHaveBeenCalledWith('m1', 'Datos de prueba'));
    await waitFor(() => expect(mockApi.qrPayments.listAllMerchants).toHaveBeenCalledTimes(2));
    // Un pendiente que se cierra sale tambien de la pestana de pendientes.
    await waitFor(() => expect(mockApi.qrPayments.listPendingMerchants).toHaveBeenCalledTimes(2));
  });

  it('si la lista no carga lo dice con el texto de la app, no con el del servidor', async () => {
    mockApi.qrPayments.listAllMerchants.mockResolvedValue({ success: false, error: { code: 'FETCH_FAILED', message: 'server text' } });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: 'Todos' }));

    expect(await screen.findByText('No se pudo completar la acción')).toBeInTheDocument();
    expect(screen.queryByText('server text')).toBeNull();
  });

  it('aprobar un pendiente que ya cerro lo dice con el texto de la app', async () => {
    mockApi.qrPayments.listPendingMerchants.mockResolvedValue({ success: true, data: [{ ...abierto, verificationStatus: 'pending' }] });
    mockApi.qrPayments.approveMerchant.mockResolvedValue({ success: false, error: { code: 'MERCHANT_CLOSED', message: 'merchant is closed' } });
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Aprobar' }));

    expect(await screen.findByText('Este comercio ya estaba cerrado.')).toBeInTheDocument();
    expect(screen.queryByText('merchant is closed')).toBeNull();
  });

  it('si el comercio tiene saldo lo dice, con el texto de la app', async () => {
    mockApi.qrPayments.closeMerchantAsAdmin.mockResolvedValue({
      success: false,
      error: { code: 'MERCHANT_HAS_BALANCE', message: 'server text', details: { balances: [{ currency: 'USD', amount: 1250 }] } },
    });
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('tab', { name: 'Todos' }));
    await screen.findByText('Cafeteria Central');

    await user.click(within(tarjeta('Cafeteria Central')).getByRole('button', { name: 'Cerrar' }));
    await user.type(await screen.findByLabelText('Motivo del cierre'), 'Datos de prueba');
    await user.click(screen.getByRole('button', { name: 'Cerrar Cafeteria Central' }));

    expect(await screen.findByText(/El negocio todavía tiene saldo/)).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    expect(screen.queryByText('server text')).toBeNull();
  });
});
