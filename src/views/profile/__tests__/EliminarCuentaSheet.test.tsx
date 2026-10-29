import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { EliminarCuentaSheet } from '../EliminarCuentaSheet';

// La hoja de eliminar la cuenta: el plazo de 30 dias, lo que se borra ese dia y lo
// que se conserva por ley, lo que hay que resolver antes, y una confirmacion que
// pide la palabra, la contrasena, la aceptacion expresa del plazo y, si lo tiene,
// el codigo del autenticador. El servidor reautentica; aqui se prueba que la
// pantalla no deja enviar sin lo necesario y que dice el motivo por codigo.

const api = vi.hoisted(() => ({
  auth: { deletionPreflight: vi.fn(), deleteAccount: vi.fn() },
}));

vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApiLayer: () => api,
}));

// El store entero arrastra el registro de avisos nativos (un plugin de
// Capacitor); la hoja solo necesita la accion que suelta la sesion local.
const cuentaEliminada = vi.hoisted(() => vi.fn());
vi.mock('@/stores/auth.store', () => ({
  useAuthStore: { getState: () => ({ cuentaEliminada }) },
}));

const abrirPublico = vi.hoisted(() => vi.fn());
vi.mock('@/utils/enlacesLegales', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  abrirPublico,
}));

const limpia = { elegible: true, bloqueos: [] as string[], pideSegundoFactor: false };
const pedida = { yaPedida: false, solicitadaEn: '2026-10-18T15:00:00Z', seEliminaEl: '2026-11-17T15:00:00Z' };
const BOTON = 'Pedir la eliminación';

const pintar = (onClose = vi.fn()) => {
  render(
    <LanguageProvider>
      <EliminarCuentaSheet isOpen onClose={onClose} />
    </LanguageProvider>,
  );
  return onClose;
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  api.auth.deletionPreflight.mockReset();
  api.auth.deleteAccount.mockReset();
  abrirPublico.mockReset();
  cuentaEliminada.mockReset();
});
afterEach(cleanup);

async function llegarALaConfirmacion(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Continuar' }));
}

// La palabra, la contrasena y la aceptacion del plazo.
async function completar(user: ReturnType<typeof userEvent.setup>, clave = 'Clave-123') {
  await user.type(screen.getByLabelText('Escribe ELIMINAR para confirmar'), 'ELIMINAR');
  await user.type(screen.getByLabelText('Contraseña actual'), clave);
  await user.click(screen.getByRole('checkbox', { name: /Acepto el plazo/ }));
}

