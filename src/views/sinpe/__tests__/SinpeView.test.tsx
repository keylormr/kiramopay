import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { encodeContactQr } from '@/utils/contactQr';
import { llaveDelIntento } from '@/services/intentoPendiente';
import { SinpeView } from '../SinpeView';

const mocks = vi.hoisted(() => ({
  api: { sinpe: { send: vi.fn() }, mfa: { totpVerify: vi.fn() } },
  dispatch: vi.fn(),
  dataSync: {
    refreshAccounts: vi.fn(() => Promise.resolve(true)),
    refreshSinpe: vi.fn(() => Promise.resolve()),
    refreshTransactions: vi.fn(() => Promise.resolve()),
  },
  // Mutable a propósito: algunas pruebas necesitan contactos ya guardados
  // (para ejercitar la detección de duplicados) sin reescribir el mock entero.
  state: {
    accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
    sinpeContacts: [] as Array<{ id: string; name: string; phone: string; bank?: string; isFavorite?: boolean }>,
    sinpeHistory: [] as unknown[],
    user: { phone: '+506 8888-0000' } as { id?: string; phone: string },
  },
}));

vi.mock('@/api', () => ({
  getApiLayer: () => mocks.api,
  MFA_REQUIRED: 'MFA_REQUIRED',
}));

vi.mock('@/hooks/useApp', () => ({
  useApp: () => ({
    state: mocks.state,
    dispatch: mocks.dispatch,
  }),
}));

