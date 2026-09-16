import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SplitPayView } from '../SplitPayView';

// Antes de este cambio, una division creada desde la app no era pagable por
// nadie: la pantalla solo mandaba nombre y telefono, la cuota se guardaba sin
// cuenta asociada y no existia boton de pagar. Estas pruebas cubren las dos
// mitades: que el telefono sea obligatorio, y que quien tiene una cuota
// pendiente pueda pagarla.
const mocks = vi.hoisted(() => ({
  listSplits: vi.fn(),
  createSplit: vi.fn(),
  getSplit: vi.fn(),
  payShare: vi.fn(),
  declineShare: vi.fn(),
  cancelSplit: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    splitPay: {
      listSplits: mocks.listSplits,
      createSplit: mocks.createSplit,
      getSplit: mocks.getSplit,
      payShare: mocks.payShare,
      declineShare: mocks.declineShare,
      cancelSplit: mocks.cancelSplit,
    },
  }),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'yo' } }),
}));

const grupo = {
  id: 'g1', creatorId: 'otro', title: 'Cena', totalAmount: 3000,
  currency: 'CRC', splitType: 'equal' as const, status: 'active' as const,
  createdAt: '2026-09-07T00:00:00Z',
};

const grupoPropio = { ...grupo, creatorId: 'yo' };

const pintar = () =>
  render(
    <LanguageProvider>
      <SplitPayView onClose={() => {}} />
    </LanguageProvider>,
  );

