import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import type { QRMerchant, QRPayment } from '@/api/repositories/qrpayment.repository';
import { ClosedMerchantsView } from '../ClosedMerchantsView';

// Un comercio cerrado ya no vuelve al selector de negocios, pero lo que vendio
// sigue siendo de su dueno. Desde el Perfil, "Comercios cerrados" lo deja
// consultar: las ventas y el reporte (con su CSV), sin cobrar ni editar nada.

const mockApi = vi.hoisted(() => ({
  qrPayments: { listClosedMerchants: vi.fn(), getMerchantPayments: vi.fn() },
}));
vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

// El reporte tiene sus propias pruebas (BusinessReportsView.cerrado): aqui solo
// importa que se abra con el comercio elegido.
vi.mock('../BusinessReportsView', () => ({
  BusinessReportsView: ({ merchant }: { merchant: QRMerchant }) => <p>Reporte de {merchant.name}</p>,
}));

const cerrado = (extra: Partial<QRMerchant> = {}): QRMerchant => ({
  id: 'm1', name: 'Cafeteria Central', description: '', category: 'restaurant', qrCode: 'MRC-1', active: false,
  cedula: '3101', cedulaType: 'juridica', legalName: 'Cafeteria Central SA', verificationStatus: 'verified',
  commissionBps: 50, comisionEfectivaBps: 50, promoHasta: null, plan: 'base', role: 'owner',
  closedAt: '2026-10-18T20:00:00Z', closureReason: 'owner_request',
  ...extra,
});

const venta: QRPayment = {
  id: 'p1', qrCodeId: 'c1', payerId: 'u2', receiverId: 'u1', merchantId: 'm1',
  amount: 1000, fee: 5, currency: 'CRC', status: 'completed', createdAt: '2026-10-17T15:30:00Z',
};

function pintar() {
  const onClose = vi.fn();
  render(
    <LanguageProvider>
      <ClosedMerchantsView onClose={onClose} />
    </LanguageProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mockApi.qrPayments.listClosedMerchants.mockReset();
  mockApi.qrPayments.getMerchantPayments.mockReset();
});

describe('ClosedMerchantsView', () => {
  it('lista los comercios cerrados con la fecha del cierre', async () => {
    mockApi.qrPayments.listClosedMerchants.mockResolvedValue({ success: true, data: [cerrado()] });
    pintar();

    expect(await screen.findByRole('button', { name: /Cafeteria Central/ })).toBeInTheDocument();
    expect(screen.getByText(/Cerrado el 18/)).toBeInTheDocument();
    expect(screen.getByText(/Lo que vendieron sigue siendo tuyo/)).toBeInTheDocument();
  });

  it('sin comercios cerrados lo dice', async () => {
    mockApi.qrPayments.listClosedMerchants.mockResolvedValue({ success: true, data: [] });
    pintar();

    expect(await screen.findByText('No tienes comercios cerrados.')).toBeInTheDocument();
  });

  it('si la lista falla lo dice, no la pinta vacia, y deja reintentar', async () => {
    mockApi.qrPayments.listClosedMerchants
      .mockResolvedValueOnce({ success: false, error: { code: 'FETCH_FAILED', message: 'server text' } })
      .mockResolvedValueOnce({ success: true, data: [cerrado()] });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByText('No se pudieron cargar tus comercios cerrados.')).toBeInTheDocument();
    expect(screen.queryByText('No tienes comercios cerrados.')).toBeNull();
    expect(screen.queryByText('server text')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('button', { name: /Cafeteria Central/ })).toBeInTheDocument();
    expect(mockApi.qrPayments.listClosedMerchants).toHaveBeenCalledTimes(2);
  });

  it('al abrir uno muestra sus ventas y que ya no cobra, sin acciones de cobro ni de edicion', async () => {
    mockApi.qrPayments.listClosedMerchants.mockResolvedValue({ success: true, data: [cerrado()] });
    mockApi.qrPayments.getMerchantPayments.mockResolvedValue({ success: true, data: [venta] });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /Cafeteria Central/ }));

    await waitFor(() => expect(mockApi.qrPayments.getMerchantPayments).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText('₡995.00')).toBeInTheDocument();
    expect(screen.getByText(/Ya no cobra ni se puede editar/)).toBeInTheDocument();
    for (const accion of [/Cobrar/, /Editar/, /Retirar/, /Cerrar comercio/]) {
      expect(screen.queryByRole('button', { name: accion })).toBeNull();
    }
  });

  it('si las ventas no se pudieron leer, no pinta "sin ventas"', async () => {
    mockApi.qrPayments.listClosedMerchants.mockResolvedValue({ success: true, data: [cerrado()] });
    mockApi.qrPayments.getMerchantPayments.mockResolvedValue({ success: false, error: { code: 'NOT_FOUND', message: 'x' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /Cafeteria Central/ }));

    expect(await screen.findByText('No se pudieron cargar los cobros.')).toBeInTheDocument();
  });

  it('la pestana de reportes abre el reporte de ese comercio', async () => {
    mockApi.qrPayments.listClosedMerchants.mockResolvedValue({ success: true, data: [cerrado()] });
    mockApi.qrPayments.getMerchantPayments.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: /Cafeteria Central/ }));
    await user.click(await screen.findByRole('tab', { name: 'Reportes' }));

    expect(await screen.findByText('Reporte de Cafeteria Central')).toBeInTheDocument();
  });

  it('volver desde un comercio regresa a la lista; desde la lista, cierra', async () => {
    mockApi.qrPayments.listClosedMerchants.mockResolvedValue({ success: true, data: [cerrado()] });
    mockApi.qrPayments.getMerchantPayments.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    const { onClose } = pintar();

    await user.click(await screen.findByRole('button', { name: /Cafeteria Central/ }));
    await screen.findByRole('tab', { name: 'Reportes' });
    await user.click(screen.getByRole('button', { name: 'Volver' }));

    expect(await screen.findByRole('button', { name: /Cafeteria Central/ })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Volver' }));
    expect(onClose).toHaveBeenCalled();
  });
});
