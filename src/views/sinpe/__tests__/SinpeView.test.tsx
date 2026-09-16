import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { encodeContactQr } from '@/utils/contactQr';
import { SinpeView } from '../SinpeView';

const mocks = vi.hoisted(() => ({
  api: { sinpe: { send: vi.fn() }, mfa: { totpVerify: vi.fn() } },
  dispatch: vi.fn(),
  // Mutable a propósito: algunas pruebas necesitan contactos ya guardados
  // (para ejercitar la detección de duplicados) sin reescribir el mock entero.
  state: {
    accounts: [{ ccy: 'CRC', balance: 1_000_000 }],
    sinpeContacts: [] as Array<{ id: string; name: string; phone: string; bank?: string; isFavorite?: boolean }>,
    sinpeHistory: [] as unknown[],
    user: { phone: '+506 8888-0000' },
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

    expect(await screen.findByText('Revisa el número: debe tener 8 dígitos')).toBeInTheDocument();
    expect(screen.queryByText(/invalid SINPE Móvil phone number/)).not.toBeInTheDocument();
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