describe('EliminarCuentaSheet — revision previa', () => {
  it('con la cuenta limpia explica el plazo, que se borra y que se conserva, y enlaza la politica', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByText('Vas a eliminar tu cuenta')).toBeInTheDocument();
    // El plazo: bloqueada desde hoy, eliminada en 30 dias, reactivable antes.
    expect(screen.getByText(/bloqueada desde hoy/)).toHaveTextContent(/30 días/);
    expect(screen.getByText(/bloqueada desde hoy/)).toHaveTextContent(/reactivarla/);
    expect(screen.getByRole('heading', { name: 'El día 30 se borra' })).toBeInTheDocument();
    expect(screen.getByText(/contactos/)).toBeInTheDocument();
    expect(screen.getByText(/conversaciones con el asistente/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Se conserva por ley' })).toBeInTheDocument();
    expect(screen.getByText(/Ley 7786/)).toBeInTheDocument();
    expect(screen.getByText(/PRODHAB/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Leer la política de privacidad' }));
    expect(abrirPublico).toHaveBeenCalledWith('/privacidad');
  });

  it('cada bloqueo se explica en el idioma de la persona, sin mostrar el texto del servidor', async () => {
    api.auth.deletionPreflight.mockResolvedValue({
      success: true,
      data: { elegible: false, bloqueos: ['BALANCE_POSITIVE', 'ESCROW_OPEN', 'CODIGO_NUEVO_DE_UN_SERVIDOR_MAS_RECIENTE'], pideSegundoFactor: false },
    });
    pintar();

    expect(await screen.findByText('Antes de eliminar tu cuenta')).toBeInTheDocument();
    expect(screen.getByText(/Tienes saldo en tu billetera/)).toBeInTheDocument();
    expect(screen.getByText(/acuerdo de garantía abierto/)).toBeInTheDocument();
    // Un codigo que esta version no conoce cae en el generico en vez de romper.
    expect(screen.getByText(/Hay algo pendiente en tu cuenta/)).toBeInTheDocument();
    // Y ese caso manda a soporte con la direccion como enlace.
    expect(screen.getByRole('link', { name: 'soporte@kiramopay.com' })).toHaveAttribute(
      'href',
      'mailto:soporte@kiramopay.com',
    );
    // Sin nada que confirmar: no hay contrasena que pedir.
    expect(screen.queryByLabelText('Contraseña actual')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
  });

  it('una cuenta con restriccion lleva a la pagina web', async () => {
    api.auth.deletionPreflight.mockResolvedValue({
      success: true,
      data: { elegible: false, motivo: 'ACCOUNT_NOT_ELIGIBLE', bloqueos: [], pideSegundoFactor: false },
    });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByText(/tiene una restricción/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Pedir la eliminación en la página web' }));
    expect(abrirPublico).toHaveBeenCalledWith('/eliminar-cuenta');
  });

  it('una cuenta de demostracion no ofrece eliminar', async () => {
    api.auth.deletionPreflight.mockResolvedValue({
      success: true,
      data: { elegible: false, motivo: 'DEMO_ACCOUNT', bloqueos: [], pideSegundoFactor: false },
    });
    pintar();
    expect(await screen.findByText(/cuenta de demostración/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
  });

  it('si la revision falla lo dice y deja reintentar, sin afirmar que se puede eliminar', async () => {
    api.auth.deletionPreflight
      .mockResolvedValueOnce({ success: false, error: { code: 'PREFLIGHT_FAILED', message: 'x' } })
      .mockResolvedValueOnce({ success: true, data: limpia });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos revisar tu cuenta');
    expect(screen.queryByRole('button', { name: 'Continuar' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Vas a eliminar tu cuenta')).toBeInTheDocument();
    expect(api.auth.deletionPreflight).toHaveBeenCalledTimes(2);
  });
});

describe('EliminarCuentaSheet — confirmacion', () => {
  it('no se puede enviar sin la palabra, la contrasena y la aceptacion del plazo; la palabra no distingue mayusculas', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);

    const boton = screen.getByRole('button', { name: BOTON });
    expect(boton).toBeDisabled();

    await user.type(screen.getByLabelText('Escribe ELIMINAR para confirmar'), 'eliminar');
    expect(boton).toBeDisabled(); // falta la contrasena
    await user.type(screen.getByLabelText('Contraseña actual'), 'Clave-123');
    expect(boton).toBeDisabled(); // falta aceptar el plazo
    const plazo = screen.getByRole('checkbox', { name: /Acepto el plazo/ });
    expect(plazo).not.toBeChecked();
    await user.click(plazo);
    expect(boton).toBeEnabled();
  });

  it('pide la eliminacion con la aceptacion del plazo, suelta la sesion local con la fecha y cierra', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    api.auth.deleteAccount.mockResolvedValue({ success: true, data: pedida });
    const user = userEvent.setup();
    const onClose = pintar();
    await llegarALaConfirmacion(user);
    await completar(user);
    await user.click(screen.getByRole('button', { name: BOTON }));

    await waitFor(() => expect(cuentaEliminada).toHaveBeenCalledTimes(1));
    expect(cuentaEliminada).toHaveBeenCalledWith('2026-11-17T15:00:00Z');
    expect(api.auth.deleteAccount).toHaveBeenCalledWith({ password: 'Clave-123', totpCode: undefined, acceptTerms: true });
    expect(onClose).toHaveBeenCalled();
  });

  it('si el servidor dice que falta la aceptacion, lo explica en el formulario', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    api.auth.deleteAccount.mockResolvedValue({ success: false, error: { code: 'TERMS_NOT_ACCEPTED', message: 'x' } });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);
    await completar(user);
    await user.click(screen.getByRole('button', { name: BOTON }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Tienes que aceptar el plazo de 30 días.');
    expect(cuentaEliminada).not.toHaveBeenCalled();
  });

  it('con el autenticador encendido pide el codigo y lo manda', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: { ...limpia, pideSegundoFactor: true } });
    api.auth.deleteAccount.mockResolvedValue({ success: true, data: pedida });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);

    await completar(user);
    const boton = screen.getByRole('button', { name: BOTON });
    expect(boton).toBeDisabled(); // falta el codigo
    await user.type(screen.getByLabelText('Código de tu app autenticadora'), '12ab3456');
    expect(screen.getByLabelText('Código de tu app autenticadora')).toHaveValue('123456'); // solo digitos, 6
    await user.click(boton);

    await waitFor(() => expect(api.auth.deleteAccount).toHaveBeenCalled());
    expect(api.auth.deleteAccount).toHaveBeenCalledWith({ password: 'Clave-123', totpCode: '123456', acceptTerms: true });
  });

  it('una contrasena equivocada se dice en el formulario, se borra el campo y NO se suelta la sesion', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    api.auth.deleteAccount.mockResolvedValue({ success: false, error: { code: 'CURRENT_PASSWORD_INVALID', message: 'x' } });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);

    await completar(user, 'mala');
    await user.click(screen.getByRole('button', { name: BOTON }));

    expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña no es correcta.');
    expect(screen.getByLabelText('Contraseña actual')).toHaveValue('');
    expect(cuentaEliminada).not.toHaveBeenCalled();
  });

  it('demasiados intentos se explican con su propio texto', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    api.auth.deleteAccount.mockResolvedValue({ success: false, error: { code: 'DELETION_LOCKED', message: 'x' } });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);

    await completar(user);
    await user.click(screen.getByRole('button', { name: BOTON }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos');
  });

  it('un error que la pantalla no reconoce sale generico, sin el texto del servidor', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    api.auth.deleteAccount.mockResolvedValue({ success: false, error: { code: 'DELETION_FAILED', message: 'pq: relation secreta' } });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);

    await completar(user);
    await user.click(screen.getByRole('button', { name: BOTON }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos pedir la eliminación');
    expect(alerta).not.toHaveTextContent('secreta');
    // Si sigue fallando, la persona sabe a donde escribir.
    expect(alerta).toHaveTextContent('soporte@kiramopay.com');
    expect(within(alerta).getByRole('link', { name: 'soporte@kiramopay.com' })).toHaveAttribute(
      'href',
      'mailto:soporte@kiramopay.com',
    );
  });

  it('si algo cambio entre la revision y el envio (409), lista lo pendiente y no suelta la sesion', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    api.auth.deleteAccount.mockResolvedValue({
      success: false,
      error: { code: 'DELETION_BLOCKED', message: 'x', details: { blockers: [{ code: 'TX_PENDING' }] } },
    });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);

    await completar(user);
    await user.click(screen.getByRole('button', { name: BOTON }));

    expect(await screen.findByText(/movimiento en proceso/)).toBeInTheDocument();
    expect(cuentaEliminada).not.toHaveBeenCalled();
  });
});

