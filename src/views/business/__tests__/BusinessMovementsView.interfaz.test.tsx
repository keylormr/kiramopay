import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { VENTAS_POR_PAGINA, type QRMerchant, type QRPayment } from '@/api/repositories/qrpayment.repository';
import { BusinessMovementsView } from '../BusinessMovementsView';

// La pantalla de movimientos del comercio: cobros agrupados por dia con el total
// de cada dia por moneda, filtro de periodo, un icono por tipo de movimiento, el
// detalle de cada cobro con lo que el servidor dio, y exportar respetando el
// plan. Todo lo que no llega del servidor se dice, no se pinta como dato.

const mocks = vi.hoisted(() => ({
  api: {
    qrPayments: {
      getMerchantPayments: vi.fn(),
      getMerchantDailyTotals: vi.fn(),
      getMerchantWithdrawals: vi.fn(),
      exportMerchantReportCsv: vi.fn(),
    },
  },
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  getApiLayer: () => mocks.api,
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

const comercio = (extra: Partial<QRMerchant> = {}): QRMerchant => ({
  id: 'm1', name: 'Super La Esquina', description: '', category: 'retail', qrCode: 'MRC-1', active: true,
  cedula: '3101', cedulaType: 'juridica', legalName: 'La Esquina SA', verificationStatus: 'verified',
  commissionBps: 50, comisionEfectivaBps: 50, promoHasta: null, plan: 'base', role: 'owner',
  ...extra,
});

const cobro = (id: string, extra: Partial<QRPayment> = {}): QRPayment => ({
  id, qrCodeId: 'q1', payerId: 'u2', receiverId: 'u1', merchantId: 'm1',
  amount: 1000, fee: 5, currency: 'CRC', status: 'completed', createdAt: '2026-10-29T07:00:00Z',
  ...extra,
});

const pintar = (m: QRMerchant = comercio()) =>
  render(
    <LanguageProvider>
      <BusinessMovementsView merchant={m} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  // Costa Rica, y "ahora" fijo: 29-10-2026 09:30 alla.
  vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(360);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T15:30:00Z'));
  Object.values(mocks.api.qrPayments).forEach((fn) => fn.mockReset());
  mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({ success: true, data: [] });
  mocks.api.qrPayments.getMerchantDailyTotals.mockResolvedValue({ success: true, data: [] });
  mocks.api.qrPayments.getMerchantWithdrawals.mockResolvedValue({ success: true, data: [] });
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:movimientos'), configurable: true, writable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true, writable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BusinessMovementsView: por dia, con el total de cada dia', () => {
  it('agrupa los cobros por el dia de quien mira y pone el total del dia, moneda por moneda', async () => {
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({
      success: true,
      data: [
        cobro('a', { createdAt: '2026-10-29T07:00:00Z' }), // 01:00 de hoy
        cobro('b', { createdAt: '2026-10-29T03:00:00Z', amount: 400, fee: 2 }), // 21:00 de ayer en CR
        cobro('c', { createdAt: '2026-10-28T20:00:00Z', amount: 100, fee: 1, currency: 'USD' }),
      ],
    });
    mocks.api.qrPayments.getMerchantDailyTotals.mockResolvedValue({
      success: true,
      data: [
        { date: '2026-10-29', currency: 'CRC', gross: 1000, fee: 5, net: 995, count: 1 },
        { date: '2026-10-28', currency: 'CRC', gross: 400, fee: 2, net: 398, count: 1 },
        { date: '2026-10-28', currency: 'USD', gross: 100, fee: 1, net: 99, count: 1 },
      ],
    });

    pintar();

    const hoy = await screen.findByRole('heading', { name: /Hoy/ });
    const ayer = screen.getByRole('heading', { name: /Ayer/ });
    expect(hoy).toBeInTheDocument();
    expect(ayer).toBeInTheDocument();

    // El total del dia sale del servidor, por moneda: colones y dolares no se suman.
    expect(screen.getByText('₡1,000.00 · 1 cobro')).toBeInTheDocument();
    expect(screen.getByText('₡400.00 · 1 cobro')).toBeInTheDocument();
    expect(screen.getByText('$100.00 · 1 cobro')).toBeInTheDocument();
    expect(screen.queryByText(/₡500\.00/)).toBeNull();
  });

  it('pide los cobros y los totales del periodo elegido; por defecto, 7 dias', async () => {
    pintar();
    await waitFor(() => expect(mocks.api.qrPayments.getMerchantPayments).toHaveBeenCalled());
    expect(mocks.api.qrPayments.getMerchantPayments).toHaveBeenCalledWith('m1', { periodo: 'week' });
    expect(mocks.api.qrPayments.getMerchantDailyTotals).toHaveBeenCalledWith('m1', 'week');
    expect(screen.getByRole('button', { name: '7 días' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('cambiar el periodo vuelve a pedir al servidor, no filtra lo que ya tenia', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    pintar();
    await waitFor(() => expect(mocks.api.qrPayments.getMerchantPayments).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Este mes' }));
    await waitFor(() =>
      expect(mocks.api.qrPayments.getMerchantPayments).toHaveBeenLastCalledWith('m1', { periodo: 'month' }),
    );
    expect(mocks.api.qrPayments.getMerchantDailyTotals).toHaveBeenLastCalledWith('m1', 'month');

    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));
    await waitFor(() =>
      expect(mocks.api.qrPayments.getMerchantPayments).toHaveBeenLastCalledWith('m1', { periodo: 'prev_month' }),
    );

    await user.click(screen.getByRole('button', { name: 'Hoy' }));
    await waitFor(() =>
      expect(mocks.api.qrPayments.getMerchantPayments).toHaveBeenLastCalledWith('m1', { periodo: 'today' }),
    );
    expect(screen.getByRole('button', { name: 'Hoy' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('un periodo sin movimientos lo dice, y no pinta un total en cero', async () => {
    pintar();
    expect(await screen.findByText('No hay movimientos en este período.')).toBeInTheDocument();
    expect(screen.queryByText(/₡0\.00/)).toBeNull();
  });

  it('si la lista falla lo dice y deja reintentar, no la pinta vacia', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mocks.api.qrPayments.getMerchantPayments
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } })
      .mockResolvedValueOnce({ success: true, data: [cobro('a')] });

    pintar();

    expect(await screen.findByText('No se pudieron cargar los cobros.')).toBeInTheDocument();
    expect(screen.queryByText('No hay movimientos en este período.')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findAllByTestId('movimiento')).toHaveLength(1);
  });

  it('si fallan los totales del dia, los cobros siguen y cada dia dice que no hay total', async () => {
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({ success: true, data: [cobro('a')] });
    mocks.api.qrPayments.getMerchantDailyTotals.mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } });

    pintar();

    expect(await screen.findAllByTestId('movimiento')).toHaveLength(1);
    expect(await screen.findByText('Total del día no disponible')).toBeInTheDocument();
    expect(screen.queryByText(/cobro$/)).toBeNull();
  });

  it('con una pagina llena ofrece pedir mas del MISMO periodo desde el ultimo cobro', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    const pagina = Array.from({ length: VENTAS_POR_PAGINA }, (_, i) => cobro(`p${i}`, { createdAt: `2026-10-2${i % 9}T07:00:00Z` }));
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValueOnce({ success: true, data: pagina });
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValueOnce({ success: true, data: [cobro('mas')] });

    pintar();
    await user.click(await screen.findByRole('button', { name: 'Ver más movimientos' }));

    await waitFor(() =>
      expect(mocks.api.qrPayments.getMerchantPayments).toHaveBeenLastCalledWith('m1', { periodo: 'week', antesDe: `p${VENTAS_POR_PAGINA - 1}` }),
    );
    // Una pagina entera de filas con icono: las consultas por rol de jsdom son lentas, no la pantalla.
  }, 20000);
});

describe('BusinessMovementsView: un icono por tipo de movimiento', () => {
  it('un cobro, una devolucion y un retiro no se parecen', async () => {
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({
      success: true,
      data: [
        cobro('venta', { createdAt: '2026-10-29T07:00:00Z' }),
        cobro('devuelta', { createdAt: '2026-10-29T06:30:00Z', status: 'refunded' }),
      ],
    });
    mocks.api.qrPayments.getMerchantWithdrawals.mockResolvedValue({
      success: true,
      data: [{ id: 'retiro', amount: 500, currency: 'CRC', status: 'completed', withdrawnByName: 'Keilor Martinez', createdAt: '2026-10-29T14:00:00Z' }],
    });

    pintar();

    const filas = await screen.findAllByTestId('movimiento');
    expect(filas.map((f) => f.getAttribute('data-tipo'))).toEqual(['retiro', 'cobro', 'devolucion']);
    expect(filas[0].querySelector('svg.lucide-arrow-up-right')).not.toBeNull();
    expect(filas[1].querySelector('svg.lucide-qr-code')).not.toBeNull();
    expect(filas[2].querySelector('svg.lucide-undo-2')).not.toBeNull();
    // Y cada uno lo dice con palabras, no solo con el icono.
    expect(within(filas[0]).getByText('Retiro')).toBeInTheDocument();
    expect(within(filas[1]).getByText('Cobro')).toBeInTheDocument();
    expect(within(filas[2]).getByText('Devolución')).toBeInTheDocument();
  });

  it('un retiro no cuenta en el total de ventas del dia ni cambia su cantidad de cobros', async () => {
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({ success: true, data: [cobro('venta')] });
    mocks.api.qrPayments.getMerchantDailyTotals.mockResolvedValue({
      success: true,
      data: [{ date: '2026-10-29', currency: 'CRC', gross: 1000, fee: 5, net: 995, count: 1 }],
    });
    mocks.api.qrPayments.getMerchantWithdrawals.mockResolvedValue({
      success: true,
      data: [{ id: 'retiro', amount: 500, currency: 'CRC', status: 'completed', createdAt: '2026-10-29T14:00:00Z' }],
    });

    pintar();

    expect(await screen.findByText('₡1,000.00 · 1 cobro')).toBeInTheDocument();
    expect(screen.getAllByTestId('movimiento')).toHaveLength(2);
  });

  it('un cajero no pide los retiros: el saldo del negocio no es suyo', async () => {
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({ success: true, data: [cobro('venta')] });

    pintar(comercio({ role: 'cashier' }));

    await screen.findAllByTestId('movimiento');
    expect(mocks.api.qrPayments.getMerchantWithdrawals).not.toHaveBeenCalled();
  });

  it('si los retiros no se pudieron traer, avisa que la lista no los incluye', async () => {
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({ success: true, data: [cobro('venta')] });
    mocks.api.qrPayments.getMerchantWithdrawals.mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'x' } });

    pintar();

    await screen.findAllByTestId('movimiento');
    expect(await screen.findByText('No se pudieron cargar los retiros: esta lista no los incluye.')).toBeInTheDocument();
  });
});

