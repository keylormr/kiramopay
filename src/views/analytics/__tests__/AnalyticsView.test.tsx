import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AnalyticsView } from '../AnalyticsView';
import { hoyCR, periodoAnterior, rangoPreset } from '@/utils/periodos';
import type { SummaryGroup } from '@/api/repositories/transaction.repository';
import type { Transaction } from '@/types';

const mockApi = vi.hoisted(() => ({
  transactions: { getSummary: vi.fn() },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

// Lo que el telefono tiene guardado: solo los movimientos recientes.
const storeTransactions = vi.hoisted(() => ({ value: [] as Transaction[] }));
vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { transactions: storeTransactions.value, baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

function tx(id: string, amount: number, title: string): Transaction {
  const dateISO = new Date().toISOString();
  return {
    id,
    title,
    type: amount > 0 ? 'credit' : 'debit',
    amount,
    ccy: 'CRC',
    description: '',
    date: dateISO,
    dateISO,
    status: 'completed',
    category: amount > 0 ? 'income' : 'shopping',
    kind: amount > 0 ? 'sinpe_receive' : 'qr_payment',
  };
}

const hoy = hoyCR();
const grupo = (direction: 'in' | 'out', amount: number, extra: Partial<SummaryGroup> = {}): SummaryGroup => ({
  date: hoy,
  ccy: 'CRC',
  category: direction === 'in' ? 'income' : 'shopping',
  direction,
  count: 1,
  amountMinor: Math.round(amount * 100),
  ...extra,
});

function responde(groups: SummaryGroup[], top: Transaction[] = []) {
  mockApi.transactions.getSummary.mockResolvedValue({ success: true, data: { from: '', to: '', groups, top, firstDate: null } });
}

function setup() {
  return render(
    <LanguageProvider>
      <AnalyticsView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  storeTransactions.value = [];
});

describe('AnalyticsView — periodo y datos', () => {
  // El servidor corta los dias en hora de Costa Rica: el cliente pide con las
  // mismas fechas, y compara contra los mismos dias del mes anterior.
  it('abre en el mes en curso y compara contra los mismos dias del mes anterior', async () => {
    responde([grupo('out', 1000)]);
    setup();

    const mes = rangoPreset('este_mes', hoy);
    const previo = periodoAnterior(mes, hoy)!;
    await waitFor(() => {
      expect(mockApi.transactions.getSummary).toHaveBeenCalledWith({ from: mes.desde, to: mes.hasta });
      expect(mockApi.transactions.getSummary).toHaveBeenCalledWith({ from: previo.desde, to: previo.hasta });
    });
  });

  it('los atajos piden el rango que nombran', async () => {
    responde([grupo('out', 1000)]);
    setup();
    await screen.findByText('Balance del período');

    fireEvent.click(screen.getByRole('button', { name: 'Mes pasado' }));
    const pasado = rangoPreset('mes_pasado', hoy);
    await waitFor(() => {
      expect(mockApi.transactions.getSummary).toHaveBeenCalledWith({ from: pasado.desde, to: pasado.hasta });
    });
    expect(screen.getByRole('button', { name: 'Mes pasado' })).toHaveAttribute('aria-pressed', 'true');
  });

  // Nada de pantallas vacias sin explicacion: si el servidor falla se resume lo
  // guardado, y la pantalla dice que es solo lo reciente.
  it('si el servidor no responde, usa lo guardado y lo dice', async () => {
    storeTransactions.value = [tx('s1', -500, 'Cafe')];
    mockApi.transactions.getSummary.mockRejectedValue(new Error('offline'));
    setup();

    expect(await screen.findByText(/No se pudo cargar el per[ií]odo completo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    const principales = screen.getByRole('region', { name: 'Principales movimientos' });
    expect(within(principales).getByText('-₡500.00')).toBeInTheDocument();
    // La comparacion no mezcla lo guardado con un total del servidor.
    expect(screen.getByText('No se pudo cargar el período anterior para comparar.')).toBeInTheDocument();
  });

  // Sin servidor y sin nada guardado del periodo no hay "periodo vacio": hay un
  // periodo que no se pudo leer, y se dice asi.
  it('sin servidor y sin datos guardados no finge un periodo vacio', async () => {
    mockApi.transactions.getSummary.mockRejectedValue(new Error('offline'));
    setup();

    expect(await screen.findByText('No se pudo cargar el análisis de este período')).toBeInTheDocument();
    expect(screen.queryByText('Sin movimientos en este período')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(mockApi.transactions.getSummary.mock.calls.length).toBeGreaterThan(2));
  });

  // Quien empezo a usar la app a mitad del periodo anterior no tiene un periodo
  // anterior completo: compararlo daria un porcentaje que no significa nada.
  it('no compara contra un periodo anterior que empieza antes del primer movimiento', async () => {
    const previo = periodoAnterior(rangoPreset('este_mes', hoy), hoy)!;
    // El historial arranca despues de que empezo el periodo anterior.
    mockApi.transactions.getSummary.mockResolvedValue({
      success: true,
      data: { from: '', to: '', groups: [grupo('out', 1000)], top: [], firstDate: previo.hasta },
    });
    setup();

    expect(await screen.findByText(/Tu primer movimiento es del .*no se compara\./)).toBeInTheDocument();
    const comparacion = screen.getByRole('region', { name: 'Contra el período anterior' });
    expect(within(comparacion).queryByText(/%/)).not.toBeInTheDocument();
  });

  it('con el historial completo si compara', async () => {
    mockApi.transactions.getSummary.mockResolvedValue({
      success: true,
      data: { from: '', to: '', groups: [grupo('out', 1000)], top: [], firstDate: '2020-01-01' },
    });
    setup();

    const comparacion = await screen.findByRole('region', { name: 'Contra el período anterior' });
    expect(await within(comparacion).findByText('Gastaste casi lo mismo que en el período anterior', { exact: false })).toBeInTheDocument();
  });

  // El periodo anterior puede no llegar: la tarjeta lo dice en vez de quedarse
  // cargando para siempre.
  it('si el periodo anterior no llega, la comparacion lo dice', async () => {
    const mes = rangoPreset('este_mes', hoy);
    mockApi.transactions.getSummary.mockImplementation(async ({ from }: { from: string }) =>
      from === mes.desde
        ? { success: true, data: { from: '', to: '', groups: [grupo('out', 1000)], top: [], firstDate: null } }
        : { success: false, error: { code: 'FETCH_FAILED', message: 'x' } },
    );
    setup();

    expect(await screen.findByText('No se pudo cargar el período anterior para comparar.')).toBeInTheDocument();
  });
});

describe('AnalyticsView — lo que pidio el dueno', () => {
  it('los filtros dicen Ingresos y Gastos, y los gastos van en rojo', async () => {
    responde(
      [grupo('in', 5000), grupo('out', 1200)],
      [tx('in1', 5000, 'Salario'), tx('out1', -1200, 'Automercado')],
    );
    setup();

    const filtros = await screen.findByRole('group', { name: 'Principales movimientos' });
    expect(within(filtros).getByRole('button', { name: 'Ingresos' })).toBeInTheDocument();
    expect(within(filtros).getByRole('button', { name: 'Gastos' })).toBeInTheDocument();
    expect(screen.queryByText('Recibidos')).not.toBeInTheDocument();
    expect(screen.queryByText('Enviados')).not.toBeInTheDocument();

    fireEvent.click(within(filtros).getByRole('button', { name: 'Gastos' }));
    expect(screen.queryByText('Salario')).not.toBeInTheDocument();
    const gasto = screen.getByText('-₡1,200.00');
    expect(gasto.className).toContain('--color-danger-strong');
    expect(gasto.className).not.toContain('uv-text-primary');
  });

  // Sumar lo que entro con lo que salio da un numero que no es nada: ni lo que
  // se tiene ni lo que se gasto. La cifra grande es el balance.
  it('no presenta ingresos mas gastos como un total; muestra el balance', async () => {
    responde([grupo('in', 5000), grupo('out', 1200)]);
    setup();

    expect(await screen.findByText('+₡3,800.00')).toBeInTheDocument();
    expect(screen.queryByText(/total del per[ií]odo/i)).not.toBeInTheDocument();
    expect(screen.queryByText('₡6.2K')).not.toBeInTheDocument();
    expect(screen.getByText('2 movimientos: 1 ingreso y 1 gasto')).toBeInTheDocument();
  });

  it('cuenta con el plural correcto', async () => {
    responde([grupo('in', 5000, { count: 3 }), grupo('out', 1200, { count: 1 })]);
    setup();

    expect(await screen.findByText('4 movimientos: 3 ingresos y 1 gasto')).toBeInTheDocument();
  });

  // Quien tiene colones y dolares elige cual ver; nunca se suman.
  it('con colones y dolares ofrece elegir la moneda', async () => {
    responde([grupo('out', 1000), grupo('out', 25, { ccy: 'USD', count: 2 })]);
    setup();

    const monedas = await screen.findByRole('group', { name: 'Moneda del análisis' });
    expect(within(monedas).getByRole('button', { name: 'Colones' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Movimientos en otras monedas: 2 (fuera de estos totales)')).toBeInTheDocument();

    fireEvent.click(within(monedas).getByRole('button', { name: 'Dólares' }));
    expect(within(monedas).getByRole('button', { name: 'Dólares' })).toHaveAttribute('aria-pressed', 'true');
    const balance = screen.getByRole('region', { name: 'Balance del período' });
    expect(within(balance).getByText('-$25.00')).toBeInTheDocument();
    expect(screen.getByText('Movimientos en otras monedas: 1 (fuera de estos totales)')).toBeInTheDocument();
  });

  it('un periodo sin movimientos lo dice y ofrece uno mas amplio', async () => {
    responde([]);
    setup();

    expect(await screen.findByText('Sin movimientos en este período')).toBeInTheDocument();
    const vacio = screen.getByText('Sin movimientos en este período').closest('section')!;
    fireEvent.click(within(vacio).getByRole('button', { name: 'Este año' }));
    const ano = rangoPreset('este_ano', hoy);
    await waitFor(() => {
      expect(mockApi.transactions.getSummary).toHaveBeenCalledWith({ from: ano.desde, to: ano.hasta });
    });
  });
});