vi.mock('@/services/dataSync', () => mocks.dataSync);

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
  mocks.dataSync.refreshAccounts.mockClear();
  mocks.dataSync.refreshSinpe.mockClear();
  mocks.dataSync.refreshTransactions.mockClear();
  mocks.state.sinpeContacts = [];
  mocks.state.user = { phone: '+506 8888-0000' };
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
        // La entrada manual son 8 digitos; al backend SIEMPRE viaja el
        // formato +506XXXXXXXX. Mandar los digitos pelados era un 400 seguro.
        phone: '+50688887777',
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
    // No "Verificar y activar" (ese texto es para ACTIVAR 2FA en Perfil, y
    // aquí confundía sobre qué se está autorizando: este reto es para ESTE
    // envío puntual).
    await user.click(screen.getByText('Verificar y enviar'));

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

  // El backend rechaza el numero con su propio codigo (INVALID_PHONE) para
  // que la vista lo traduzca, en vez del "invalid SINPE Móvil phone number"
  // en ingles que se filtraba antes tal cual a la pantalla en español.
  it('traduce el rechazo del servidor por teléfono inválido', async () => {
    mocks.api.sinpe.send.mockResolvedValue({
      success: false,
      error: { code: 'INVALID_PHONE', message: 'invalid SINPE Móvil phone number' },
    });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    // El servidor solo lo rechaza por esto cuando el número tiene sus 8 dígitos
    // pero no es un celular: "debe tener 8 dígitos" le hablaba de otra cosa.
    expect(await screen.findByText('Revisa el número: debe ser un celular de 8 dígitos')).toBeInTheDocument();
    expect(screen.queryByText(/invalid SINPE Móvil phone number/)).not.toBeInTheDocument();
  });

  // Cada rechazo del envío llega con su código y se dice en el idioma de la
  // persona. El texto del servidor es para quien integra la API: está en
  // inglés y arrastra los prefijos internos ("create transaction: ...").
  it.each([
    ['INSUFFICIENT_BALANCE', 'insufficient balance', 'Fondos insuficientes'],
    [
      'SINGLE_PAYMENT_LIMIT_EXCEEDED',
      'amount exceeds single-payment ceiling',
      'Ese monto supera el máximo por envío SINPE.',
    ],
    [
      'SINPE_DAILY_LIMIT_EXCEEDED',
      'SINPE daily limit exceeded',
      'Con este envío superarías tu límite diario de SINPE.',
    ],
    [
      'DAILY_LIMIT_EXCEEDED',
      'daily spending limit exceeded',
      'Este envío supera tu límite diario.',
    ],
    [
      'MONTHLY_LIMIT_EXCEEDED',
      'monthly spending limit exceeded',
      'Este envío supera tu límite mensual.',
    ],
    // El 500: el servidor fallo y el envio pudo haber salido (un commit que se
    // corta). La llave se conserva, asi que reintentar ahora no lo manda dos
    // veces: es lo que dice el texto del envio sin confirmar.
    ['SINPE_FAILED', 'internal server error', /^No pudimos confirmar el envío/],
    // El motor de riesgo, como cualquier codigo que la pantalla no conoce.
    [
      'TRANSFER_BLOCKED',
      'this transaction was blocked by the risk engine',
      'No se pudo hacer el envío. Intenta de nuevo.',
    ],
  ])('traduce el rechazo %s y no muestra el texto del servidor', async (code, message, texto) => {
    mocks.api.sinpe.send.mockResolvedValue({ success: false, error: { code, message } });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    expect(await screen.findByText(texto)).toBeInTheDocument();
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  });

  // Un monto de ₡0 dejaba la hoja de confirmar "muerta": el botón de enviar
  // nunca se deshabilitaba y tocar "Enviar" ahí adentro no hacía nada, sin
  // ningún aviso.
  it('deshabilita el botón de enviar con un monto de ₡0', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getAllByRole('button', { name: 'Enviar' })[0]);
    const dialog = await screen.findByRole('dialog');
    const d = within(dialog);
    await user.type(d.getByPlaceholderText('8888-0000'), '88887777');
    await user.type(d.getByPlaceholderText('0'), '0');

    expect(d.getByRole('button', { name: /Enviar/ })).toBeDisabled();
    expect(mocks.api.sinpe.send).not.toHaveBeenCalled();
  });

  // El "+506" que se muestra junto al campo es solo un rótulo decorativo:
  // si el usuario lo teclea dentro del campo, el recorte se quedaba con los
  // PRIMEROS 8 dígitos ("50688880") en vez de los últimos, armando un
  // número que no era el que la persona quiso escribir.
  it('usa los últimos 8 dígitos cuando el usuario teclea el +506 a mano', async () => {
    mocks.api.sinpe.send.mockResolvedValue({ success: true, data: sentTx });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getAllByRole('button', { name: 'Enviar' })[0]);
    const dialog = await screen.findByRole('dialog');
    const d = within(dialog);
    await user.type(d.getByPlaceholderText('8888-0000'), '+50688880005');
    await user.type(d.getByPlaceholderText('0'), '100');
    await user.click(d.getByRole('button', { name: /Enviar/ }));
    const sheets = await screen.findAllByRole('dialog');
    await user.click(within(sheets[sheets.length - 1]).getByRole('button', { name: /Enviar/ }));

    await waitFor(() =>
      expect(mocks.api.sinpe.send).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+50688880005' }),
      ),
    );
  });

  // Bug real: el recorte corría en cada tecla con .slice(-8) sin límite de
  // longitud. Si el número ya tenía sus 8 dígitos correctos y se colaba una
  // tecla de más, el primer dígito se caía y el campo quedaba con OTRO
  // número de 8 dígitos igual de válido en apariencia, sin ningún aviso.
  it('una tecla de más después de completar el número no lo cambia por otro', async () => {
    mocks.api.sinpe.send.mockResolvedValue({ success: true, data: sentTx });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getAllByRole('button', { name: 'Enviar' })[0]);
    const dialog = await screen.findByRole('dialog');
    const d = within(dialog);
    const campoTelefono = d.getByPlaceholderText('8888-0000');
    await user.type(campoTelefono, '60000001');
    expect(campoTelefono).toHaveValue('60000001');
    // Tecla de más, sin seleccionar ni borrar nada primero.
    await user.type(campoTelefono, '9');
    expect(campoTelefono).toHaveValue('60000001');

    await user.type(d.getByPlaceholderText('0'), '100');
    await user.click(d.getByRole('button', { name: /Enviar/ }));
    const sheets = await screen.findAllByRole('dialog');
    await user.click(within(sheets[sheets.length - 1]).getByRole('button', { name: /Enviar/ }));

    await waitFor(() =>
      expect(mocks.api.sinpe.send).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+50660000001' }),
      ),
    );
  });

  // Los botones de "Montos rápidos" armaban el texto con
  // formatCurrency(val).replace(',00', ''): String.replace sin regex global
  // borra la PRIMERA coincidencia, que en "₡5,000.00" es la coma de miles,
  // no los centavos -- el botón terminaba diciendo "₡5.00" (mil veces menos
  // que el monto real que sí se manda al tocar el botón).
  it('muestra el monto real en los botones de montos rápidos', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getAllByRole('button', { name: 'Enviar' })[0]);
    const dialog = await screen.findByRole('dialog');
    const d = within(dialog);

    expect(d.getByRole('button', { name: '₡5,000' })).toBeInTheDocument();
    expect(d.getByRole('button', { name: '₡10,000' })).toBeInTheDocument();
    expect(d.getByRole('button', { name: '₡25,000' })).toBeInTheDocument();
    expect(d.getByRole('button', { name: '₡50,000' })).toBeInTheDocument();
    // Ninguno quedó recortado como "₡5.00" / "₡50.00".
    expect(d.queryByText('₡5.00')).not.toBeInTheDocument();
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
        // Formato canónico del backend (+506XXXXXXXX), no el "8888-7777"
        // armado a mano que el servidor rechazaba con 400.
        phone: '+50688887777',
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

  // El mismo bug del "+506" tecleado a mano (ver la prueba equivalente en
  // "SinpeView — send") también vivía en este formulario: el recorte se
  // quedaba con los PRIMEROS 8 dígitos en vez de los últimos.
  it('usa los últimos 8 dígitos al guardar un contacto con el +506 tecleado a mano', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getAllByRole('button', { name: 'Agregar contacto' })[0]);
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByPlaceholderText('Ej: Juan Pérez'), 'Ana Solís');
    await user.type(dialog.getByPlaceholderText('8888-0000'), '+50688880005');
    await user.click(dialog.getByRole('button', { name: /Guardar contacto/ }));

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'ADD_SINPE_CONTACT',
      payload: expect.objectContaining({ name: 'Ana Solís', phone: '+50688880005' }),
    });
  });

  // Aquí el bug era más grave que en "Enviar": no hay hoja de revisión antes
  // de guardar, así que un número corrido por una tecla de más se guardaba
  // TAL CUAL, sin que nadie lo notara hasta el primer envío fallido.
  it('una tecla de más al agregar un contacto no cambia el número por otro', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getAllByRole('button', { name: 'Agregar contacto' })[0]);
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByPlaceholderText('Ej: Juan Pérez'), 'Ana Solís');
    const campoTelefono = dialog.getByPlaceholderText('8888-0000');
    await user.type(campoTelefono, '600000019');
    expect(campoTelefono).toHaveValue('60000001');

    await user.click(dialog.getByRole('button', { name: /Guardar contacto/ }));

    expect(mocks.dispatch).toHaveBeenCalledWith({
      type: 'ADD_SINPE_CONTACT',
      payload: expect.objectContaining({ name: 'Ana Solís', phone: '+50660000001' }),
    });
  });
});