describe('BusinessMovementsView: el detalle de cada cobro', () => {
  it('tocar un cobro abre el detalle con quien pago, la referencia, la sucursal, el cajero, el estado, la fecha, la comision y el neto', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({
      success: true,
      data: [cobro('p1', {
        txId: 'tx-9f3a', locationId: 'l1', collectedBy: 'u3', note: '2x Cafe',
        payerName: 'Ana Mora', locationName: 'Sucursal Centro', collectorName: 'Luis Rojas',
      })],
    });

    pintar();
    await user.click((await screen.findAllByTestId('movimiento'))[0]);

    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText('Detalle del cobro')).toBeInTheDocument();
    expect(within(hoja).getByText('Ana Mora')).toBeInTheDocument();
    expect(within(hoja).getByText('tx-9f3a')).toBeInTheDocument();
    expect(within(hoja).getByText('Sucursal Centro')).toBeInTheDocument();
    expect(within(hoja).getByText('Luis Rojas')).toBeInTheDocument();
    expect(within(hoja).getByText('Completado')).toBeInTheDocument();
    expect(within(hoja).getByText('2x Cafe')).toBeInTheDocument();
    // La fecha y la hora de quien mira: 01:00 del 29 de octubre de 2026.
    expect(within(hoja).getByText(/29\/10\/2026/)).toBeInTheDocument();
    expect(within(hoja).getAllByText('₡1,000.00').length).toBeGreaterThan(0);
    expect(within(hoja).getByText('₡5.00')).toBeInTheDocument();
    expect(within(hoja).getByText('₡995.00')).toBeInTheDocument();
  });

  it('lo que el servidor no dio se dice: no hay un guion ni un cero en su lugar', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({
      // Hay sucursal pero sin nombre, y ni pagador ni cajero.
      success: true,
      data: [cobro('p1', { locationId: 'l1' })],
    });

    pintar();
    await user.click((await screen.findAllByTestId('movimiento'))[0]);

    const hoja = await screen.findByRole('dialog');
    // Pagador y sucursal: la fila existe pero no hay nombre.
    expect(within(hoja).getAllByText('No disponible')).toHaveLength(2);
    // Sin cajero asignado es un hecho (una venta de antes del equipo), no una falta.
    expect(within(hoja).getByText('Sin cajero registrado')).toBeInTheDocument();
    expect(within(hoja).queryByText('—')).toBeNull();
  });

  it('una venta sin sucursal dice que no tiene, no que falta el dato', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({
      success: true,
      data: [cobro('p1', { payerName: 'Ana Mora', collectedBy: 'u3', collectorName: 'Luis Rojas' })],
    });

    pintar();
    await user.click((await screen.findAllByTestId('movimiento'))[0]);

    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText('Sin sucursal asignada')).toBeInTheDocument();
    expect(within(hoja).queryByText('No disponible')).toBeNull();
  });

  it('un cobro devuelto se llama devuelto en el detalle', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({
      success: true,
      data: [cobro('p1', { status: 'refunded', payerName: 'Ana Mora' })],
    });

    pintar();
    await user.click((await screen.findAllByTestId('movimiento'))[0]);

    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText('Detalle de la devolución')).toBeInTheDocument();
    expect(within(hoja).getByText('Devuelto')).toBeInTheDocument();
  });

  it('el detalle de un retiro dice quien retiro y no inventa una comision', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mocks.api.qrPayments.getMerchantWithdrawals.mockResolvedValue({
      success: true,
      data: [{ id: 'r-77', amount: 500, currency: 'CRC', status: 'completed', withdrawnByName: 'Keilor Martinez', createdAt: '2026-10-29T14:00:00Z' }],
    });

    pintar();
    await user.click((await screen.findAllByTestId('movimiento'))[0]);

    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText('Detalle del retiro')).toBeInTheDocument();
    expect(within(hoja).getByText('Keilor Martinez')).toBeInTheDocument();
    expect(within(hoja).getByText('r-77')).toBeInTheDocument();
    expect(within(hoja).queryByText('Comisión')).toBeNull();
    expect(within(hoja).queryByText('Neto recibido')).toBeNull();
  });
});

