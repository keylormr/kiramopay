import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { useAccountStore } from '@/stores/account.store';
import type { Budget } from '@/types';
import { BudgetView } from '../BudgetView';

// Hallazgo QA n=51: la pantalla existia pero nadie la abria, y sus altas,
// cambios y bajas solo tocaban el almacen local: la siguiente sincronizacion
// las borraba. Ahora lee y escribe en el servidor, y dice que lo gastado lo
// anota la persona (ningun movimiento lo actualiza).

const api = vi.hoisted(() => ({
  budgets: {
    getBudgets: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    resetAll: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => api }));

const comida: Budget = { id: 'b1', label: 'Comida', spent: 45000, limit: 80000, ccy: 'CRC', icon: 'utensils', color: '#f97316' };
const salidas: Budget = { id: 'b2', label: 'Salidas', spent: 30000, limit: 25000, ccy: 'CRC', icon: 'gamepad-2', color: '#a855f7' };

const pintar = () =>
  render(
    <LanguageProvider>
      <BudgetView onClose={vi.fn()} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  for (const fn of Object.values(api.budgets)) fn.mockReset();
  useAccountStore.setState({ budgets: [] });
});

describe('BudgetView — conectada al servidor', () => {
  it('muestra lo que responde el servidor, con lo que queda y lo que se paso', async () => {
    api.budgets.getBudgets.mockResolvedValue({ success: true, data: [comida, salidas] });
    pintar();

    expect(await screen.findByText('Comida')).toBeInTheDocument();
    expect(screen.getByText('Te quedan ₡35,000')).toBeInTheDocument();
    expect(screen.getByText('Te pasaste por ₡5,000')).toBeInTheDocument();
    expect(screen.getByText('₡75,000')).toBeInTheDocument();
    // Dice que lo gastado se anota a mano: no promete seguimiento automatico.
    expect(screen.getByText(/No se descuenta solo de tus movimientos/)).toBeInTheDocument();
  });

  it('una consulta que falla no se presenta como "no tienes presupuestos"', async () => {
    api.budgets.getBudgets
      .mockResolvedValueOnce({ success: false, error: { code: 'FETCH_FAILED', message: 'x' } })
      .mockResolvedValueOnce({ success: true, data: [comida] });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar tus presupuestos.');
    expect(screen.queryByText('Aún no tienes presupuestos')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Comida')).toBeInTheDocument();
  });

  it('crear uno lo manda al servidor y usa lo que el servidor devolvio', async () => {
    api.budgets.getBudgets.mockResolvedValue({ success: true, data: [] });
    api.budgets.create.mockResolvedValue({ success: true, data: { ...comida, id: 'srv-1', spent: 0 } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Nuevo presupuesto' }));
    const hoja = await screen.findByRole('dialog');
    await user.type(within(hoja).getByLabelText('Categoría'), '  Comida ');
    await user.type(within(hoja).getByLabelText('Tope'), '80000');
    await user.click(within(hoja).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(api.budgets.create).toHaveBeenCalledWith(
        expect.objectContaining({ label: 'Comida', amount_limit: 80000, currency: 'CRC', period: 'monthly' }),
      ),
    );
    expect(await screen.findByText('Te quedan ₡80,000')).toBeInTheDocument();
    expect(useAccountStore.getState().budgets[0].id).toBe('srv-1');
  });

  it('un tope en cero deja el boton deshabilitado y lo explica', async () => {
    api.budgets.getBudgets.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Nuevo presupuesto' }));
    const hoja = await screen.findByRole('dialog');
    await user.type(within(hoja).getByLabelText('Categoría'), 'Comida');
    await user.type(within(hoja).getByLabelText('Tope'), '0');

    expect(within(hoja).getByText('El monto debe ser mayor a cero.')).toBeInTheDocument();
    expect(within(hoja).getByRole('button', { name: 'Guardar' })).toBeDisabled();
  });

  it('anotar un gasto suma al total que guarda el servidor, sin mover dinero', async () => {
    api.budgets.getBudgets.mockResolvedValue({ success: true, data: [comida] });
    api.budgets.update.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Anotar gasto' }));
    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText(/No mueve dinero de tu cuenta/)).toBeInTheDocument();
    await user.type(within(hoja).getByLabelText('Monto'), '5000');
    await user.click(within(hoja).getByRole('button', { name: 'Anotar' }));

    await waitFor(() => expect(api.budgets.update).toHaveBeenCalledWith('b1', { amount_spent: 50000 }));
    expect(await screen.findByText('Te quedan ₡30,000')).toBeInTheDocument();
  });

  it('si el presupuesto ya no existe, lo dice y relee la lista', async () => {
    api.budgets.getBudgets
      .mockResolvedValueOnce({ success: true, data: [comida] })
      .mockResolvedValueOnce({ success: true, data: [] });
    api.budgets.update.mockResolvedValue({ success: false, error: { code: 'BUDGET_NOT_FOUND', message: 'budget not found' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Anotar gasto' }));
    const hoja = await screen.findByRole('dialog');
    await user.type(within(hoja).getByLabelText('Monto'), '5000');
    await user.click(within(hoja).getByRole('button', { name: 'Anotar' }));

    expect(await within(hoja).findByRole('alert')).toHaveTextContent('Ese presupuesto ya no existe. Actualizamos la lista.');
    expect(screen.queryByText(/budget not found/)).toBeNull();
    await waitFor(() => expect(api.budgets.getBudgets).toHaveBeenCalledTimes(2));
  });

  it('eliminar pide confirmacion y aclara que el saldo no cambia', async () => {
    api.budgets.getBudgets.mockResolvedValue({ success: true, data: [comida] });
    api.budgets.delete.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Eliminar: Comida' }));
    const hoja = await screen.findByRole('dialog');
    expect(within(hoja).getByText(/Tu saldo y tus movimientos no cambian/)).toBeInTheDocument();
    expect(api.budgets.delete).not.toHaveBeenCalled();

    await user.click(within(hoja).getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(api.budgets.delete).toHaveBeenCalledWith('b1'));
    expect(await screen.findByText('Aún no tienes presupuestos')).toBeInTheDocument();
  });

  it('empezar de cero pone lo anotado en cero en el servidor y conserva los topes', async () => {
    api.budgets.getBudgets.mockResolvedValue({ success: true, data: [comida] });
    api.budgets.resetAll.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Empezar de cero' }));
    const hoja = await screen.findByRole('dialog');
    await user.click(within(hoja).getByRole('button', { name: 'Poner en cero' }));

    await waitFor(() => expect(api.budgets.resetAll).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Te quedan ₡80,000')).toBeInTheDocument();
    expect(useAccountStore.getState().budgets[0]).toMatchObject({ spent: 0, limit: 80000 });
  });

  it('un rechazo sin codigo conocido cae al generico traducido', async () => {
    api.budgets.getBudgets.mockResolvedValue({ success: true, data: [comida] });
    api.budgets.resetAll.mockResolvedValue({ success: false, error: { code: 'RESET_FAILED', message: 'internal server error' } });
    const user = userEvent.setup();
    pintar();

    await user.click(await screen.findByRole('button', { name: 'Empezar de cero' }));
    const hoja = await screen.findByRole('dialog');
    await user.click(within(hoja).getByRole('button', { name: 'Poner en cero' }));

    expect(await within(hoja).findByRole('alert')).toHaveTextContent('No se pudo poner en cero lo anotado. Intenta de nuevo.');
  });
});
