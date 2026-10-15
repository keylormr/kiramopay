import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BusinessHomeView } from '../BusinessHomeView';
import type { QRMerchant } from '@/api/repositories/qrpayment.repository';

// La llave del retiro del saldo del negocio. Se armaba con la hora de cada
// toque, asi que cada reintento llevaba una llave nueva: si la red se cortaba
// despues de que el retiro salio, volver a tocar "Retirar" lo hacia otra vez.
const mocks = vi.hoisted(() => ({ withdrawMerchant: vi.fn() }));

vi.mock('@/api', () => ({
  getApiLayer: () => ({
    qrPayments: {
      getMerchantBalance: vi.fn().mockResolvedValue({ success: true, data: 777 }),
      getCatalog: vi.fn().mockResolvedValue({ success: true, data: [] }),
      getLocations: vi.fn().mockResolvedValue({ success: true, data: [] }),
      withdrawMerchant: mocks.withdrawMerchant,
    },
  }),
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: { accounts: [{ ccy: 'CRC', symbol: '₡', balance: 0 }], baseCurrency: 'CRC' },
    dispatch: vi.fn(),
  }),
}));

const COMERCIO = {
  id: 'm1', name: 'Soda', description: '', category: 'food', qrCode: 'MRC-1',
  active: true, cedula: '3101', cedulaType: 'juridica', legalName: 'Soda SA',
  verificationStatus: 'verified', commissionBps: 50, role: 'owner',
} as unknown as QRMerchant;

const sinRed = { success: false, error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' } };
const llaves = () => mocks.withdrawMerchant.mock.calls.map((c) => c[3] as string);

function pintar() {
  return render(
    <LanguageProvider>
      <BusinessHomeView merchant={COMERCIO} payments={[]} onReload={vi.fn()} />
    </LanguageProvider>,
  );
}

// Abre la hoja de retiro (cuando el saldo ya cargo) y escribe el monto.
async function abrirRetiro(user: ReturnType<typeof userEvent.setup>, monto: string) {
  const boton = await screen.findByRole('button', { name: /Retirar a mi cuenta/ });
  await waitFor(() => expect(boton).toBeEnabled());
  await user.click(boton);
  const hoja = within(await screen.findByRole('dialog'));
  const campo = hoja.getByPlaceholderText('0.00');
  await user.clear(campo);
  await user.type(campo, monto);
  return hoja;
}

const retirar = (user: ReturnType<typeof userEvent.setup>, hoja: ReturnType<typeof within>) =>
  user.click(hoja.getByRole('button', { name: /Retirar a mi cuenta/ }));

// La persona no reintenta en el mismo milisegundo.
const unMomento = () => new Promise((r) => setTimeout(r, 5));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.withdrawMerchant.mockReset();
});