// Pedido del dueño: si el número escaneado o tecleado ya está guardado, o es
// el propio, avisar de inmediato en vez de dejar que el alta lo pise en
// silencio (el backend hacía un upsert que sobrescribía nombre y banco).
describe('SinpeView — contacto duplicado o número propio', () => {
  // El botón "Escanear QR" del encabezado está siempre presente (a diferencia
  // del CTA "Escanear código QR" del estado vacío, que desaparece en cuanto ya
  // hay contactos guardados — justo el caso que estas pruebas necesitan).
  async function abrirEscaner(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Escanear QR' }));
    return within(await screen.findByRole('dialog'));
  }

  function leerCodigo(d: ReturnType<typeof within>, raw: string) {
    fireEvent.change(d.getByPlaceholderText('Código QR'), { target: { value: raw } });
    fireEvent.click(d.getByRole('button', { name: 'Continuar' }));
  }

  it('avisa al escanear el QR de un contacto que ya está guardado, sin abrir el formulario de alta', async () => {
    mocks.state.sinpeContacts = [{ id: 'c1', name: 'Diego Mora', phone: '8888-7777', bank: 'BAC' }];
    const user = userEvent.setup();
    setup();

    const d = await abrirEscaner(user);
    // El QR trae otro nombre/banco a propósito: lo que se muestra es el
    // contacto YA guardado, no lo que traiga el código.
    leerCodigo(d, encodeContactQr({ name: 'Diego (alias)', phone: '+506 8888-7777', bank: 'BCR' }));

    expect(await screen.findByText(/Ya tienes este contacto guardado/)).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Diego Mora')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Ej: Juan Pérez')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('ofrece enviarle dinero desde el aviso de duplicado', async () => {
    mocks.state.sinpeContacts = [{ id: 'c1', name: 'Diego Mora', phone: '8888-7777', bank: 'BAC' }];
    const user = userEvent.setup();
    setup();

    const d = await abrirEscaner(user);
    leerCodigo(d, encodeContactQr({ name: 'Diego Mora', phone: '+506 8888-7777' }));
    await screen.findByText(/Ya tienes este contacto guardado/);

    await user.click(screen.getByRole('button', { name: 'Enviarle dinero' }));

    // Se cierra la hoja de alta y se abre la de envío con ese contacto.
    const sendDialog = within(await screen.findByRole('dialog'));
    expect(sendDialog.getByText('Diego Mora')).toBeInTheDocument();
  });

  it('avisa con un mensaje claro al escanear el propio QR y sigue escaneando', async () => {
    const user = userEvent.setup();
    setup();

    const d = await abrirEscaner(user);
    leerCodigo(d, encodeContactQr({ name: 'Yo Mismo', phone: '+506 8888-0000' }));

    expect(await screen.findByText(/no puedes agregarte como contacto/)).toBeInTheDocument();
    // No es un duplicado guardado ni un alta: el escáner sigue activo.
    expect(screen.queryByPlaceholderText('Ej: Juan Pérez')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('avisa el mismo duplicado al escribir manualmente un teléfono ya guardado', async () => {
    mocks.state.sinpeContacts = [{ id: 'c1', name: 'Diego Mora', phone: '8888-7777', bank: 'BAC' }];
    const user = userEvent.setup();
    setup();

    await user.click(screen.getAllByRole('button', { name: 'Agregar contacto' })[0]);
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByPlaceholderText('Ej: Juan Pérez'), 'Otro Nombre');
    await user.type(dialog.getByPlaceholderText('8888-0000'), '88887777');
    await user.click(dialog.getByRole('button', { name: /Guardar contacto/ }));

    expect(await screen.findByText(/Ya tienes este contacto guardado/)).toBeInTheDocument();
    expect(dialog.getByText('Diego Mora')).toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it('avisa mensaje claro al escribir manualmente el propio número', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(screen.getAllByRole('button', { name: 'Agregar contacto' })[0]);
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByPlaceholderText('Ej: Juan Pérez'), 'Yo');
    await user.type(dialog.getByPlaceholderText('8888-0000'), '88880000');
    await user.click(dialog.getByRole('button', { name: /Guardar contacto/ }));

    expect(await screen.findByText(/no puedes agregarte como contacto/)).toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
});

// El nombre de la contraparte compartía línea con el prefijo "Recibido
// de"/"Enviado a", que se comía buena parte del ancho frente al monto de la
// derecha y cortaba nombres relativamente cortos ("Emmanuel C...").
describe('SinpeView — historial', () => {
  it('muestra el nombre completo del contacto en su propia línea', async () => {
    mocks.state.sinpeHistory = [
      { ...sentTx, id: 'h1', type: 'received', name: 'Emmanuel Coto', phone: '+50688889999' },
    ];
    setup();

    fireEvent.click(screen.getByRole('button', { name: 'Historial' }));

    // El nombre completo aparece como su propio texto, no concatenado con
    // el prefijo "Recibido de " (que ahora vive en la línea chica de abajo).
    expect(await screen.findByText('Emmanuel Coto')).toBeInTheDocument();
    expect(screen.getByText(/Recibido/)).toBeInTheDocument();
    expect(screen.queryByText(/Recibido de Emmanuel Coto/)).not.toBeInTheDocument();
  });
});


// La llave del envío. La pantalla la manda para el caso de la red que se corta
// sin traer la respuesta: el envío pudo haber salido, y el reintento tiene que
// llevar la MISMA llave para que el servidor conteste con aquel envío en vez de
// hacer otro. Se soltaba ante cualquier error —y al cerrar la hoja—, así que
// reintentar tras un corte mandaba la plata dos veces.
describe('SinpeView — la llave del envío', () => {
  const sinRed = { success: false, error: { code: 'NETWORK_ERROR', message: 'Sin conexión.' } };
  const llaves = () => mocks.api.sinpe.send.mock.calls.map((c) => c[0].idempotencyKey as string);

  // Con la hoja de enviar todavía abierta y sus datos puestos, vuelve a pasar
  // por la revisión y confirma.
  async function confirmarDeNuevo(user: ReturnType<typeof userEvent.setup>) {
    const [hoja] = await screen.findAllByRole('dialog');
    await user.click(within(hoja).getByRole('button', { name: /Enviar/ }));
    const sheets = await screen.findAllByRole('dialog');
    await user.click(within(sheets[sheets.length - 1]).getByRole('button', { name: /Enviar/ }));
  }

  it('tras un corte de red, reintentar el mismo envío lleva la misma llave', async () => {
    mocks.api.sinpe.send.mockResolvedValueOnce(sinRed).mockResolvedValueOnce({ success: true, data: sentTx });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(1));
    await confirmarDeNuevo(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(primera).toMatch(/\S/);
    expect(segunda).toBe(primera);
  });

  it('tras un corte de red, cerrar la hoja y enviar lo mismo lleva la misma llave', async () => {
    mocks.api.sinpe.send.mockResolvedValueOnce(sinRed).mockResolvedValueOnce({ success: true, data: sentTx });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(1));
    const [hoja] = await screen.findAllByRole('dialog');
    await user.click(within(hoja).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
    await openSendSheetAndSubmit(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(primera).toMatch(/\S/);
    expect(segunda).toBe(primera);
  });

  // La promesa vale para el reintento de ahora: la llave se olvida al cerrar
  // sesión, y la sesión se cierra sola tras un rato sin uso. Más tarde lo
  // seguro es mirar los movimientos antes.
  it('un corte de red avisa que reintentar ahora no envía dos veces, y que más tarde conviene revisar', async () => {
    mocks.api.sinpe.send.mockResolvedValue(sinRed);
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);

    expect(await screen.findByText(/No pudimos confirmar el envío/)).toBeInTheDocument();
    expect(screen.getByText(/Si lo intentas de nuevo ahora con los mismos datos, no se enviará dos veces/)).toBeInTheDocument();
    // "Transacciones" es el nombre de la pantalla a la que manda.
    expect(screen.getByText(/Si lo intentas más tarde, revisa antes tus transacciones/)).toBeInTheDocument();
  });

  // Las tres entradas de SINPE —esta pantalla, el contacto escaneado del Inicio
  // y el asistente— le dan la misma llave al mismo envío: el ámbito 'sinpe' y
  // la firma teléfono con +506 y monto. Si una cambiara cualquiera de los dos,
  // el corte en una y el reintento en otra mandarían la plata dos veces.
  it('el mismo envío lleva la llave que le dieron las otras entradas de SINPE', async () => {
    mocks.state.user = { id: 'user-001', phone: '+506 8888-0000' };
    llaveDelIntento('user-001', 'sinpe', '+50688887777|5000', () => 'llave-de-otra-entrada');
    mocks.api.sinpe.send.mockResolvedValue({ success: true, data: sentTx });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(1));

    expect(llaves()).toEqual(['llave-de-otra-entrada']);
  });

  // El servidor pide el segundo factor antes de crear nada: cancelarlo deja
  // ese envío sin hacer y suelta su llave. Solo la suya: se soltaba la que
  // hubiera, y podía ser la de otro envío que seguía sin confirmar.
  it('cancelar el segundo factor suelta la llave de ese envío y no la de otro pendiente', async () => {
    mocks.state.user = { id: 'user-001', phone: '+506 8888-0000' };
    const otra = llaveDelIntento('user-001', 'sinpe', '+50677776666|1000', () => 'llave-de-otro-envio');
    mocks.api.sinpe.send.mockResolvedValue({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);
    const reto = (await screen.findByText('Verificación requerida')).closest('[role="dialog"]') as HTMLElement;
    await user.click(within(reto).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryByText('Verificación requerida')).not.toBeInTheDocument());

    expect(llaveDelIntento('user-001', 'sinpe', '+50677776666|1000', () => 'nueva')).toBe(otra);
    await confirmarDeNuevo(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(2));
    const [primera, segunda] = llaves();
    expect(segunda).not.toBe(primera);
  });

  it('corregir el monto tras un corte de red es otro envío y lleva otra llave', async () => {
    mocks.api.sinpe.send.mockResolvedValueOnce(sinRed).mockResolvedValueOnce({ success: true, data: sentTx });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(1));
    const [hoja] = await screen.findAllByRole('dialog');
    const monto = within(hoja).getByPlaceholderText('0');
    await user.clear(monto);
    await user.type(monto, '6000');
    await confirmarDeNuevo(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(segunda).not.toBe(primera);
  });

  it('la llave de otro envío lo explica y el siguiente intento lleva otra llave', async () => {
    mocks.api.sinpe.send
      .mockResolvedValueOnce({
        success: false,
        error: { code: 'LLAVE_REUTILIZADA', message: 'idempotency key reused for a different movement' },
      })
      .mockResolvedValueOnce({ success: true, data: sentTx });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);
    expect(
      await screen.findByText(/ya se hizo con otros datos\. Revisa tus transacciones antes de intentar de nuevo/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/idempotency key reused/)).not.toBeInTheDocument();

    await confirmarDeNuevo(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(2));
    const [primera, segunda] = llaves();
    expect(segunda).not.toBe(primera);
  });

  // Verificar el segundo factor reintenta el MISMO envío: la misma llave.
  it('el reintento tras verificar el segundo factor lleva la misma llave', async () => {
    mocks.api.sinpe.send
      .mockResolvedValueOnce({ success: false, error: { code: 'MFA_REQUIRED', message: 'mfa needed' } })
      .mockResolvedValueOnce({ success: true, data: sentTx });
    mocks.api.mfa.totpVerify.mockResolvedValue({ success: true, data: { verified: true } });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);
    expect(await screen.findByText('Verificación requerida')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('000000'), '123456');
    await user.click(screen.getByText('Verificar y enviar'));
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(primera).toMatch(/\S/);
    expect(segunda).toBe(primera);
  });

  // Cambiar de pestaña desmonta la pantalla, y bloquear la app o recargarla
  // también. La llave vivía en la pantalla: volver a SINPE y enviar lo mismo
  // llevaba otra, y el texto acababa de prometer que no se enviaría dos veces.
  it('tras un corte de red, salir de SINPE y volver a enviar lo mismo lleva la misma llave', async () => {
    mocks.api.sinpe.send.mockResolvedValueOnce(sinRed).mockResolvedValueOnce({ success: true, data: sentTx });
    const user = userEvent.setup();
    const pantalla = setup();

    await openSendSheetAndSubmit(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(1));
    pantalla.unmount();
    setup();
    await openSendSheetAndSubmit(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(primera).toMatch(/\S/);
    expect(segunda).toBe(primera);
  });

  // La repetición: el servidor contestó con un envío que YA estaba hecho bajo
  // esa llave. Puede ser el reintento tras un corte, o un segundo envío igual
  // hecho a propósito con la llave que la pantalla conservaba. No es un envío
  // nuevo: no se celebra ni se anota —sería la fila doble y el saldo contado
  // dos veces—, se dice, y la llave se suelta para que el siguiente sí lo sea.
  it('si el envío ya se había hecho, lo dice, no lo anota otra vez y el siguiente lleva otra llave', async () => {
    mocks.api.sinpe.send
      .mockResolvedValueOnce(sinRed)
      .mockResolvedValueOnce({ success: true, data: { ...sentTx, repetida: true } })
      .mockResolvedValueOnce({ success: true, data: sentTx });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(1));
    await confirmarDeNuevo(user);

    const titulo = await screen.findByText(/Ese envío ya se había hecho/);
    expect(screen.getByText(/No se envió otra vez/)).toBeInTheDocument();
    expect(screen.queryByText('¡Enviado!')).not.toBeInTheDocument();
    expect(mocks.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ADD_SINPE_TRANSACTION' }));
    // La app no se había enterado del envío: trae del servidor el saldo, los
    // movimientos y el historial SINPE.
    expect(mocks.dataSync.refreshAccounts).toHaveBeenCalled();
    expect(mocks.dataSync.refreshTransactions).toHaveBeenCalled();
    expect(mocks.dataSync.refreshSinpe).toHaveBeenCalled();

    const aviso = titulo.closest('[role="dialog"]') as HTMLElement;
    await user.click(within(aviso).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
    await openSendSheetAndSubmit(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(3));

    const [, segunda, tercera] = llaves();
    expect(segunda).toMatch(/\S/);
    expect(tercera).not.toBe(segunda);
  });

  it('después de un envío que salió, el siguiente lleva otra llave', async () => {
    mocks.api.sinpe.send.mockResolvedValue({ success: true, data: sentTx });
    const user = userEvent.setup();
    setup();

    await openSendSheetAndSubmit(user);
    const exito = (await screen.findByText('¡Enviado!')).closest('[role="dialog"]') as HTMLElement;
    await user.click(within(exito).getByRole('button', { name: 'Cerrar' }));
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0));
    await openSendSheetAndSubmit(user);
    await waitFor(() => expect(mocks.api.sinpe.send).toHaveBeenCalledTimes(2));

    const [primera, segunda] = llaves();
    expect(segunda).not.toBe(primera);
  });
});