describe('BusinessMovementsView: exportar respeta el plan', () => {
  it('con el plan Analitica exporta el periodo elegido en el idioma de la app', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mocks.api.qrPayments.exportMerchantReportCsv.mockResolvedValue({
      success: true,
      data: { blob: new Blob(['x']), nombre: 'reporte.csv' },
    });

    pintar(comercio({ plan: 'analitica' }));
    await user.click(screen.getByRole('button', { name: 'Mes anterior' }));
    await user.click(await screen.findByRole('button', { name: 'Exportar CSV' }));

    await waitFor(() =>
      expect(mocks.api.qrPayments.exportMerchantReportCsv).toHaveBeenCalledWith('m1', expect.any(Number), 'es', 'prev_month'),
    );
    expect(await screen.findByText('Listo. El archivo se descargó.')).toBeInTheDocument();
  });

  it('sin el plan no se puede exportar y lo dice claro, sin llamar al servidor', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    pintar(comercio({ plan: 'base' }));

    const boton = await screen.findByRole('button', { name: 'Exportar CSV' });
    expect(boton).toHaveAttribute('aria-disabled', 'true');
    await user.click(boton);

    expect(mocks.api.qrPayments.exportMerchantReportCsv).not.toHaveBeenCalled();
    expect(screen.getByText('Exportar el reporte requiere el plan Analítica.')).toBeInTheDocument();
  });

  it('si el servidor responde que falta el plan, lo dice', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    mocks.api.qrPayments.exportMerchantReportCsv.mockResolvedValue({ success: false, error: { code: 'PLAN_REQUIRED', message: 'x' } });

    pintar(comercio({ plan: 'analitica' }));
    await user.click(await screen.findByRole('button', { name: 'Exportar CSV' }));

    expect(await screen.findByText('Exportar el reporte requiere el plan Analítica.')).toBeInTheDocument();
  });

  it('un cajero no ve el boton: el reporte no es suyo', async () => {
    pintar(comercio({ role: 'cashier', plan: 'analitica' }));
    await waitFor(() => expect(mocks.api.qrPayments.getMerchantPayments).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).toBeNull();
  });
});

describe('BusinessMovementsView: la fecha y la hora en el idioma de la app', () => {
  it('con la app en espanol la hora sale en la zona de quien mira', async () => {
    mocks.api.qrPayments.getMerchantPayments.mockResolvedValue({
      success: true,
      data: [cobro('p1', { createdAt: '2026-10-29T21:45:00Z' })], // 15:45 en Costa Rica
    });

    pintar();

    const fila = (await screen.findAllByTestId('movimiento'))[0];
    expect(fila.textContent).toMatch(/3:45/);
  });
});