describe('BusinessHomeView — la llave del retiro', () => {
  it('tras un corte de red, reintentar el mismo retiro lleva la misma llave', async () => {
    mocks.withdrawMerchant.mockResolvedValueOnce(sinRed).mockResolvedValueOnce({ success: true });
    const user = userEvent.setup();
    pintar();

    const hoja = await abrirRetiro(user, '300');
    await retirar(user, hoja);
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(1));
    await unMomento();
    await retirar(user, hoja);
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(primera).toMatch(/\S/);
    expect(segunda).toBe(primera);
  });

  it('tras un corte de red, cerrar la hoja y retirar lo mismo lleva la misma llave', async () => {
    mocks.withdrawMerchant.mockResolvedValueOnce(sinRed).mockResolvedValueOnce({ success: true });
    const user = userEvent.setup();
    pintar();

    const hoja = await abrirRetiro(user, '300');
    await retirar(user, hoja);
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(1));
    await user.click(hoja.getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await unMomento();
    await retirar(user, await abrirRetiro(user, '300'));
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(primera).toMatch(/\S/);
    expect(segunda).toBe(primera);
  });

  // La promesa vale para el reintento de ahora: la llave se olvida al cerrar
  // sesión, y la sesión se cierra sola tras un rato sin uso. Y remite a las
  // transacciones de la cuenta personal, que es donde llega el retiro: los
  // movimientos del negocio solo traen los cobros, y en el modo negocio no hay
  // lista de transacciones.
  it('un corte de red avisa que reintentar ahora no retira dos veces, y que más tarde conviene revisar', async () => {
    mocks.withdrawMerchant.mockResolvedValue(sinRed);
    const user = userEvent.setup();
    pintar();

    await retirar(user, await abrirRetiro(user, '300'));

    expect(await screen.findByText(/No pudimos confirmar el retiro/)).toBeInTheDocument();
    expect(screen.getByText(/Si lo intentas de nuevo ahora con el mismo monto, no se retirará dos veces/)).toBeInTheDocument();
    expect(
      screen.getByText(/Si lo intentas más tarde, revisa antes las transacciones de tu cuenta personal/),
    ).toBeInTheDocument();
  });

  it('otro monto es otro retiro y lleva otra llave', async () => {
    mocks.withdrawMerchant.mockResolvedValueOnce(sinRed).mockResolvedValueOnce({ success: true });
    const user = userEvent.setup();
    pintar();

    const hoja = await abrirRetiro(user, '300');
    await retirar(user, hoja);
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(1));
    const campo = hoja.getByPlaceholderText('0.00');
    await user.clear(campo);
    await user.type(campo, '200');
    await retirar(user, hoja);
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(segunda).not.toBe(primera);
  });

  it('la llave de otro retiro lo explica y el siguiente intento lleva otra llave', async () => {
    mocks.withdrawMerchant
      .mockResolvedValueOnce({
        success: false,
        error: { code: 'LLAVE_REUTILIZADA', message: 'idempotency key reused for a different movement' },
      })
      .mockResolvedValueOnce({ success: true });
    const user = userEvent.setup();
    pintar();

    const hoja = await abrirRetiro(user, '300');
    await retirar(user, hoja);
    expect(
      await screen.findByText(/ya se hizo con otros datos\. Revisa tus transacciones antes de intentar de nuevo/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/idempotency key reused/)).toBeNull();

    await retirar(user, hoja);
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(2));
    const [primera, segunda] = llaves();
    expect(segunda).not.toBe(primera);
  });

  // Ir a Reportes, Movimientos o Ajustes desmonta el inicio del negocio, y
  // bloquear la app o recargarla tambien. La llave vivia en la pantalla: volver
  // y retirar lo mismo llevaba otra, y el texto acababa de prometer que no se
  // retiraria dos veces.
  it('tras un corte de red, salir del inicio y volver a retirar lo mismo lleva la misma llave', async () => {
    mocks.withdrawMerchant.mockResolvedValueOnce(sinRed).mockResolvedValueOnce({ success: true, data: { repetida: false } });
    const user = userEvent.setup();
    const pantalla = pintar();

    await retirar(user, await abrirRetiro(user, '300'));
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(1));
    pantalla.unmount();
    await unMomento();
    pintar();
    await retirar(user, await abrirRetiro(user, '300'));
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(primera).toMatch(/\S/);
    expect(segunda).toBe(primera);
  });

  // El servidor contesto con un retiro que YA estaba hecho bajo esa llave: el
  // reintento tras un corte, o un segundo retiro igual hecho a proposito con la
  // llave que la pantalla conservaba. Se dice, y la llave se suelta para que el
  // siguiente si sea otro retiro.
  it('si el retiro ya se habia hecho, lo dice y el siguiente lleva otra llave', async () => {
    mocks.withdrawMerchant
      .mockResolvedValueOnce(sinRed)
      .mockResolvedValueOnce({ success: true, data: { repetida: true } })
      .mockResolvedValueOnce({ success: true, data: { repetida: false } });
    const user = userEvent.setup();
    pintar();

    const hoja = await abrirRetiro(user, '300');
    await retirar(user, hoja);
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(1));
    await unMomento();
    await retirar(user, hoja);

    expect(await screen.findByText(/Ese retiro ya se había hecho/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await unMomento();
    await retirar(user, await abrirRetiro(user, '300'));
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(3));

    const [, segunda, tercera] = llaves();
    expect(segunda).toMatch(/\S/);
    expect(tercera).not.toBe(segunda);
  });

  it('despues de un retiro que salio, el siguiente lleva otra llave', async () => {
    mocks.withdrawMerchant.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    pintar();

    await retirar(user, await abrirRetiro(user, '300'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await retirar(user, await abrirRetiro(user, '300'));
    await waitFor(() => expect(mocks.withdrawMerchant).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(segunda).not.toBe(primera);
  });
});
