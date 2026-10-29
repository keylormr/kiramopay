import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { SplitPayView } from '../SplitPayView';

// El detalle de una division CANCELADA no decia que estaba cancelada y mostraba
// "Tu parte: Pendiente", como si todavia se debiera. Ahora muestra el estado del
// grupo y que las cuotas pendientes ya no se cobran. Y una division donde
// alguien ya pago NO se puede cancelar (decision del dueno: "No se puede
// cancelar"): el dinero de las cuotas pagadas ya esta en la cuenta de quien creo
// la division y cancelar no lo devuelve. En vez del boton, la pantalla dice por
// que; y si el servidor lo rechaza con SPLIT_HAS_PAYMENTS (alguien pago despues
// de abrir el detalle), se muestra el mismo motivo.

const mocks = vi.hoisted(() => ({
  listSplits: vi.fn(),
  getSplit: vi.fn(),
  cancelSplit: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    splitPay: {
      listSplits: mocks.listSplits,
      getSplit: mocks.getSplit,
      createSplit: vi.fn(),
      payShare: vi.fn(),
      declineShare: vi.fn(),
      cancelSplit: mocks.cancelSplit,
    },
  }),
}));

vi.mock('@/stores/auth.store', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { id: 'yo' } }),
}));

const grupo = (status: 'active' | 'settled' | 'cancelled', creatorId = 'otro') => ({
  id: 'g1', creatorId, title: 'Cena', totalAmount: 3000,
  currency: 'CRC', splitType: 'equal' as const, status,
  createdAt: '2026-09-07T00:00:00Z',
});

const cuota = (id: string, userId: string, userName: string, status: 'pending' | 'paid' | 'declined') => ({
  id, groupId: 'g1', userId, userName, amount: 1500, status,
});

async function abrirElDetalle(g: ReturnType<typeof grupo>, shares: ReturnType<typeof cuota>[]) {
  mocks.listSplits.mockResolvedValue({ success: true, data: [g] });
  mocks.getSplit.mockResolvedValue({ success: true, data: { group: g, shares } });
  render(
    <LanguageProvider>
      <SplitPayView onClose={() => {}} />
    </LanguageProvider>,
  );
  fireEvent.click(await screen.findByText('Cena'));
  const detalle = await screen.findByRole('dialog', { name: 'Detalle de la división' });
  // Que la cuota propia aparezca prueba que el detalle ya se pinto.
  await within(detalle).findByText('Tu parte');
  return detalle;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  vi.clearAllMocks();
});

describe('SplitPayView: detalle de una division cancelada', () => {
  it('dice que esta cancelada y que las cuotas pendientes ya no se cobran', async () => {
    const detalle = await abrirElDetalle(grupo('cancelled'), [
      cuota('s1', 'otro', 'Quien pago', 'paid'),
      cuota('s2', 'yo', 'Yo', 'pending'),
    ]);

    expect(within(detalle).getByText('Cancelada')).toBeInTheDocument();
    expect(
      within(detalle).getByText('Esta división fue cancelada: las cuotas pendientes ya no se cobran.'),
    ).toBeInTheDocument();
  });

  it('"Tu parte" no queda como pendiente', async () => {
    const detalle = await abrirElDetalle(grupo('cancelled'), [
      cuota('s1', 'otro', 'Quien pago', 'paid'),
      cuota('s2', 'yo', 'Yo', 'pending'),
    ]);

    expect(within(detalle).getByText('Ya no se cobra')).toBeInTheDocument();
    expect(within(detalle).queryByText('Pendiente')).toBeNull();
    // La cuota que si se pago sigue diciendolo.
    expect(within(detalle).getByText('Pagada')).toBeInTheDocument();
  });

  it('no ofrece pagar, rechazar ni cancelar otra vez', async () => {
    const detalle = await abrirElDetalle(grupo('cancelled', 'yo'), [
      cuota('s1', 'yo', 'Yo', 'paid'),
      cuota('s2', 'otro', 'Otro', 'pending'),
    ]);

    expect(within(detalle).queryByRole('button', { name: /pagar mi parte|rechazar mi parte|cancelar división/i })).toBeNull();
  });
});

describe('SplitPayView: el detalle dice el estado del grupo', () => {
  it('activa: la cuota pendiente sigue diciendo Pendiente', async () => {
    const detalle = await abrirElDetalle(grupo('active'), [
      cuota('s1', 'otro', 'Quien pago', 'paid'),
      cuota('s2', 'yo', 'Yo', 'pending'),
    ]);

    expect(within(detalle).getByText('Activa')).toBeInTheDocument();
    expect(within(detalle).getByText('Pendiente')).toBeInTheDocument();
    expect(within(detalle).queryByText(/fue cancelada/)).toBeNull();
  });

  it('liquidada', async () => {
    const detalle = await abrirElDetalle(grupo('settled'), [
      cuota('s1', 'otro', 'Quien pago', 'paid'),
      cuota('s2', 'yo', 'Yo', 'paid'),
    ]);

    expect(within(detalle).getByText('Liquidada')).toBeInTheDocument();
  });
});