describe('SplitPayView', () => {
  beforeEach(() => {
    localStorage.setItem('kiramopay_language', 'es');
    vi.clearAllMocks();
    mocks.listSplits.mockResolvedValue({ success: true, data: [grupo] });
  });

  // Mismo defecto que en ahorros: `if (res.success && res.data)` sin rama de
  // fallo. La consulta se caia y la pantalla mostraba el estado vacio con su
  // invitacion a crear una, como si el servidor hubiera contestado que no hay
  // ninguna.
  it('cuando la consulta falla lo dice, en vez de mostrar el estado vacio', async () => {
    mocks.listSplits.mockResolvedValue({ success: false, error: { code: 'FETCH_FAILED' } });

    pintar();

    expect(await screen.findByText('No pudimos cargar tus cuentas divididas.')).toBeInTheDocument();
    expect(screen.queryByText('Sin cuentas divididas')).not.toBeInTheDocument();
  });

  // Hallazgo QA n=6 / n=73: el backend responde 200 {success:true, data:null}
  // cuando el usuario no tiene divisiones (0 filas); antes eso se pintaba como
  // "no pudimos cargar", con un boton "Reintentar" que nunca resolvia nada. El
  // arreglo vive en el adaptador HTTP (ver
  // src/api/adapters/http/__tests__/splitpay.http.test.ts), que normaliza
  // data:null a [] ANTES de que la vista lo vea: por eso aca alcanza con
  // probar que una lista vacia real (que es lo unico que esta vista recibe
  // ahora en ese caso) cae en el estado vacio, no en el de error.
  it('una lista vacia real cae en el estado vacio, no en el de error', async () => {
    mocks.listSplits.mockResolvedValue({ success: true, data: [] });

    pintar();

    expect(await screen.findByText('Sin cuentas divididas')).toBeInTheDocument();
    expect(screen.queryByText('No pudimos cargar tus cuentas divididas.')).not.toBeInTheDocument();
  });

  // Hallazgo QA n=52: los rechazos de "Crear division" llegaban en ingles y en
  // centimos ('"Ana" (+50688880001) does not have a KiramoPay account'). Ahora
  // el backend manda un codigo estable y la pantalla elige su propio texto.
  it('traduce el error del servidor por codigo, en vez de mostrar el ingles crudo', async () => {
    mocks.createSplit.mockResolvedValue({
      success: false,
      error: { code: 'SPLIT_ACCOUNT_NOT_FOUND', message: '"Ana" (+50688880001) does not have a KiramoPay account' },
    });
    pintar();

    await screen.findByText('Cena');
    // La division se crea desde el boton de mas de la cabecera, no desde la
    // tarjeta: tocar la tarjeta abre el detalle.
    fireEvent.click(screen.getAllByRole('button', { name: /crear divisi/i })[0]);

    fireEvent.change(screen.getByPlaceholderText(/Ej: Cena/i), { target: { value: 'Cena' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '3000' } });
    const nombres = screen.getAllByPlaceholderText(/nombre/i);
    fireEvent.change(nombres[0], { target: { value: 'Ana' } });
    const telefonos = screen.getAllByPlaceholderText(/tel/i);
    fireEvent.change(telefonos[0], { target: { value: '88880001' } });

    fireEvent.click(screen.getAllByRole('button', { name: /crear divisi/i }).slice(-1)[0]);

    expect(await screen.findByText('Ese número no tiene una cuenta de KiramoPay.')).toBeInTheDocument();
    expect(screen.queryByText(/does not have a KiramoPay account/i)).not.toBeInTheDocument();
  });

  // El caso puntual que reprodujo el QA: montos personalizados que exceden el
  // total. El backend los manda en centimos ('the shares (40000) add up to
  // more than the total (30000)'); la pantalla arma el mensaje con los montos
  // en colones que YA tiene en el formulario, sin parsear nada del servidor.
  it('el exceso del total se muestra en colones, con los montos del propio formulario', async () => {
    mocks.createSplit.mockResolvedValue({
      success: false,
      error: { code: 'SPLIT_EXCEEDS_TOTAL', message: 'the shares (40000) add up to more than the total (30000)' },
    });
    pintar();

    await screen.findByText('Cena');
    fireEvent.click(screen.getAllByRole('button', { name: /crear divisi/i })[0]);

    fireEvent.change(screen.getByPlaceholderText(/Ej: Cena/i), { target: { value: 'Cena' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Personalizado' }));

    const nombres = screen.getAllByPlaceholderText(/nombre/i);
    fireEvent.change(nombres[0], { target: { value: 'Ana' } });
    const telefonos = screen.getAllByPlaceholderText(/tel/i);
    fireEvent.change(telefonos[0], { target: { value: '88880001' } });
    const montos = screen.getAllByPlaceholderText('Monto');
    fireEvent.change(montos[0], { target: { value: '400' } });

    fireEvent.click(screen.getAllByRole('button', { name: /crear divisi/i }).slice(-1)[0]);

    const mensaje = await screen.findByText(/suman más que el total/);
    expect(mensaje.textContent).toContain('₡400');
    expect(mensaje.textContent).toContain('₡300');
  });

  it('deja pagar la propia cuota pendiente', async () => {
    mocks.getSplit.mockResolvedValue({
      success: true,
      data: {
        group: grupo,
        shares: [
          { id: 's1', groupId: 'g1', userId: 'otro', userName: 'Quien pago', amount: 1500, status: 'paid' },
          { id: 's2', groupId: 'g1', userId: 'yo', userName: 'Yo', amount: 1500, status: 'pending' },
        ],
      },
    });
    mocks.payShare.mockResolvedValue({ success: true });
    pintar();

    fireEvent.click(await screen.findByText('Cena'));

    const pagar = await screen.findByRole('button', { name: /pagar mi parte/i });
    fireEvent.click(pagar);

    await waitFor(() => expect(mocks.payShare).toHaveBeenCalledWith('g1'));
  });

  it('no ofrece pagar una cuota que ya esta pagada', async () => {
    mocks.getSplit.mockResolvedValue({
      success: true,
      data: {
        group: grupo,
        shares: [
          { id: 's1', groupId: 'g1', userId: 'otro', userName: 'Quien pago', amount: 1500, status: 'paid' },
          { id: 's2', groupId: 'g1', userId: 'yo', userName: 'Yo', amount: 1500, status: 'paid' },
        ],
      },
    });
    pintar();

    fireEvent.click(await screen.findByText('Cena'));
    // Que las dos cuotas aparezcan prueba que el detalle ya se pinto: sin esa
    // espera, la ausencia del boton no significaria nada.
    await screen.findByText(/Tu parte/i);
    expect(screen.queryByRole('button', { name: /pagar mi parte/i })).toBeNull();
  });

  // Hallazgo QA n=53: el texto de ayuda de la pantalla promete "Quien no
  // quiera pagar puede rechazar la suya, y quien creo el grupo puede
  // cancelarlo", pero no existia ningun boton para hacerlo.
  it('deja rechazar la propia cuota pendiente, con confirmacion', async () => {
    mocks.getSplit.mockResolvedValue({
      success: true,
      data: {
        group: grupo,
        shares: [
          { id: 's1', groupId: 'g1', userId: 'otro', userName: 'Quien pago', amount: 1500, status: 'paid' },
          { id: 's2', groupId: 'g1', userId: 'yo', userName: 'Yo', amount: 1500, status: 'pending' },
        ],
      },
    });
    mocks.declineShare.mockResolvedValue({ success: true });
    pintar();

    fireEvent.click(await screen.findByText('Cena'));

    fireEvent.click(await screen.findByRole('button', { name: /rechazar mi parte/i }));
    // La confirmacion todavia no llamo al servidor.
    expect(mocks.declineShare).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: /^rechazar mi parte$/i }));

    await waitFor(() => expect(mocks.declineShare).toHaveBeenCalledWith('g1'));
  });

  it('deja cancelar la division a quien la creo, con confirmacion', async () => {
    mocks.getSplit.mockResolvedValue({
      success: true,
      data: {
        group: grupoPropio,
        shares: [
          { id: 's1', groupId: 'g1', userId: 'yo', userName: 'Yo', amount: 1500, status: 'paid' },
          { id: 's2', groupId: 'g1', userId: 'otro', userName: 'Otro', amount: 1500, status: 'pending' },
        ],
      },
    });
    mocks.cancelSplit.mockResolvedValue({ success: true });
    pintar();

    fireEvent.click(await screen.findByText('Cena'));

    fireEvent.click(await screen.findByRole('button', { name: /cancelar división/i }));
    expect(mocks.cancelSplit).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: /^cancelar división$/i }));

    await waitFor(() => expect(mocks.cancelSplit).toHaveBeenCalledWith('g1'));
  });

  it('no ofrece cancelar la division a quien no la creo', async () => {
    mocks.getSplit.mockResolvedValue({
      success: true,
      data: {
        group: grupo, // creatorId: 'otro'
        shares: [
          { id: 's1', groupId: 'g1', userId: 'otro', userName: 'Quien pago', amount: 1500, status: 'paid' },
          { id: 's2', groupId: 'g1', userId: 'yo', userName: 'Yo', amount: 1500, status: 'pending' },
        ],
      },
    });
    pintar();

    fireEvent.click(await screen.findByText('Cena'));
    await screen.findByRole('button', { name: /rechazar mi parte/i });
    expect(screen.queryByRole('button', { name: /cancelar división/i })).toBeNull();
  });
});
