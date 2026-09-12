import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminPromocionesView } from '../AdminPromocionesView';

// El fondo del que sale el cashback de puntos. Registrar un deposito sube la
// reserva publicada: se confirma diciendo cuanto y con que referencia, y se
// avisa antes de hacerlo.
const mocks = vi.hoisted(() => ({ saldoPromociones: vi.fn(), fondearPromociones: vi.fn() }));

vi.mock('@/api', () => ({ getApiLayer: () => ({ admin: mocks }) }));

const pintar = () =>
  render(
    <LanguageProvider>
      <AdminPromocionesView onClose={vi.fn()} />
    </LanguageProvider>,
  );

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  mocks.saldoPromociones.mockReset();
  mocks.fondearPromociones.mockReset();
  mocks.saldoPromociones.mockResolvedValue({ success: true, data: { saldoMinor: 12_500_000 } });
});

describe('AdminPromocionesView', () => {
  it('muestra el saldo del fondo con miles', async () => {
    pintar();
    expect(await screen.findByText('₡125,000.00')).toBeInTheDocument();
  });

  it('un saldo que no se pudo leer no se muestra como cero', async () => {
    mocks.saldoPromociones.mockResolvedValue({ success: false, error: { code: 'X', message: 'sin red' } });
    pintar();
    expect(await screen.findByText('sin red')).toBeInTheDocument();
    expect(screen.queryByText('₡0.00')).not.toBeInTheDocument();
  });

  it('registrar exige referencia, avisa que sube la reserva y manda centimos', async () => {
    mocks.fondearPromociones.mockResolvedValue({ success: true, data: { saldoMinor: 22_500_000 } });
    const user = userEvent.setup();
    pintar();
    await screen.findByText('₡125,000.00');

    const boton = screen.getByRole('button', { name: 'Registrar depósito' });
    await user.type(screen.getByPlaceholderText('0.00'), '100000');
    // Sin referencia no se puede.
    expect(boton).toBeDisabled();
    await user.type(screen.getByPlaceholderText(/transferencia o comprobante/i), 'TRF-2026-0911');
    expect(boton).toBeEnabled();

    await user.click(boton);
    expect(await screen.findByText(/sube la reserva/i)).toBeInTheDocument();
    expect(screen.getByText(/₡100,000.00 en el fondo de promociones, con la referencia TRF-2026-0911/)).toBeInTheDocument();
    expect(mocks.fondearPromociones).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocks.fondearPromociones).toHaveBeenCalledWith(10_000_000, 'TRF-2026-0911', expect.any(String)));
    expect(await screen.findByText('₡225,000.00')).toBeInTheDocument();
  });

  it('un reintento tras un fallo usa la MISMA llave: no fondea dos veces', async () => {
    mocks.fondearPromociones
      .mockResolvedValueOnce({ success: false, error: { code: 'NETWORK_ERROR', message: 'sin red' } })
      .mockResolvedValueOnce({ success: true, data: { saldoMinor: 13_000_000 } });
    const user = userEvent.setup();
    pintar();
    await screen.findByText('₡125,000.00');

    await user.type(screen.getByPlaceholderText('0.00'), '5000');
    await user.type(screen.getByPlaceholderText(/transferencia o comprobante/i), 'TRF-1');
    await user.click(screen.getByRole('button', { name: 'Registrar depósito' }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar' }));
    await screen.findByText('sin red');
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(mocks.fondearPromociones).toHaveBeenCalledTimes(2));
    const [primera, segunda] = mocks.fondearPromociones.mock.calls;
    expect(segunda[2]).toBe(primera[2]);
  });
});
