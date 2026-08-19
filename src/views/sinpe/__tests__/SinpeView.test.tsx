import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { encodeContactQr } from '@/utils/contactQr';
import { SinpeView } from '../SinpeView';

const mocks = vi.hoisted(() => ({
  api: { sinpe: { send: vi.fn() }, mfa: { totpVerify: vi.fn() } },
  dispatch: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: {
      accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
      sinpeContacts: [],
      sinpeHistory: [],
      user: { phone: '+506 8888-0000' },
    },
    dispatch: mocks.dispatch,
  }),
}));

function setup() {
  return render(
    <LanguageProvider>
      <SinpeView />
    </LanguageProvider>,
  );
}

const sentTx = {
  id: 'tx1',
  name: 'Acme',
  amount: 5000,
  phone: '88887777',
  type: 'sent',
  status: 'completed',
  date: 'Ahora',
  reference: '',
};

async function openSendSheetAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole('button', { name: 'Enviar' })[0]); // header CTA
  const dialog = await screen.findByRole('dialog');
  const d = within(dialog);
  await user.type(d.getByPlaceholderText('8888-0000'), '88887777');
  await user.type(d.getByPlaceholderText('0'), '5000');
  await user.click(d.getByRole('button', { name: /Enviar/ })); // opens the review sheet
  // Review-before-send: confirm the transfer in the confirmation sheet.
  const sheets = await screen.findAllByRole('dialog');
  await user.click(within(sheets[sheets.length - 1]).getByRole('button', { name: /Enviar/ }));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  mocks.api.sinpe.send.mockReset();
  mocks.api.mfa.totpVerify.mockReset();
  mocks.dispatch.mockReset();
  // jsdom no tiene cámara. Una promesa que nunca resuelve deja el escáner en su
  // estado inicial sin actualizaciones de estado fuera de act().
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: () => new Promise(() => {}) },
    configurable: true,
  });
});

describe('SinpeView — send', () => {
  it('sends through the API and shows the success sheet', async () => {
    mocks.api.sinpe.send.mockResolvedValue({ success: true, data: sentTx });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    await waitFor(() =>
      expect(mocks.api.sinpe.send).toHaveBeenCalledWith({
        phone: '88887777',
        amount: 5000,
        description: '',
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByText('¡Enviado!')).toBeInTheDocument();
    expect(mocks.dispatch).toHaveBeenCalled();
  });

  it('prompts for MFA on MFA_REQUIRED and retries the transfer after verify', async () => {
    mocks.api.sinpe.send
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } })
      .mockResolvedValueOnce({ success: true, data: sentTx });
    mocks.api.mfa.totpVerify.mockResolvedValue({ success: true, data: { verified: true } });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    // The challenge appears instead of completing/erroring.
    expect(await screen.findByText('Verificación requerida')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByText('Verificar y activar'));

    await waitFor(() => {
      expect(mocks.api.mfa.totpVerify).toHaveBeenCalledWith('123456', 'high_value_tx');
      expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('¡Enviado!')).toBeInTheDocument();
  });

  // El envío a un número que NO es de KiramoPay se debita pero NO se entrega:
  // el riel a otros bancos sigue pendiente de licencia. Mostrarlo como "enviado"
  // hace que alguien crea que su amigo recibió la plata. El backend lo marca con
  // internal:false y status pending; la vista TIENE que reflejarlo.
  //
  // Este caso existe porque el aviso ya estaba escrito pero era código muerto:
  // la vista rearmaba la transacción campo por campo y se dejaba `internal`
  // afuera, así que la condición comparaba `undefined === false` y siempre caía
  // en la rama verde de éxito.
  it('avisa que la entrega queda pendiente cuando el destinatario no es usuario', async () => {
    mocks.api.sinpe.send.mockResolvedValue({
      success: true,
      data: { ...sentTx, status: 'pending', internal: false },
    });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    expect(await screen.findByText('Envío en proceso')).toBeInTheDocument();
    expect(screen.getByText(/no pertenece a KiramoPay/)).toBeInTheDocument();
    // Y NO puede decir que se envió.
    expect(screen.queryByText('¡Enviado!')).not.toBeInTheDocument();
  });

  // El backend rechaza los envios a numeros sin cuenta: entregarlos exigiria el
  // riel a otros bancos, que no esta licenciado. El mensaje debe explicarlo en
  // el idioma del usuario, no devolver la cadena en ingles del servidor.
  it('explica en español que el número no tiene cuenta', async () => {
    mocks.api.sinpe.send.mockResolvedValue({
      success: false,
      error: { code: 'RECIPIENT_NOT_USER', message: 'recipient is not a KiramoPay user' },
    });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    expect(await screen.findByText(/no tiene cuenta en KiramoPay/)).toBeInTheDocument();
    // Y no puede filtrarse el texto crudo del backend.
    expect(screen.queryByText(/recipient is not a KiramoPay user/)).not.toBeInTheDocument();
  });

  it('mantiene el mensaje de éxito cuando el destinatario sí es usuario', async () => {
    mocks.api.sinpe.send.mockResolvedValue({
      success: true,
      data: { ...sentTx, internal: true },
    });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    expect(await screen.findByText('¡Enviado!')).toBeInTheDocument();
    expect(screen.queryByText('Envío en proceso')).not.toBeInTheDocument();
  });
});

