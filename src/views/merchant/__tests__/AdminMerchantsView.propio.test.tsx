import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminMerchantsView } from '../AdminMerchantsView';

// Un administrador no revisa ni gestiona un comercio suyo: el servidor responde
// 403 ADMIN_IS_AFFECTED_PARTY y la pantalla lo explica en el idioma de la app,
// nunca con el texto del servidor.

const mockApi = vi.hoisted(() => ({
  qrPayments: {
    listPendingMerchants: vi.fn(),
    listAllMerchants: vi.fn(),
    approveMerchant: vi.fn(),
    rejectMerchant: vi.fn(),
    setMerchantCommission: vi.fn(),
    setMerchantPlan: vi.fn(),
    closeMerchantAsAdmin: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const UUID = '5b0e7c1e-2a3f-4d5b-9c8e-1f2a3b4c5d6e';
const TEXTO_DEL_SERVIDOR = 'an administrator cannot act on a merchant they own';
const rechazo = { success: false, error: { code: 'ADMIN_IS_AFFECTED_PARTY', message: TEXTO_DEL_SERVIDOR } };

const ES_TUYO = 'Este comercio es tuyo: de eso se encarga otro administrador.';
const CIERRALO_COMO_DUENO = 'Este comercio es tuyo. Ciérralo desde sus ajustes, en Cerrar comercio, que te pide tu contraseña.';

const pendiente = {
  id: 'm1', name: 'Soda Propia', description: '', category: 'restaurant',
  qrCode: 'MRC-ABC', active: true, cedula: '3-101', cedulaType: 'juridica',
  legalName: 'Soda Propia SA', verificationStatus: 'pending', commissionBps: 50,
};
const abierto = { ...pendiente, verificationStatus: 'verified', closedAt: null, ownerName: 'Keilor' };

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
  Object.values(mockApi.qrPayments).forEach((f) => f.mockReset());
  mockApi.qrPayments.listPendingMerchants.mockResolvedValue({ success: true, data: [pendiente] });
  mockApi.qrPayments.listAllMerchants.mockResolvedValue({ success: true, data: [abierto] });
});

describe('AdminMerchantsView: el comercio del propio administrador', () => {
  it('aprobar el suyo dice que se encarga otro administrador', async () => {
    mockApi.qrPayments.approveMerchant.mockResolvedValue(rechazo);
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Aprobar' }));
    expect(await screen.findByText(ES_TUYO)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_DEL_SERVIDOR)).toBeNull();
  });

  it('cambiarle la comision al suyo lo dice igual, y no lo aprueba', async () => {
    mockApi.qrPayments.setMerchantCommission.mockResolvedValue(rechazo);
    const user = userEvent.setup();
    setup();

    const campo = await screen.findByLabelText('Comisión');
    await user.clear(campo);
    await user.type(campo, '0');
    await user.click(screen.getByRole('button', { name: 'Aprobar' }));

    expect(await screen.findByText(ES_TUYO)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_DEL_SERVIDOR)).toBeNull();
    expect(mockApi.qrPayments.approveMerchant).not.toHaveBeenCalled();
  });

  // La hoja de rechazo sigue abierta tras el 403 (el motivo escrito no se
  // pierde), asi que el aviso tiene que estar dentro de ella: detras del fondo
  // de la hoja no lo ve nadie.
  it('rechazar el suyo lo dice dentro de la hoja, que es lo que se ve', async () => {
    mockApi.qrPayments.rejectMerchant.mockResolvedValue(rechazo);
    const user = userEvent.setup();
    setup();

    await user.click(await screen.findByRole('button', { name: 'Rechazar' }));
    const hoja = await screen.findByRole('dialog');
    await user.type(within(hoja).getByRole('textbox'), 'pruebo');
    await user.click(within(hoja).getByRole('button', { name: /Rechazar/ }));

    expect(await within(hoja).findByText(ES_TUYO)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_DEL_SERVIDOR)).toBeNull();
  });

  it('asignarle el plan al suyo dice que se encarga otro administrador', async () => {
    mockApi.qrPayments.setMerchantPlan.mockResolvedValue(rechazo);
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('tab', { name: 'Plan de un comercio' }));
    await user.type(screen.getByLabelText('Identificador del comercio'), UUID);
    await user.click(screen.getByRole('button', { name: 'Revisar y asignar' }));
    await user.click(await screen.findByRole('button', { name: 'Sí, asignar Analítica' }));

    expect(await screen.findByText(ES_TUYO)).toBeInTheDocument();
  });

  it('cerrar el suyo como administrador le dice que lo cierre como dueno', async () => {
    mockApi.qrPayments.closeMerchantAsAdmin.mockResolvedValue(rechazo);
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('tab', { name: 'Todos' }));
    const tarjeta = (await screen.findByText('Soda Propia')).closest('[data-comercio]') as HTMLElement;
    await user.click(within(tarjeta).getByRole('button', { name: 'Cerrar' }));
    const hoja = await screen.findByRole('dialog');
    await user.type(within(hoja).getByLabelText('Motivo del cierre'), 'Lo cierro yo');
    await user.click(within(hoja).getByRole('button', { name: 'Cerrar Soda Propia' }));

    await waitFor(() => expect(mockApi.qrPayments.closeMerchantAsAdmin).toHaveBeenCalledWith('m1', 'Lo cierro yo'));
    expect(await screen.findByText(CIERRALO_COMO_DUENO)).toBeInTheDocument();
    expect(screen.queryByText(TEXTO_DEL_SERVIDOR)).toBeNull();
  });
});
