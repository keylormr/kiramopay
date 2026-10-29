import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminCapitalView } from '../AdminCapitalView';

// El capital propio de KiramoPay puede quedar en negativo (decision del dueno:
// "Permitir y avisar"): las operaciones siguen funcionando y el panel dice, por
// moneda, cuanto falta para saber cuanto habria que depositar con dinero real.
// El dato sale del libro contable; la pantalla solo lo muestra, nunca lo calcula.
const mocks = vi.hoisted(() => ({ capitalPropio: vi.fn() }));

vi.mock('@/api', () => ({ getApiLayer: () => ({ admin: mocks }) }));

const pintar = () =>
  render(
    <LanguageProvider>
      <AdminCapitalView onClose={vi.fn()} />
    </LanguageProvider>,
  );

const colones = (saldoMinor: number) => ({
  moneda: 'CRC',
  saldoMinor,
  faltanteMinor: Math.max(0, -saldoMinor),
  enNegativo: saldoMinor < 0,
});
const dolares = (saldoMinor: number) => ({
  moneda: 'USD',
  saldoMinor,
  faltanteMinor: Math.max(0, -saldoMinor),
  enNegativo: saldoMinor < 0,
});

beforeEach(() => {
  localStorage.setItem('kiramopay_language', 'es');
  mocks.capitalPropio.mockReset();
});

describe('AdminCapitalView', () => {
  it('en negativo dice cuanto falta, en rojo, y muestra el saldo con su signo', async () => {
    mocks.capitalPropio.mockResolvedValue({ success: true, data: [colones(-19_670), dolares(0)] });
    pintar();

    const aviso = await screen.findByText(
      'Faltan ₡196.70: con dinero real, la empresa tendría que depositar este monto.',
    );
    expect(aviso.className).toMatch(/danger/);
    const saldo = screen.getByText('-₡196.70');
    expect(saldo.className).toMatch(/danger/);
  });

  it('cada moneda va por su lado: lo que falta en colones no mancha los dolares', async () => {
    mocks.capitalPropio.mockResolvedValue({ success: true, data: [colones(-19_670), dolares(5_000)] });
    pintar();

    await screen.findByText(/Faltan ₡196.70/);
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    // Una sola moneda en rojo: el aviso de faltante aparece una vez.
    expect(screen.getAllByText(/^Faltan /)).toHaveLength(1);
    expect(screen.getAllByText('Sin faltante: no hace falta depositar nada.')).toHaveLength(1);
  });

  it('en positivo o en cero no avisa de ningun faltante', async () => {
    mocks.capitalPropio.mockResolvedValue({ success: true, data: [colones(0), dolares(250_000)] });
    pintar();

    await screen.findByText('$2,500.00');
    expect(screen.queryByText(/^Faltan /)).toBeNull();
    expect(screen.getAllByText('Sin faltante: no hace falta depositar nada.')).toHaveLength(2);
  });

  it('un dato que no cargo no se pinta como cero: lo dice y deja reintentar', async () => {
    mocks.capitalPropio
      .mockResolvedValueOnce({ success: false, error: { code: 'CAPITAL_UNAVAILABLE', message: 'internal server error' } })
      .mockResolvedValueOnce({ success: true, data: [colones(-19_670), dolares(0)] });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByText('No pudimos leer el capital propio.')).toBeInTheDocument();
    // Ni un cero, ni "sin faltante": no se sabe.
    expect(screen.queryByText('₡0.00')).toBeNull();
    expect(screen.queryByText('$0.00')).toBeNull();
    expect(screen.queryByText(/Sin faltante/)).toBeNull();
    // Y el texto crudo del servidor no llega a la pantalla.
    expect(screen.queryByText('internal server error')).toBeNull();

    await user.click(screen.getByRole('button', { name: /reintentar|retry/i }));
    await waitFor(() => expect(mocks.capitalPropio).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Faltan ₡196.70/)).toBeInTheDocument();
    expect(screen.queryByText('No pudimos leer el capital propio.')).toBeNull();
  });

  it('si el libro no trae ninguna cuenta, lo dice en vez de pintar ceros', async () => {
    mocks.capitalPropio.mockResolvedValue({ success: true, data: [] });
    pintar();

    expect(await screen.findByText('El libro contable no tiene cuentas de capital propio.')).toBeInTheDocument();
    expect(screen.queryByText('₡0.00')).toBeNull();
  });

  it('explica que el capital negativo no frena las operaciones', async () => {
    mocks.capitalPropio.mockResolvedValue({ success: true, data: [colones(-19_670)] });
    pintar();

    expect(await screen.findByText(/las operaciones siguen funcionando/i)).toBeInTheDocument();
  });
});
