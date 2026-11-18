import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SeccionMediosDeCobro } from '../MediosDeCobro';

// Ajustes > Cobrar fuera de KiramoPay: el dueno conecta la direccion de su
// billetera propia y su SINPE Movil; el resto del equipo los ve. Solo viaja lo
// que cambio, lo que de seguro se rechaza no viaja, y cada rechazo del
// servidor se dice en el idioma de la app.
const mocks = vi.hoisted(() => ({ getPaymentMethods: vi.fn(), updatePaymentMethods: vi.fn() }));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    qrPayments: { getPaymentMethods: mocks.getPaymentMethods, updatePaymentMethods: mocks.updatePaymentMethods },
  }),
}));

const MEDIOS = { lightningHabilitado: true, lightningAddress: undefined, sinpeMovil: undefined, puedeEditar: true };

const pintar = () =>
  render(
    <LanguageProvider>
      <SeccionMediosDeCobro merchantId="m1" />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.getPaymentMethods.mockReset();
  mocks.updatePaymentMethods.mockReset();
});

describe('Ajustes: cobrar fuera de KiramoPay', () => {
  it('el dueno ve que falta conectar la billetera y el numero', async () => {
    mocks.getPaymentMethods.mockResolvedValue({ success: true, data: MEDIOS });
    pintar();
    const seccion = await screen.findByRole('region', { name: 'Cobrar fuera de KiramoPay' });
    expect(within(seccion).getByText('Billetera Lightning')).toBeInTheDocument();
    expect(within(seccion).getByText('Sin conectar')).toBeInTheDocument();
    expect(within(seccion).getByText('Sin número')).toBeInTheDocument();
    expect(within(seccion).getByText(/KiramoPay no lo recibe ni lo mueve/)).toBeInTheDocument();
    expect(within(seccion).getByRole('button', { name: 'Editar medios de cobro' })).toBeInTheDocument();
  });

  it('el dueno guarda la direccion y el numero, y la seccion muestra lo que devolvio el servidor', async () => {
    mocks.getPaymentMethods.mockResolvedValue({ success: true, data: MEDIOS });
    mocks.updatePaymentMethods.mockResolvedValue({
      success: true,
      data: { ...MEDIOS, lightningAddress: 'soda@breez.tips', sinpeMovil: '88887777' },
    });
    const user = userEvent.setup();
    pintar();
    await user.click(await screen.findByRole('button', { name: 'Editar medios de cobro' }));
    await user.type(screen.getByPlaceholderText('nombre@breez.tips'), 'Soda@breez.tips');
    await user.type(screen.getByPlaceholderText('8888-7777'), '8888 7777');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(mocks.updatePaymentMethods).toHaveBeenCalledWith('m1', { lightningAddress: 'Soda@breez.tips', sinpeMovil: '8888 7777' });
    const seccion = screen.getByRole('region', { name: 'Cobrar fuera de KiramoPay' });
    expect(await within(seccion).findByText('soda@breez.tips')).toBeInTheDocument();
    expect(within(seccion).getByText('8888-7777')).toBeInTheDocument();
  });

  it('solo viaja lo que cambio; sin cambios no viaja nada', async () => {
    mocks.getPaymentMethods.mockResolvedValue({
      success: true,
      data: { ...MEDIOS, lightningAddress: 'soda@breez.tips', sinpeMovil: '88887777' },
    });
    mocks.updatePaymentMethods.mockResolvedValue({ success: true, data: { ...MEDIOS, lightningAddress: 'soda@breez.tips' } });
    const user = userEvent.setup();
    pintar();
    await user.click(await screen.findByRole('button', { name: 'Editar medios de cobro' }));
    // El numero se muestra con guion y guardarlo igual no es un cambio.
    expect(screen.getByPlaceholderText('8888-7777')).toHaveValue('8888-7777');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(mocks.updatePaymentMethods).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Editar medios de cobro' }));
    await user.clear(screen.getByPlaceholderText('8888-7777'));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    // Vaciar el campo lo quita; la direccion no viaja.
    expect(mocks.updatePaymentMethods).toHaveBeenCalledWith('m1', { sinpeMovil: '' });
  });

  it('lo que de seguro se rechaza no viaja', async () => {
    mocks.getPaymentMethods.mockResolvedValue({ success: true, data: MEDIOS });
    const user = userEvent.setup();
    pintar();
    await user.click(await screen.findByRole('button', { name: 'Editar medios de cobro' }));
    await user.type(screen.getByPlaceholderText('nombre@breez.tips'), 'soda');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Esa dirección no respondió como billetera Lightning');

    await user.clear(screen.getByPlaceholderText('nombre@breez.tips'));
    await user.type(screen.getByPlaceholderText('8888-7777'), '2222-2222');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe un celular de Costa Rica de 8 dígitos.');
    expect(mocks.updatePaymentMethods).not.toHaveBeenCalled();
  });

  it.each([
    ['LIGHTNING_ADDRESS_INVALID', 'Esa dirección no respondió como billetera Lightning. Cópiala de Mi billetera y vuelve a intentarlo.'],
    ['SINPE_MOVIL_INVALID', 'Escribe un celular de Costa Rica de 8 dígitos.'],
    ['PAYMENT_METHODS_FAILED', 'No se pudieron guardar los medios de cobro.'],
  ])('el rechazo %s se dice en el idioma de la app', async (code, texto) => {
    mocks.getPaymentMethods.mockResolvedValue({ success: true, data: MEDIOS });
    mocks.updatePaymentMethods.mockResolvedValue({ success: false, error: { code, message: 'server text' } });
    const user = userEvent.setup();
    pintar();
    await user.click(await screen.findByRole('button', { name: 'Editar medios de cobro' }));
    await user.type(screen.getByPlaceholderText('nombre@breez.tips'), 'soda@breez.tips');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(texto);
    expect(screen.queryByText('server text')).not.toBeInTheDocument();
  });

  it('un cajero los ve pero no los edita', async () => {
    mocks.getPaymentMethods.mockResolvedValue({
      success: true,
      data: { ...MEDIOS, puedeEditar: false, lightningAddress: 'soda@breez.tips', sinpeMovil: '88887777' },
    });
    pintar();
    const seccion = await screen.findByRole('region', { name: 'Cobrar fuera de KiramoPay' });
    expect(within(seccion).getByText('soda@breez.tips')).toBeInTheDocument();
    expect(within(seccion).getByText('Solo el dueño del comercio los cambia.')).toBeInTheDocument();
    expect(within(seccion).queryByRole('button', { name: 'Editar medios de cobro' })).not.toBeInTheDocument();
  });

  it('con la bandera cerrada no se ofrece Lightning; un cajero sin numero no ve la seccion', async () => {
    mocks.getPaymentMethods.mockResolvedValue({ success: true, data: { ...MEDIOS, lightningHabilitado: false } });
    const { unmount } = pintar();
    const seccion = await screen.findByRole('region', { name: 'Cobrar fuera de KiramoPay' });
    expect(within(seccion).queryByText('Billetera Lightning')).not.toBeInTheDocument();
    expect(within(seccion).getByText(/El número de SINPE Móvil se muestra al cobrar/)).toBeInTheDocument();
    unmount();

    mocks.getPaymentMethods.mockResolvedValue({ success: true, data: { ...MEDIOS, lightningHabilitado: false, puedeEditar: false } });
    pintar();
    await vi.waitFor(() => expect(mocks.getPaymentMethods).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole('region', { name: 'Cobrar fuera de KiramoPay' })).not.toBeInTheDocument();
  });

  it('si no se pudieron leer lo dice y deja reintentar, sin pintar "sin conectar"', async () => {
    mocks.getPaymentMethods
      .mockResolvedValueOnce({ success: false, error: { code: 'PAYMENT_METHODS_FAILED', message: '' } })
      .mockResolvedValueOnce({ success: true, data: MEDIOS });
    const user = userEvent.setup();
    pintar();
    expect(await screen.findByText('No se pudieron cargar los medios de cobro.')).toBeInTheDocument();
    expect(screen.queryByText('Sin conectar')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Sin conectar')).toBeInTheDocument();
  });
});
