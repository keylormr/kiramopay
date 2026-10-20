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
    listDeletionResponses: vi.fn(),
    markDeletionResponseDelivered: vi.fn(),
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
  // Sin respuestas pendientes la seccion no aparece.
  api.admin.listDeletionResponses.mockResolvedValue({ success: true, data: [] });
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

  it('iniciar el plazo pide confirmacion, corre y relee la cola', async () => {
    api.admin.listDeletionRequests
      .mockResolvedValueOnce({ success: true, data: [solicitud] })
      .mockResolvedValueOnce({ success: true, data: [] });
    api.admin.processDeletionRequest.mockResolvedValue({ success: true, data: { status: 'scheduled', resultCode: 'SCHEDULED', blockers: [] } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Iniciar el plazo' }));
    expect(api.admin.processDeletionRequest).not.toHaveBeenCalled(); // primero confirma
    await user.click(await screen.findByRole('button', { name: 'Sí, iniciar el plazo' }));

    await waitFor(() => expect(api.admin.processDeletionRequest).toHaveBeenCalledWith('r1'));
    expect(await screen.findByText('Plazo iniciado. La cuenta se elimina en 30 días.')).toBeInTheDocument();
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

    await user.click(await screen.findByRole('button', { name: 'Iniciar el plazo' }));
    await user.click(await screen.findByRole('button', { name: 'Sí, iniciar el plazo' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No se pudo iniciar todavía');
    expect(alerta).toHaveTextContent('Tienes saldo en tu billetera');
    expect(screen.queryByText('Plazo iniciado. La cuenta se elimina en 30 días.')).toBeNull();
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

// La respuesta escrita que no pudo salir por correo pasa a operaciones: la
// persona del equipo la entrega por otro medio antes del plazo legal y deja
// constancia de como.
describe('SolicitudesDeEliminacion — respuestas por entregar', () => {
  const respuesta = {
    id: 'd1',
    tipo: 'scheduled' as const,
    motivo: 'no_channel' as const,
    intentos: 1,
    creadaEn: '2026-10-19T15:00:00Z',
    responderAntesDe: '2026-10-26T18:00:00Z',
    seEliminaEl: '2026-11-18T18:00:00Z',
    conservaHasta: '2031-11-18T18:00:00Z',
    bloqueos: [] as string[],
    account: solicitud.account,
  };

  it('lista lo que hay que decirle a la persona y el plazo, con la cuenta enmascarada', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listDeletionResponses.mockResolvedValue({
      success: true,
      data: [respuesta, { ...respuesta, id: 'd2', tipo: 'blocked', motivo: 'send_failed', intentos: 7, seEliminaEl: null, conservaHasta: null, bloqueos: ['BALANCE_POSITIVE'] }],
    });
    pintar();

    expect(await screen.findByRole('heading', { name: 'Respuestas por entregar' })).toBeInTheDocument();
    expect(screen.getAllByText('Maria Rojas')).toHaveLength(2);
    expect(screen.getAllByText(/••••••930/).length).toBeGreaterThan(0);
    expect(screen.getByText(/No tiene correo/)).toBeInTheDocument();
    expect(screen.getByText(/El correo falló 7 veces/)).toBeInTheDocument();
    expect(screen.getAllByText(/Responder antes del 26 de octubre de 2026/)).toHaveLength(2);
    // Lo que hay que decirle: las fechas, o que resolver.
    expect(screen.getByText(/18 de noviembre de 2026/)).toBeInTheDocument();
    expect(screen.getByText(/18 de noviembre de 2031/)).toBeInTheDocument();
    expect(screen.getByText(/saldo en tu billetera/)).toBeInTheDocument();
  });

  it('marcarla entregada exige decir como, la manda y relee', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listDeletionResponses.mockResolvedValue({ success: true, data: [respuesta] });
    api.admin.markDeletionResponseDelivered.mockResolvedValue({ success: true, data: { delivered: true } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Marcar entregada' }));
    const confirmar = screen.getByRole('button', { name: 'Confirmar la entrega' });
    expect(confirmar).toBeDisabled();
    await user.type(screen.getByLabelText('Cómo la entregaste'), 'Se la leímos por teléfono');
    await user.click(confirmar);

    await waitFor(() => expect(api.admin.markDeletionResponseDelivered).toHaveBeenCalledWith('d1', 'Se la leímos por teléfono'));
    await waitFor(() => expect(api.admin.listDeletionResponses).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Quedó la constancia de la entrega.')).toBeInTheDocument();
  });

  it('la de una cuenta ya cerrada dice que se cerro y da el id de la cuenta', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listDeletionResponses.mockResolvedValue({
      success: true,
      data: [{ ...respuesta, id: 'd3', account: null, userId: 'u-cerrada-9', cuentaCerrada: true }],
    });
    pintar();

    expect(await screen.findByText(/Cuenta cerrada/)).toBeInTheDocument();
    expect(screen.getByText(/u-cerrada-9/)).toBeInTheDocument();
    expect(screen.queryByText('No se pudo leer la cuenta.')).toBeNull();
  });

  it('sin respuestas pendientes la seccion no aparece', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    pintar();
    expect(await screen.findByText('No hay solicitudes por atender.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Respuestas por entregar' })).toBeNull();
  });
});
