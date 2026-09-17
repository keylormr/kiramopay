import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { useRecurringStore } from '@/stores/recurring.store';
import type { RecurringPayment } from '@/types';
import { RecurringView } from '../RecurringView';

// Hallazgo QA n=51: la pantalla existia pero nadie la abria, sus cambios solo
// vivian en el almacen local y el texto vacio prometia "pagos automaticos" que
// nada ejecuta. Ahora lee y escribe en el servidor, y "Ya lo pague" dice antes
// de confirmar que no mueve dinero.

const api = vi.hoisted(() => ({
  recurring: {
    getPayments: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    toggle: vi.fn(),
    markPaid: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => api }));

const luz: RecurringPayment = {
  id: 'p1', label: 'Recibo de luz', type: 'service', amount: 32450, ccy: 'CRC',
  frequency: 'monthly', nextDate: '2099-01-31', enabled: true,
};
const recarga: RecurringPayment = {
  id: 'p2', label: 'Recarga Kolbi', type: 'recharge', amount: 5000, ccy: 'CRC',
  frequency: 'weekly', nextDate: '2099-02-10', enabled: false,
};

const pintar = () =>
  render(
    <LanguageProvider>
      <RecurringView onClose={vi.fn()} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  for (const fn of Object.values(api.recurring)) fn.mockReset();
  useRecurringStore.setState({ payments: [] });
});

describe('RecurringView — conectada al servidor y sin prometer cobros', () => {
  it('lista lo que responde el servidor, activos y en pausa, y aclara que no paga solo', async () => {
    api.recurring.getPayments.mockResolvedValue({ success: true, data: [recarga, luz] });
    pintar();

    expect(await screen.findByText('Recibo de luz')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Activos/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /En pausa/ })).toBeInTheDocument();
    expect(screen.getByText(/KiramoPay no los paga por ti/)).toBeInTheDocument();
    expect(screen.queryByText(/automátic/i)).toBeNull();
  });

  it('una consulta que falla no se presenta como lista vacia', async () => {
    api.recurring.getPayments.mockResolvedValue({ success: false, error: { code: 'FETCH_FAILED', message: 'x' } });
    pintar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar tus pagos fijos.');
    expect(screen.queryByText('Aún no tienes pagos fijos')).toBeNull();
  });

  it('un pago cuya fecha ya paso se marca como pendiente', async () => {
    api.recurring.getPayments.mockResolvedValue({ success: true, data: [{ ...luz, nextDate: '2020-03-15' }] });
    pintar();

    expect(await screen.findByText(/^Tocaba el/)).toBeInTheDocument();
  });

  it('"Ya lo pague" explica que no envia dinero, con la fecha que guardara el servidor', async () => {
    api.recurring.getPayments.mockResolvedValue({ success: true, data: [luz] });
    api.recurring.markPaid.mockResolvedValue({
      success: true,
      data: { ...luz, nextDate: '2099-02-28', lastPaidDate: '2026-09-16' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Ya lo pagué' }));
    const hoja = await screen.findByRole('dialog');
    // 31 de enero + un mes = 28 de febrero, como lo calcula el servidor.
    expect(within(hoja).getByText(/próxima fecha pasa al 28 feb 2099/)).toBeInTheDocument();
    expect(within(hoja).getByText(/Esto no envía dinero/)).toBeInTheDocument();
    expect(api.recurring.markPaid).not.toHaveBeenCalled();

    await user.click(within(hoja).getByRole('button', { name: 'Sí, ya lo pagué' }));

    await waitFor(() => expect(api.recurring.markPaid).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('Próximo: 28 feb 2099')).toBeInTheDocument();
    expect(screen.getByText(/Último pago anotado:/)).toBeInTheDocument();
  });

  it('crear uno lo manda al servidor con la fecha elegida', async () => {
    api.recurring.getPayments.mockResolvedValue({ success: true, data: [] });
    api.recurring.create.mockResolvedValue({ success: true, data: { ...luz, id: 'srv-1' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Nuevo pago fijo' }));
    const hoja = await screen.findByRole('dialog');
    const guardar = within(hoja).getByRole('button', { name: 'Guardar' });
    await user.type(within(hoja).getByLabelText('Nombre del pago'), 'Recibo de luz');
    await user.type(within(hoja).getByLabelText('Monto'), '32450');
    // Sin fecha no se puede guardar.
    expect(guardar).toBeDisabled();
    await user.type(within(hoja).getByLabelText('Próxima fecha'), '2099-01-31');
    await user.click(within(hoja).getByRole('button', { name: 'Semanal' }));
    await user.click(guardar);

    await waitFor(() =>
      expect(api.recurring.create).toHaveBeenCalledWith({
        label: 'Recibo de luz', type: 'service', amount: 32450, currency: 'CRC', frequency: 'weekly', next_date: '2099-01-31',
      }),
    );
    expect(await screen.findByText('Recibo de luz')).toBeInTheDocument();
  });

  it('una fecha rechazada por el servidor se explica en espanol', async () => {
    api.recurring.getPayments.mockResolvedValue({ success: true, data: [] });
    api.recurring.create.mockResolvedValue({
      success: false,
      error: { code: 'RECURRING_INVALID_DATE', message: 'next_date must be a YYYY-MM-DD date' },
    });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Nuevo pago fijo' }));
    const hoja = await screen.findByRole('dialog');
    await user.type(within(hoja).getByLabelText('Nombre del pago'), 'Luz');
    await user.type(within(hoja).getByLabelText('Monto'), '100');
    await user.type(within(hoja).getByLabelText('Próxima fecha'), '2099-01-31');
    await user.click(within(hoja).getByRole('button', { name: 'Guardar' }));

    expect(await within(hoja).findByRole('alert')).toHaveTextContent('Elige una fecha válida para el próximo pago.');
    expect(screen.queryByText(/YYYY-MM-DD/)).toBeNull();
  });

  it('pausar usa el estado que devuelve el servidor', async () => {
    api.recurring.getPayments.mockResolvedValue({ success: true, data: [luz] });
    api.recurring.toggle.mockResolvedValue({ success: true, data: { enabled: false } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Pausar: Recibo de luz' }));

    await waitFor(() => expect(api.recurring.toggle).toHaveBeenCalledWith('p1'));
    expect(await screen.findByRole('heading', { name: /En pausa/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ya lo pagué' })).toBeNull();
  });

  it('eliminar aclara que no cancela nada con la empresa', async () => {
    api.recurring.getPayments.mockResolvedValue({ success: true, data: [luz] });
    api.recurring.delete.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Eliminar: Recibo de luz' }));
    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText(/No cancela nada con la empresa/)).toBeInTheDocument();
    await user.click(within(hoja).getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(api.recurring.delete).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('Aún no tienes pagos fijos')).toBeInTheDocument();
  });
});
