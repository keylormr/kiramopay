import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SolicitudesDeEliminacion } from '../SolicitudesDeEliminacion';

// La cola de eliminaciones pedidas desde la web. La persona de operaciones ve la
// cuenta ENMASCARADA, confirma antes de eliminar, y un bloqueo (saldo, dinero en
// transito) se explica por codigo en vez de mostrarse como un fallo.

const api = vi.hoisted(() => ({
  admin: {
    listDeletionRequests: vi.fn(),
    processDeletionRequest: vi.fn(),
    rejectDeletionRequest: vi.fn(),
  },
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => api,
}));

const solicitud = {
  id: 'r1',
  contactKind: 'email' as const,
  createdAt: '2026-10-14T15:00:00Z',
  verifiedAt: '2026-10-14T15:05:00Z',
  account: {
    id: 'u1', firstName: 'Maria', lastName: 'Rojas', username: '', cedulaMasked: '••••••930',
    phoneMasked: '••••••1234', emailMasked: 'm•••@ejemplo.test', status: 'active' as const, role: 'user',
    kycLevel: 1, createdAt: '', lastLoginAt: null, blockedAt: null, blockedReason: '', blockedByName: '',
    expiresAt: null, plan: 'free' as const,
  },
};

const pintar = () => render(<LanguageProvider><SolicitudesDeEliminacion /></LanguageProvider>);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  for (const fn of Object.values(api.admin)) fn.mockReset();
});
afterEach(cleanup);

describe('SolicitudesDeEliminacion', () => {
  it('lista la cuenta enmascarada, sin datos completos', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [solicitud] });
    pintar();
    expect(await screen.findByText('Maria Rojas')).toBeInTheDocument();
    expect(screen.getByText(/••••••930/)).toBeInTheDocument();
    expect(screen.getByText(/Pidió con su correo/)).toBeInTheDocument();
  });

  it('una cola vacia lo dice', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    pintar();
    expect(await screen.findByText('No hay solicitudes por atender.')).toBeInTheDocument();
  });

  it('si la cola no carga lo dice, sin afirmar que esta vacia', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: false, error: { code: 'LIST_FAILED', message: 'x' } });
    pintar();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la cola.');
    expect(screen.queryByText('No hay solicitudes por atender.')).toBeNull();
  });

  it('eliminar pide confirmacion, corre y relee la cola', async () => {
    api.admin.listDeletionRequests
      .mockResolvedValueOnce({ success: true, data: [solicitud] })
      .mockResolvedValueOnce({ success: true, data: [] });
    api.admin.processDeletionRequest.mockResolvedValue({ success: true, data: { status: 'completed', resultCode: 'COMPLETED', blockers: [] } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Eliminar cuenta' }));
    expect(api.admin.processDeletionRequest).not.toHaveBeenCalled(); // primero confirma
    await user.click(await screen.findByRole('button', { name: 'Eliminar la cuenta' }));

    await waitFor(() => expect(api.admin.processDeletionRequest).toHaveBeenCalledWith('r1'));
    expect(await screen.findByText('Cuenta eliminada.')).toBeInTheDocument();
    expect(await screen.findByText('No hay solicitudes por atender.')).toBeInTheDocument();
  });

  it('un bloqueo se explica por codigo y no se presenta como exito', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [solicitud] });
    api.admin.processDeletionRequest.mockResolvedValue({
      success: true,
      data: { status: 'blocked', resultCode: 'BALANCE_POSITIVE', blockers: ['BALANCE_POSITIVE'] },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Eliminar cuenta' }));
    await user.click(await screen.findByRole('button', { name: 'Eliminar la cuenta' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No se pudo eliminar todavía');
    expect(alerta).toHaveTextContent('Tienes saldo en tu billetera');
    expect(screen.queryByText('Cuenta eliminada.')).toBeNull();
  });

  it('una solicitud ya atendida por otra persona se avisa', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [solicitud] });
    api.admin.rejectDeletionRequest.mockResolvedValue({ success: false, error: { code: 'NOT_PENDING', message: 'x' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Rechazar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta solicitud ya fue atendida.');
  });
});