// La respuesta escrita a la solicitud sale por correo (Ley 8968). Una cuenta sin
// correo da uno solo para eso: no queda en el perfil.
describe('EliminarCuentaSheet — a donde va la respuesta escrita', () => {
  const sinCorreo = { ...limpia, pideCorreoParaRespuesta: true };
  const CAMPO_CORREO = 'Correo para enviarte la respuesta';
  const CAMPO_REPETIDO = 'Repite el correo';

  it('con correo registrado, el resumen dice que la respuesta va a su correo y no pide otro', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByText(/Te enviamos todo esto por escrito a tu correo/)).toBeInTheDocument();
    await llegarALaConfirmacion(user);
    expect(screen.queryByLabelText(CAMPO_CORREO)).toBeNull();
  });

  it('una cuenta sin correo pide uno solo para la respuesta y lo manda', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: sinCorreo });
    api.auth.deleteAccount.mockResolvedValue({ success: true, data: pedida });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByText(/te pedimos uno, solo para enviarte todo esto por escrito/)).toBeInTheDocument();
    await llegarALaConfirmacion(user);
    await completar(user);
    const boton = screen.getByRole('button', { name: BOTON });
    // Sin un correo valido no se puede enviar.
    expect(boton).toBeDisabled();
    const campo = screen.getByLabelText(CAMPO_CORREO);
    expect(campo).toHaveAccessibleDescription(/no queda en tu perfil/);
    await user.type(campo, 'no-es-un-correo');
    expect(boton).toBeDisabled();
    await user.clear(campo);
    await user.type(campo, 'respuesta@ejemplo.test');
    // Se pide dos veces: con uno solo todavia no se puede enviar.
    expect(boton).toBeDisabled();
    await user.type(screen.getByLabelText(CAMPO_REPETIDO), 'Respuesta@Ejemplo.test');
    await user.click(boton);

    await waitFor(() => expect(cuentaEliminada).toHaveBeenCalledTimes(1));
    expect(api.auth.deleteAccount).toHaveBeenCalledWith({
      password: 'Clave-123',
      totpCode: undefined,
      acceptTerms: true,
      responseEmail: 'respuesta@ejemplo.test',
      responseEmailConfirmation: 'Respuesta@Ejemplo.test',
    });
  });

  it('si los dos correos no coinciden no deja enviar y lo dice', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: sinCorreo });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);
    await completar(user);

    await user.type(screen.getByLabelText(CAMPO_CORREO), 'respuesta@ejemplo.test');
    await user.type(screen.getByLabelText(CAMPO_REPETIDO), 'respuesta@ejemplo.tes');
    await user.tab();
    expect(screen.getByText('Los dos correos no coinciden.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: BOTON })).toBeDisabled();
    await user.type(screen.getByLabelText(CAMPO_REPETIDO), 't');
    expect(screen.queryByText('Los dos correos no coinciden.')).toBeNull();
    expect(screen.getByRole('button', { name: BOTON })).toBeEnabled();
  });

  it('el correo para la respuesta se valida como en el servidor: uno con tilde no habilita el envio', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: sinCorreo });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);
    await completar(user);

    await user.type(screen.getByLabelText(CAMPO_CORREO), 'josé@ejemplo.com');
    await user.type(screen.getByLabelText(CAMPO_REPETIDO), 'josé@ejemplo.com');
    expect(screen.getByRole('button', { name: BOTON })).toBeDisabled();
    await user.clear(screen.getByLabelText(CAMPO_CORREO));
    await user.type(screen.getByLabelText(CAMPO_CORREO), 'jose@ejemplo.com');
    await user.clear(screen.getByLabelText(CAMPO_REPETIDO));
    await user.type(screen.getByLabelText(CAMPO_REPETIDO), 'jose@ejemplo.com');
    expect(screen.getByRole('button', { name: BOTON })).toBeEnabled();
  });

  it('si el servidor rechaza el correo para la respuesta, lo dice en el formulario', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: sinCorreo });
    api.auth.deleteAccount
      .mockResolvedValueOnce({ success: false, error: { code: 'RESPONSE_EMAIL_INVALID', message: 'x' } })
      .mockResolvedValueOnce({ success: false, error: { code: 'RESPONSE_EMAIL_REQUIRED', message: 'x' } })
      .mockResolvedValueOnce({ success: false, error: { code: 'RESPONSE_EMAIL_MISMATCH', message: 'x' } });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);
    await completar(user);
    await user.type(screen.getByLabelText(CAMPO_CORREO), 'respuesta@ejemplo.test');
    await user.type(screen.getByLabelText(CAMPO_REPETIDO), 'respuesta@ejemplo.test');

    await user.click(screen.getByRole('button', { name: BOTON }));
    expect(await screen.findByText('Ese correo no es válido. Revísalo.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: BOTON }));
    expect(await screen.findByText('Escribe un correo para enviarte la respuesta.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: BOTON }));
    expect(await screen.findByText('Los dos correos no coinciden.')).toBeInTheDocument();
    expect(cuentaEliminada).not.toHaveBeenCalled();
  });
});