describe('SplitPayView: una division donde alguien ya pago no se cancela', () => {
  const MOTIVO = 'No se puede cancelar esta división porque alguien ya pagó su parte.';
  const BOTON_CANCELAR = { name: /cancelar división/i };

  it('en vez del boton Cancelar explica por que no se puede', async () => {
    const detalle = await abrirElDetalle(grupo('active', 'yo'), [
      cuota('s1', 'yo', 'Yo', 'paid'),
      cuota('s2', 'otro', 'Otro', 'paid'),
      cuota('s3', 'tercero', 'Tercero', 'pending'),
    ]);

    expect(within(detalle).queryByRole('button', BOTON_CANCELAR)).toBeNull();
    expect(within(detalle).getByText(MOTIVO)).toBeInTheDocument();
    expect(mocks.cancelSplit).not.toHaveBeenCalled();
  });

  it('ya no existe el aviso viejo de que lo pagado queda con quien creo la division', async () => {
    const detalle = await abrirElDetalle(grupo('active', 'yo'), [
      cuota('s1', 'yo', 'Yo', 'paid'),
      cuota('s2', 'otro', 'Otro', 'paid'),
    ]);

    expect(within(detalle).queryByText(/no recibe su dinero de vuelta/)).toBeNull();
  });

  it('la cuota del propio creador no cuenta como "alguien ya pago"', async () => {
    // El creador puso la cuenta: su cuota nace pagada y no mueve dinero.
    const detalle = await abrirElDetalle(grupo('active', 'yo'), [
      cuota('s1', 'yo', 'Yo', 'paid'),
      cuota('s2', 'otro', 'Otro', 'pending'),
    ]);

    expect(within(detalle).getByRole('button', BOTON_CANCELAR)).toBeInTheDocument();
    expect(within(detalle).queryByText(MOTIVO)).toBeNull();

    fireEvent.click(within(detalle).getByRole('button', BOTON_CANCELAR));
    expect(await within(detalle).findByText(/Se cancela para todos los participantes/)).toBeInTheDocument();
  });

  it('una cuota rechazada no impide cancelar', async () => {
    const detalle = await abrirElDetalle(grupo('active', 'yo'), [
      cuota('s1', 'yo', 'Yo', 'paid'),
      cuota('s2', 'otro', 'Otro', 'declined'),
    ]);

    expect(within(detalle).getByRole('button', BOTON_CANCELAR)).toBeInTheDocument();
    expect(within(detalle).queryByText(MOTIVO)).toBeNull();
  });

  it('a quien no creo la division no le explica nada de cancelar', async () => {
    const detalle = await abrirElDetalle(grupo('active', 'otro'), [
      cuota('s1', 'otro', 'Otro', 'paid'),
      cuota('s2', 'tercero', 'Tercero', 'paid'),
      cuota('s3', 'yo', 'Yo', 'pending'),
    ]);

    expect(within(detalle).queryByRole('button', BOTON_CANCELAR)).toBeNull();
    expect(within(detalle).queryByText(MOTIVO)).toBeNull();
  });

  it('si el servidor lo rechaza con SPLIT_HAS_PAYMENTS, muestra el motivo y quita el boton', async () => {
    // Al abrir el detalle nadie habia pagado; antes de confirmar, alguien pago.
    const detalle = await abrirElDetalle(grupo('active', 'yo'), [
      cuota('s1', 'yo', 'Yo', 'paid'),
      cuota('s2', 'otro', 'Otro', 'pending'),
    ]);
    mocks.cancelSplit.mockResolvedValue({
      success: false,
      error: { code: 'SPLIT_HAS_PAYMENTS', message: 'the split already has payments' },
    });
    mocks.getSplit.mockResolvedValue({
      success: true,
      data: {
        group: grupo('active', 'yo'),
        shares: [cuota('s1', 'yo', 'Yo', 'paid'), cuota('s2', 'otro', 'Otro', 'paid')],
      },
    });

    fireEvent.click(within(detalle).getByRole('button', BOTON_CANCELAR));
    fireEvent.click(await within(detalle).findByRole('button', { name: /^cancelar división$/i }));

    await waitFor(() => expect(mocks.cancelSplit).toHaveBeenCalledWith('g1'));
    const actual = await screen.findByRole('dialog', { name: 'Detalle de la división' });
    expect(await within(actual).findByText(MOTIVO)).toBeInTheDocument();
    expect(within(actual).queryByRole('button', BOTON_CANCELAR)).toBeNull();
    // El motivo es el de siempre, no el aviso generico de "no pudimos cancelar".
    expect(within(actual).queryByText('No pudimos cancelar la división.')).toBeNull();
    // Y la cuota que acaba de pagarse se ve pagada.
    expect(within(actual).getAllByText('Pagada')).toHaveLength(2);
  });

  it('un fallo cualquiera al cancelar sigue diciendo "No pudimos cancelar"', async () => {
    const detalle = await abrirElDetalle(grupo('active', 'yo'), [
      cuota('s1', 'yo', 'Yo', 'paid'),
      cuota('s2', 'otro', 'Otro', 'pending'),
    ]);
    mocks.cancelSplit.mockResolvedValue({
      success: false,
      error: { code: 'CANCEL_FAILED', message: 'boom' },
    });

    fireEvent.click(within(detalle).getByRole('button', BOTON_CANCELAR));
    fireEvent.click(await within(detalle).findByRole('button', { name: /^cancelar división$/i }));

    expect(await screen.findByText('No pudimos cancelar la división.')).toBeInTheDocument();
    expect(screen.queryByText(MOTIVO)).toBeNull();
  });
});
