import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { EliminarCuentaSheet } from '../EliminarCuentaSheet';

// La hoja de eliminar la cuenta: lo que se borra y lo que se conserva, lo que hay
// que resolver antes, y una confirmacion que pide la palabra, la contrasena y, si
// lo tiene, el codigo del autenticador. El servidor reautentica; aqui se prueba
// que la pantalla no deja enviar sin lo necesario y que dice el motivo por codigo.

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

describe('EliminarCuentaSheet — revision previa', () => {
  it('con la cuenta limpia dice que se borra y que se conserva, y enlaza la politica', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    const user = userEvent.setup();
    pintar();

    expect(await screen.findByText('Vas a eliminar tu cuenta')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Se borra' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Se conserva' })).toBeInTheDocument();
    expect(screen.getByText(/sin tus datos de contacto/)).toBeInTheDocument();

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
  it('no se puede enviar sin la palabra y la contrasena; la palabra no distingue mayusculas', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);

    const boton = screen.getByRole('button', { name: 'Eliminar mi cuenta para siempre' });
    expect(boton).toBeDisabled();

    await user.type(screen.getByLabelText('Escribe ELIMINAR para confirmar'), 'eliminar');
    expect(boton).toBeDisabled(); // falta la contrasena
    await user.type(screen.getByLabelText('Contraseña actual'), 'Clave-123');
    expect(boton).toBeEnabled();
  });

  it('elimina con la contrasena, suelta la sesion local y cierra', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    api.auth.deleteAccount.mockResolvedValue({ success: true, data: { alreadyDeleted: false } });
    const user = userEvent.setup();
    const onClose = pintar();
    await llegarALaConfirmacion(user);

    await user.type(screen.getByLabelText('Escribe ELIMINAR para confirmar'), 'ELIMINAR');
    await user.type(screen.getByLabelText('Contraseña actual'), 'Clave-123');
    await user.click(screen.getByRole('button', { name: 'Eliminar mi cuenta para siempre' }));

    await waitFor(() => expect(cuentaEliminada).toHaveBeenCalledTimes(1));
    expect(api.auth.deleteAccount).toHaveBeenCalledWith({ password: 'Clave-123', totpCode: undefined });
    expect(onClose).toHaveBeenCalled();
  });

  it('con el autenticador encendido pide el codigo y lo manda', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: { ...limpia, pideSegundoFactor: true } });
    api.auth.deleteAccount.mockResolvedValue({ success: true, data: { alreadyDeleted: false } });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);

    await user.type(screen.getByLabelText('Escribe ELIMINAR para confirmar'), 'ELIMINAR');
    await user.type(screen.getByLabelText('Contraseña actual'), 'Clave-123');
    const boton = screen.getByRole('button', { name: 'Eliminar mi cuenta para siempre' });
    expect(boton).toBeDisabled(); // falta el codigo
    await user.type(screen.getByLabelText('Código de tu app autenticadora'), '12ab3456');
    expect(screen.getByLabelText('Código de tu app autenticadora')).toHaveValue('123456'); // solo digitos, 6
    await user.click(boton);

    await waitFor(() => expect(api.auth.deleteAccount).toHaveBeenCalled());
    expect(api.auth.deleteAccount).toHaveBeenCalledWith({ password: 'Clave-123', totpCode: '123456' });
  });

  it('una contrasena equivocada se dice en el formulario, se borra el campo y NO se suelta la sesion', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    api.auth.deleteAccount.mockResolvedValue({ success: false, error: { code: 'CURRENT_PASSWORD_INVALID', message: 'x' } });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);

    await user.type(screen.getByLabelText('Escribe ELIMINAR para confirmar'), 'ELIMINAR');
    await user.type(screen.getByLabelText('Contraseña actual'), 'mala');
    await user.click(screen.getByRole('button', { name: 'Eliminar mi cuenta para siempre' }));

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

    await user.type(screen.getByLabelText('Escribe ELIMINAR para confirmar'), 'ELIMINAR');
    await user.type(screen.getByLabelText('Contraseña actual'), 'Clave-123');
    await user.click(screen.getByRole('button', { name: 'Eliminar mi cuenta para siempre' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos');
  });

  it('un error que la pantalla no reconoce sale generico, sin el texto del servidor', async () => {
    api.auth.deletionPreflight.mockResolvedValue({ success: true, data: limpia });
    api.auth.deleteAccount.mockResolvedValue({ success: false, error: { code: 'DELETION_FAILED', message: 'pq: relation secreta' } });
    const user = userEvent.setup();
    pintar();
    await llegarALaConfirmacion(user);

    await user.type(screen.getByLabelText('Escribe ELIMINAR para confirmar'), 'ELIMINAR');
    await user.type(screen.getByLabelText('Contraseña actual'), 'Clave-123');
    await user.click(screen.getByRole('button', { name: 'Eliminar mi cuenta para siempre' }));

    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('No pudimos eliminar tu cuenta');
    expect(alerta).not.toHaveTextContent('secreta');
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

    await user.type(screen.getByLabelText('Escribe ELIMINAR para confirmar'), 'ELIMINAR');
    await user.type(screen.getByLabelText('Contraseña actual'), 'Clave-123');
    await user.click(screen.getByRole('button', { name: 'Eliminar mi cuenta para siempre' }));

    expect(await screen.findByText(/movimiento en proceso/)).toBeInTheDocument();
    expect(cuentaEliminada).not.toHaveBeenCalled();
  });
});