// El usuario pidió varias veces poder agregar un contacto ESCANEANDO: la hoja
// solo dejaba escribir. El escaneo ya existía —se genera el QR propio en
// "Recibir" y se lee desde Inicio—, pero no había camino desde el momento en
// que uno quiere agregar a alguien. Estas pruebas ejercitan ese camino por el
// respaldo manual del escáner, que recibe el mismo texto crudo que la cámara.
describe('SinpeView — agregar contacto escaneando', () => {
  async function abrirEscaner(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /Escanear código QR/ }));
    return within(await screen.findByRole('dialog'));
  }

  function leerCodigo(d: ReturnType<typeof within>, raw: string) {
    // fireEvent en vez de user.type: el contenido del QR es JSON y las llaves
    // son caracteres de control para userEvent.
    fireEvent.change(d.getByPlaceholderText('Código QR'), { target: { value: raw } });
    fireEvent.click(d.getByRole('button', { name: 'Continuar' }));
  }

  it('rellena el formulario con los datos del QR y guarda el contacto', async () => {
    const user = userEvent.setup();
    setup();

    const d = await abrirEscaner(user);
    leerCodigo(d, encodeContactQr({ name: 'Ana Solís', phone: '+506 8888-7777', bank: 'BAC' }));

    // Vuelve al formulario con los campos puestos y avisa que hay que revisar.
    expect(await screen.findByText(/Datos tomados del QR/)).toBeInTheDocument();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByPlaceholderText('Ej: Juan Pérez')).toHaveValue('Ana Solís');
    // El campo guarda los 8 dígitos; el guion lo pone el formato al guardar.
    expect(dialog.getByPlaceholderText('8888-0000')).toHaveValue('88887777');

    await user.click(dialog.getByRole('button', { name: /Guardar contacto/ }));

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'ADD_SINPE_CONTACT',
      payload: expect.objectContaining({
        name: 'Ana Solís',
        phone: '8888-7777',
        bank: 'BAC',
      }),
    });
  });

  // Un QR de pago, o cualquier texto suelto, no puede cerrar el escáner ni
  // llenar el formulario con basura: se avisa y se sigue escaneando.
  it('rechaza un código que no es un contacto y no toca el formulario', async () => {
    const user = userEvent.setup();
    setup();

    const d = await abrirEscaner(user);
    leerCodigo(d, JSON.stringify({ type: 'merchant_fixed', amount: 5000 }));

    expect(await screen.findByText(/no es un QR de contacto/)).toBeInTheDocument();
    // Sigue en el escáner: el campo del formulario ni aparece.
    expect(screen.queryByPlaceholderText('Ej: Juan Pérez')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  // Escanear es una alternativa, no un reemplazo: el usuario fue explícito en
  // que el formulario manual se queda.
  it('conserva el formulario manual como alternativa', async () => {
    const user = userEvent.setup();
    setup();

    // El "+" de favoritos y el botón del estado vacío comparten etiqueta.
    await user.click(screen.getAllByRole('button', { name: 'Agregar contacto' })[0]);
    const dialog = within(await screen.findByRole('dialog'));

    expect(dialog.getByPlaceholderText('Ej: Juan Pérez')).toBeInTheDocument();
    // Y desde ahí también se puede pasar a escanear.
    expect(dialog.getByRole('button', { name: /Escanear código QR/ })).toBeInTheDocument();
  });
});

