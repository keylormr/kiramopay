import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
    viewDeletionResponseContact: vi.fn(),
    listSentUnconfirmedDeletionResponses: vi.fn(),
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
  responderAntesDe: '2026-10-21T18:05:00Z',
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
  api.admin.listSentUnconfirmedDeletionResponses.mockResolvedValue({ success: true, data: [] });
});
afterEach(cleanup);

describe('SolicitudesDeEliminacion', () => {
  it('lista la cuenta enmascarada, sin datos completos', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [solicitud] });
    pintar();
    expect(await screen.findByText('Maria Rojas')).toBeInTheDocument();
    expect(screen.getByText(/••••••930/)).toBeInTheDocument();
    expect(screen.getByText(/Pidió con su correo/)).toBeInTheDocument();
    // El plazo legal de la respuesta corre desde la verificacion.
    expect(screen.getByText(/Responder antes del 21 de octubre de 2026/)).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Sí, rechazar y responder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta solicitud ya fue atendida.');
  });

  it('rechazar pide confirmacion: no se puede retirar el correo que sale', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [solicitud] });
    api.admin.rejectDeletionRequest.mockResolvedValue({ success: true, data: { rejected: true } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Rechazar' }));
    expect(api.admin.rejectDeletionRequest).not.toHaveBeenCalled();
    expect(screen.getByText(/se le escribe que no se puede atender por esta vía/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sí, rechazar y responder' }));
    await waitFor(() => expect(api.admin.rejectDeletionRequest).toHaveBeenCalledWith('r1'));
    expect(await screen.findByText('La solicitud se cerró sin iniciar el plazo.')).toBeInTheDocument();
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

  it('ver el contacto lo pide al servidor y lo muestra completo, avisando que queda registrado', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listDeletionResponses.mockResolvedValue({ success: true, data: [respuesta] });
    api.admin.viewDeletionResponseContact.mockResolvedValue({
      success: true,
      data: { telefono: '+50688881234', correo: 'maria@ejemplo.test', correoParaRespuesta: 'dado@ejemplo.test' },
    });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByText('Queda registrado quién lo ve y cuándo.')).toBeInTheDocument();
    expect(screen.queryByText(/\+50688881234/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Ver contacto' }));
    await waitFor(() => expect(api.admin.viewDeletionResponseContact).toHaveBeenCalledWith('d1'));
    expect(await screen.findByText(/\+50688881234/)).toBeInTheDocument();
    expect(screen.getByText(/maria@ejemplo\.test/)).toBeInTheDocument();
    expect(screen.getByText(/Correo que dio para la respuesta: dado@ejemplo\.test/)).toBeInTheDocument();
  });

  it('si el contacto no se puede leer lo dice', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listDeletionResponses.mockResolvedValue({ success: true, data: [respuesta] });
    api.admin.viewDeletionResponseContact.mockResolvedValue({ success: false, error: { code: 'NOT_PENDING', message: 'x' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Ver contacto' }));
    expect(await screen.findByText('No se pudo leer el contacto.')).toBeInTheDocument();
  });

  it('sin contacto guardado lo dice en vez de mostrar campos vacios', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listDeletionResponses.mockResolvedValue({ success: true, data: [respuesta] });
    api.admin.viewDeletionResponseContact.mockResolvedValue({ success: true, data: { telefono: '', correo: '', correoParaRespuesta: '' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Ver contacto' }));
    expect(await screen.findByText('No hay contacto guardado.')).toBeInTheDocument();
  });

  it('la que va a un correo que nadie confirmo lleva la marca', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listDeletionResponses.mockResolvedValue({
      success: true,
      data: [{ ...respuesta, correoSinConfirmar: true }, { ...respuesta, id: 'd2', correoSinConfirmar: false }],
    });
    pintar();

    expect(await screen.findAllByText('Correo sin confirmar')).toHaveLength(1);
  });

  it('la de una solicitud rechazada dice que decirle, sin el motivo', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listDeletionResponses.mockResolvedValue({
      success: true,
      data: [{ ...respuesta, tipo: 'rejected', seEliminaEl: null, conservaHasta: null }],
    });
    pintar();

    expect(await screen.findByText(/no se puede atender por esta vía/)).toBeInTheDocument();
    expect(screen.getByText(/PRODHAB/)).toBeInTheDocument();
    expect(screen.queryByText(/se suprimen sus datos/)).toBeNull();
  });

  it('una nota de mas de 500 caracteres lo dice y no cierra la hoja', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listDeletionResponses.mockResolvedValue({ success: true, data: [respuesta] });
    api.admin.markDeletionResponseDelivered.mockResolvedValue({ success: false, error: { code: 'NOTE_TOO_LONG', message: 'x' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Marcar entregada' }));
    await user.type(screen.getByLabelText('Cómo la entregaste'), 'Se la leímos por teléfono');
    await user.click(screen.getByRole('button', { name: 'Confirmar la entrega' }));
    expect(await screen.findByText('La nota pasa de 500 caracteres.')).toBeInTheDocument();
    expect(screen.getByLabelText('Cómo la entregaste')).toHaveValue('Se la leímos por teléfono');
  });

  it('de una cuenta cerrada no ofrece ver el contacto: ya no hay', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listDeletionResponses.mockResolvedValue({
      success: true,
      data: [{ ...respuesta, id: 'd3', account: null, userId: 'u-cerrada-9', cuentaCerrada: true }],
    });
    pintar();

    expect(await screen.findByText('No hay contacto guardado.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver contacto' })).toBeNull();
  });

  it('un contacto que llega despues de releer no se pinta', async () => {
    let entregar: (v: unknown) => void = () => {};
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listDeletionResponses.mockResolvedValue({ success: true, data: [respuesta, { ...respuesta, id: 'd2' }] });
    api.admin.viewDeletionResponseContact.mockReturnValue(new Promise((r) => { entregar = r; }));
    api.admin.markDeletionResponseDelivered.mockResolvedValue({ success: true, data: { delivered: true } });
    const user = userEvent.setup();
    pintar();

    const [verPrimera] = await screen.findAllByRole('button', { name: 'Ver contacto' });
    await user.click(verPrimera);
    // Mientras espera, otra persona del equipo cierra otra y la lista se relee.
    await user.click(screen.getAllByRole('button', { name: 'Marcar entregada' })[1]);
    await user.type(screen.getByLabelText('Cómo la entregaste'), 'por telefono');
    await user.click(screen.getByRole('button', { name: 'Confirmar la entrega' }));
    await waitFor(() => expect(api.admin.listDeletionResponses).toHaveBeenCalledTimes(2));
    entregar({ success: true, data: { telefono: '+50688881234', correo: '', correoParaRespuesta: '' } });
    await screen.findByText('Quedó la constancia de la entrega.');
    expect(screen.queryByText(/\+50688881234/)).toBeNull();
  });

  it('la cola lleva su propio titulo, aparte de las respuestas por entregar', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [solicitud] });
    api.admin.listDeletionResponses.mockResolvedValue({ success: true, data: [respuesta] });
    pintar();

    const cola = await screen.findByRole('region', { name: 'Solicitudes por atender' });
    expect(within(cola).getByRole('button', { name: 'Iniciar el plazo' })).toBeInTheDocument();
    const respuestas = screen.getByRole('region', { name: 'Respuestas por entregar' });
    expect(within(respuestas).queryByRole('button', { name: 'Iniciar el plazo' })).toBeNull();
  });

  it('sin respuestas pendientes la seccion no aparece', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    pintar();
    expect(await screen.findByText('No hay solicitudes por atender.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Respuestas por entregar' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Enviadas a un correo sin confirmar' })).toBeNull();
  });

  const enviada = {
    id: 'e1',
    tipo: 'rejected' as const,
    entregadaEn: '2026-10-19T15:00:00Z',
    userId: 'u1',
    cuentaCerrada: false,
    account: solicitud.account,
  };

  it('las que ya salieron a un correo sin confirmar se listan aparte, solo para leer', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listSentUnconfirmedDeletionResponses.mockResolvedValue({ success: true, data: [enviada] });
    pintar();

    const seccion = await screen.findByRole('region', { name: 'Enviadas a un correo sin confirmar' });
    expect(within(seccion).getByText('Maria Rojas')).toBeInTheDocument();
    expect(within(seccion).getByText('Correo sin confirmar')).toBeInTheDocument();
    expect(within(seccion).getByText(/Enviada el 19 de octubre de 2026/)).toBeInTheDocument();
    expect(within(seccion).getByText('Decía que no se puede atender por esta vía.')).toBeInTheDocument();
    expect(within(seccion).queryAllByRole('button')).toHaveLength(0);
    // Sin pendientes, la de las por entregar no aparece.
    expect(screen.queryByRole('heading', { name: 'Respuestas por entregar' })).toBeNull();
  });

  it('la enviada de una cuenta ya cerrada da el id de la cuenta', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listSentUnconfirmedDeletionResponses.mockResolvedValue({
      success: true,
      data: [{ ...enviada, tipo: 'scheduled' as const, account: null, userId: 'u-cerrada-9', cuentaCerrada: true }],
    });
    pintar();

    const seccion = await screen.findByRole('region', { name: 'Enviadas a un correo sin confirmar' });
    expect(within(seccion).getByText(/u-cerrada-9/)).toBeInTheDocument();
    expect(within(seccion).getByText('Decía que empezó el plazo de 30 días.')).toBeInTheDocument();
  });

  it('si la lista de las enviadas no carga lo dice', async () => {
    api.admin.listDeletionRequests.mockResolvedValue({ success: true, data: [] });
    api.admin.listSentUnconfirmedDeletionResponses.mockResolvedValue({ success: false, error: { code: 'LIST_FAILED', message: 'x' } });
    pintar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar la lista de las enviadas a un correo sin confirmar.');
  });
});
