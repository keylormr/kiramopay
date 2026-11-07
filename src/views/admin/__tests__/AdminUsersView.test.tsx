import { render, screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminUsersView } from '../AdminUsersView';
import type { AdminUser, EventoDeHistorial } from '@/api/repositories/admin.repository';
import type { DeviceSession } from '@/api/repositories/sessions.repository';
import { useAuthStore } from '@/stores/auth.store';
import type { User } from '@/types';

const mockApi = vi.hoisted(() => ({
  admin: {
    searchUsers: vi.fn(),
    listBlockedUsers: vi.fn(),
    getUser: vi.fn(),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
    setUserExpiry: vi.fn(),
    setUserPlan: vi.fn(),
    listUserSessions: vi.fn(),
    revokeUserSession: vi.fn(),
    revokeAllUserSessions: vi.fn(),
    userHistory: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const keilor: AdminUser = {
  id: 'u1',
  firstName: 'Keilor',
  lastName: 'Martinez',
  username: 'keilor',
  cedulaMasked: '••••••930',
  phoneMasked: '••••••••1234',
  emailMasked: 'k•••••@gmail.com',
  status: 'active',
  role: 'user',
  kycLevel: 1,
  createdAt: '2026-03-04T10:22:31Z',
  lastLoginAt: '2026-09-01T18:04:12Z',
  blockedAt: null,
  blockedReason: '',
  blockedByName: '',
  expiresAt: null,
  plan: 'free',
};

const victor: AdminUser = { ...keilor, id: 'u2', firstName: 'Victor', lastName: 'Rojas', username: 'victor', cedulaMasked: '••••••111' };

const keilorConVencimiento: AdminUser = { ...keilor, expiresAt: '2027-01-15T12:00:00Z' };

const keilorBlocked: AdminUser = {
  ...keilor,
  status: 'blocked',
  blockedAt: '2026-09-02T14:00:00Z',
  blockedReason: 'presto la demo',
  blockedByName: 'Admin User',
};

const android: DeviceSession = {
  id: 's1',
  deviceName: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  ipMasked: '186.15.0.0',
  createdAt: '2026-11-05T08:12:00Z',
  expiresAt: '2026-11-12T08:12:00Z',
  current: false,
};
const windows: DeviceSession = {
  ...android,
  id: 's2',
  deviceName: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  ipMasked: '201.203.0.0',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function setup() {
  return render(
    <LanguageProvider>
      <AdminUsersView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

async function search(user: ReturnType<typeof userEvent.setup>, term: string) {
  await user.type(screen.getByPlaceholderText('Cédula, correo, teléfono o nombre'), `${term}{Enter}`);
}

// Dos toques seguidos ANTES de que React vuelva a pintar: el doble envio real.
async function dobleToque(boton: HTMLElement) {
  await act(async () => {
    boton.click();
    boton.click();
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mockApi.admin).forEach((fn) => fn.mockReset());
  mockApi.admin.listUserSessions.mockResolvedValue({ success: true, data: [] });
  mockApi.admin.userHistory.mockResolvedValue({ success: true, data: [] });
});

afterEach(() => {
  // Las pruebas de la tabla simulan una ventana ancha.
  delete (window as { matchMedia?: unknown }).matchMedia;
  useAuthStore.setState({ user: null });
});

describe('AdminUsersView en telefono', () => {
  it('shows the empty state when the search has no results', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    setup();

    await search(user, 'nadie');

    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    expect(mockApi.admin.searchUsers).toHaveBeenCalledWith('nadie');
  });

  it('un resultado unico abre su ficha con el nombre, la cedula enmascarada y el estado', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');

    const ficha = await screen.findByRole('article', { name: 'Keilor Martinez' });
    expect(within(ficha).getByText('••••••930')).toBeInTheDocument();
    expect(within(ficha).getByText('Activa')).toBeInTheDocument();
    expect(mockApi.admin.listUserSessions).toHaveBeenCalledWith('u1');
    expect(mockApi.admin.userHistory).toHaveBeenCalledWith('u1');
  });

  it('con varios resultados muestra la lista; tocar una fila abre la ficha y Atras vuelve', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor, victor] });
    const user = userEvent.setup();
    setup();

    await search(user, 'mart');
    const lista = await screen.findByRole('list', { name: 'Resultados' });
    // En la lista todavia no se pidio nada de ninguna cuenta.
    expect(mockApi.admin.listUserSessions).not.toHaveBeenCalled();

    await user.click(within(lista).getByRole('button', { name: /Victor Rojas/ }));
    expect(await screen.findByRole('article', { name: 'Victor Rojas' })).toBeInTheDocument();
    expect(mockApi.admin.listUserSessions).toHaveBeenCalledWith('u2');

    await user.click(screen.getByRole('button', { name: 'Volver a la lista' }));
    expect(await screen.findByRole('list', { name: 'Resultados' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
  });

  // La fila tocada se desmonta: sin esto el foco caia al documento y un lector
  // de pantalla no decia nada.
  it('al abrir la ficha el foco va a su titulo y al volver regresa a la fila', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor, victor] });
    const user = userEvent.setup();
    setup();

    await search(user, 'mart');
    await user.click(within(await screen.findByRole('list', { name: 'Resultados' })).getByRole('button', { name: /Victor Rojas/ }));
    await screen.findByRole('article', { name: 'Victor Rojas' });
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Victor Rojas' }));

    await user.click(screen.getByRole('button', { name: 'Volver a la lista' }));
    const lista = await screen.findByRole('list', { name: 'Resultados' });
    await waitFor(() => expect(document.activeElement).toBe(within(lista).getByRole('button', { name: /Victor Rojas/ })));
  });

  it('Atras desde la ficha de un resultado unico no la vuelve a abrir sola', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await screen.findByRole('article', { name: 'Keilor Martinez' });
    await user.click(screen.getByRole('button', { name: 'Volver a la lista' }));

    expect(await screen.findByRole('list', { name: 'Resultados' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('shows an account with the deletion in progress as such, not as active', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [{ ...keilor, status: 'pending_deletion' }] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');

    expect(await screen.findByText('Eliminación en curso')).toBeInTheDocument();
    expect(screen.queryByText('Activa')).toBeNull();
  });

  it('does not call the API with fewer than 3 characters', async () => {
    const user = userEvent.setup();
    setup();

    await search(user, 'ke');

    expect(mockApi.admin.searchUsers).not.toHaveBeenCalled();
  });

  it('refuses to block without a reason', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: 'Bloquear cuenta' }));
    await user.click(await screen.findByRole('button', { name: 'Sí, bloquear' }));

    expect(await screen.findByText('Escribe el motivo del bloqueo')).toBeInTheDocument();
    expect(mockApi.admin.blockUser).not.toHaveBeenCalled();
  });

  it('blocks once with the reason even on a double click, closes the sessions and refreshes the card', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.listUserSessions.mockResolvedValue({ success: true, data: [android, windows] });
    const pending = deferred<{ success: boolean; data: AdminUser }>();
    mockApi.admin.blockUser.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await screen.findByText('Chrome en Android');
    await user.click(screen.getByRole('button', { name: 'Bloquear cuenta' }));
    // La hoja dice cuantas sesiones se van a cerrar.
    expect(screen.getByText(/Sesiones abiertas que se cierran: 2\./)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Motivo (obligatorio)'), 'presto la demo');
    await dobleToque(screen.getByRole('button', { name: 'Sí, bloquear' }));

    expect(mockApi.admin.blockUser).toHaveBeenCalledTimes(1);
    expect(mockApi.admin.blockUser).toHaveBeenCalledWith('u1', 'presto la demo');

    pending.resolve({ success: true, data: keilorBlocked });

    const ficha = await screen.findByRole('article', { name: 'Keilor Martinez' });
    expect(await within(ficha).findByText('Bloqueada')).toBeInTheDocument();
    expect(within(ficha).getByText('presto la demo')).toBeInTheDocument();
    expect(within(ficha).getByText('Admin User')).toBeInTheDocument();
    expect(within(ficha).getByRole('status')).toHaveTextContent('Cuenta bloqueada y sesiones cerradas. Quedó en la auditoría.');
    // El bloqueo revoca todas las sesiones: la tabla no sigue mostrandolas.
    expect(screen.queryByText('Chrome en Android')).toBeNull();
    expect(within(ficha).getByRole('button', { name: /Desbloquear cuenta/ })).toBeInTheDocument();
  });

  it('si se bloquea antes de que lleguen las sesiones, la respuesta vieja no las revive', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    const tardia = deferred<{ success: boolean; data: DeviceSession[] }>();
    mockApi.admin.listUserSessions.mockReturnValue(tardia.promise);
    mockApi.admin.blockUser.mockResolvedValue({ success: true, data: keilorBlocked });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: 'Bloquear cuenta' }));
    await user.type(screen.getByLabelText('Motivo (obligatorio)'), 'presto la demo');
    await user.click(screen.getByRole('button', { name: 'Sí, bloquear' }));
    await screen.findByText('No hay sesiones abiertas. Mientras la cuenta esté bloqueada, nadie puede volver a entrar.');

    // Llega la lista pedida ANTES del bloqueo.
    await act(async () => { tardia.resolve({ success: true, data: [android] }); });

    expect(screen.queryByText('Chrome en Android')).toBeNull();
  });

  it('bloquear desde Buscar suma la cuenta a Bloqueadas sin volver a la pestana', async () => {
    mockApi.admin.listBlockedUsers.mockResolvedValue({ success: true, data: [{ ...victor, status: 'blocked', blockedAt: '2026-11-01T10:00:00Z', blockedReason: 'x' }] });
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.blockUser.mockResolvedValue({ success: true, data: keilorBlocked });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('tab', { name: 'Bloqueadas' }));
    expect(await screen.findByRole('tab', { name: /Bloqueadas\s*1/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Buscar/ }));
    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: 'Bloquear cuenta' }));
    await user.type(screen.getByLabelText('Motivo (obligatorio)'), 'presto la demo');
    await user.click(screen.getByRole('button', { name: 'Sí, bloquear' }));

    expect(await screen.findByRole('tab', { name: /Bloqueadas\s*2/ })).toBeInTheDocument();
  });

  it('las pestanas se recorren con las flechas', async () => {
    mockApi.admin.listBlockedUsers.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    setup();

    const buscar = screen.getByRole('tab', { name: 'Buscar' });
    expect(buscar).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: /Bloqueadas/ })).toHaveAttribute('tabindex', '-1');
    buscar.focus();
    await user.keyboard('{ArrowRight}');

    const bloqueadas = screen.getByRole('tab', { name: /Bloqueadas/ });
    expect(bloqueadas).toHaveAttribute('aria-selected', 'true');
    expect(document.activeElement).toBe(bloqueadas);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', bloqueadas.id);
  });

  it('unblocks on confirmation and shows the account as active again', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilorBlocked] });
    mockApi.admin.unblockUser.mockResolvedValue({ success: true, data: keilor });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: /Desbloquear cuenta/ }));
    await user.click(await screen.findByRole('button', { name: 'Sí, desbloquear' }));

    await waitFor(() => expect(mockApi.admin.unblockUser).toHaveBeenCalledWith('u1'));
    expect(await screen.findByText('Activa')).toBeInTheDocument();
  });

  it('schedules an expiry from the quick 7-day shortcut and shows it on the card', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.setUserExpiry.mockResolvedValue({ success: true, data: keilorConVencimiento });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: /Programar vencimiento/ }));
    await user.click(await screen.findByRole('button', { name: '7 días' }));
    await user.click(screen.getByRole('button', { name: 'Guardar vencimiento' }));

    await waitFor(() => expect(mockApi.admin.setUserExpiry).toHaveBeenCalledTimes(1));
    const [id, iso] = mockApi.admin.setUserExpiry.mock.calls[0] as [string, string | null];
    expect(id).toBe('u1');
    // El atajo manda una fecha real, en ISO y a siete dias vista (con holgura
    // por el tiempo que tarda el propio test).
    const dias = (new Date(iso as string).getTime() - Date.now()) / 86400000;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);

    // La cuenta sigue activa: programar no bloquea nada todavia.
    expect(await screen.findByText('Vence el')).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
  });

  it('keeps its own clock, so an open card turns expired without a new search', async () => {
    // El espia deja pasar la llamada real (no reemplaza setInterval: RTL lo usa
    // para esperar) y solo captura el latido del reloj de la vista.
    const spy = vi.spyOn(window, 'setInterval');

    try {
      const porVencer: AdminUser = { ...keilor, expiresAt: new Date(Date.now() + 100).toISOString() };
      mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [porVencer] });
      const user = userEvent.setup();
      setup();

      await search(user, 'keil');
      expect(await screen.findByText('Vence el')).toBeInTheDocument();

      const latido = spy.mock.calls.find((c) => c[1] === 30000);
      expect(latido, 'la vista no armo su reloj').toBeDefined();

      await new Promise((r) => setTimeout(r, 150));
      await act(async () => { (latido![0] as () => void)(); });

      expect(screen.getByText('Vencida', { exact: false })).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses to save an expiry with an empty date', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: /Programar vencimiento/ }));
    await user.click(await screen.findByRole('button', { name: 'Guardar vencimiento' }));

    expect(await screen.findByText('Elige una fecha válida')).toBeInTheDocument();
    expect(mockApi.admin.setUserExpiry).not.toHaveBeenCalled();
  });

  it('clears the expiry with an explicit null', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilorConVencimiento] });
    mockApi.admin.setUserExpiry.mockResolvedValue({ success: true, data: keilor });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: /Cambiar vencimiento/ }));
    await user.click(await screen.findByRole('button', { name: 'Quitar vencimiento' }));

    await waitFor(() => expect(mockApi.admin.setUserExpiry).toHaveBeenCalledWith('u1', null));
    await waitFor(() => expect(screen.queryByText('Vence el')).not.toBeInTheDocument());
  });

  it('shows the plan and assigns a new one after confirming, once', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    const pending = deferred<{ success: boolean; data: { userId: string; plan: string; planAnterior: string; updatedAt: string } }>();
    mockApi.admin.setUserPlan.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: /Plan\s*Gratis/ }));
    await user.click(screen.getByRole('radio', { name: 'Plus' }));
    await dobleToque(screen.getByRole('button', { name: 'Asignar el plan Plus' }));

    expect(mockApi.admin.setUserPlan).toHaveBeenCalledTimes(1);
    expect(mockApi.admin.setUserPlan).toHaveBeenCalledWith('u1', 'plus');

    pending.resolve({ success: true, data: { userId: 'u1', plan: 'plus', planAnterior: 'free', updatedAt: '2026-09-13T10:00:00Z' } });

    // La region viva existe desde antes (vacia): se espera a que diga lo hecho.
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Plan cambiado de Gratis a Plus.'));
    expect(screen.getByRole('button', { name: /Plan\s*Plus/ })).toBeInTheDocument();
  });

  it('does not let the same plan be assigned again', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: /Plan\s*Gratis/ }));

    expect(screen.getByRole('button', { name: 'Asignar el plan Gratis' })).toBeDisabled();
    expect(mockApi.admin.setUserPlan).not.toHaveBeenCalled();
  });

  it('warns that lowering the plan deletes nothing', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [{ ...keilor, plan: 'pro' }] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: /Plan\s*Pro/ }));
    expect(screen.queryByText(/Bajar de plan no borra metas ni tarjetas/)).toBeNull();
    await user.click(screen.getByRole('radio', { name: 'Gratis' }));

    expect(screen.getByText(/Bajar de plan no borra metas ni tarjetas/)).toBeInTheDocument();
  });

  it('explains USER_NOT_FOUND and keeps the sheet open', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.setUserPlan.mockResolvedValue({ success: false, error: { code: 'USER_NOT_FOUND', message: 'x' } });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: /Plan\s*Gratis/ }));
    await user.click(screen.getByRole('radio', { name: 'Pro' }));
    await user.click(screen.getByRole('button', { name: 'Asignar el plan Pro' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Esa cuenta ya no existe');
    expect(screen.getByRole('button', { name: 'Asignar el plan Pro' })).toBeInTheDocument();
  });

  // Un administrador no se asigna su propio plan: el servidor responde 403
  // ADMIN_IS_AFFECTED_PARTY y la hoja lo explica en el idioma de la app.
  it('explains ADMIN_IS_AFFECTED_PARTY when the admin changes their own plan', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.setUserPlan.mockResolvedValue({
      success: false,
      error: { code: 'ADMIN_IS_AFFECTED_PARTY', message: 'an administrator cannot assign their own plan' },
    });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: /Plan\s*Gratis/ }));
    await user.click(screen.getByRole('radio', { name: 'Pro' }));
    await user.click(screen.getByRole('button', { name: 'Asignar el plan Pro' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No puedes cambiar tu propio plan: lo tiene que hacer otro administrador.');
  });

  it('lists the blocked accounts on the second tab, with their count', async () => {
    mockApi.admin.listBlockedUsers.mockResolvedValue({ success: true, data: [keilorBlocked] });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('tab', { name: 'Bloqueadas' }));

    const lista = await screen.findByRole('list', { name: 'Bloqueadas' });
    expect(within(lista).getByText('Keilor Martinez')).toBeInTheDocument();
    // La fila dice el motivo; la etiqueta "Bloqueada" no se repite en cada una
    // porque es lo que ya dice la pestana.
    expect(within(lista).getByText('presto la demo')).toBeInTheDocument();
    expect(within(lista).queryByText('Bloqueada')).toBeNull();
    expect(screen.getByRole('tab', { name: /Bloqueadas\s*1/ })).toBeInTheDocument();
    expect(mockApi.admin.listBlockedUsers).toHaveBeenCalledTimes(1);
  });

  it('una cuenta de administrador no ofrece bloquear ni vencer', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [{ ...keilor, role: 'admin' }] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await screen.findByRole('article', { name: 'Keilor Martinez' });

    expect(screen.getByText('Las cuentas de administrador no se bloquean ni vencen desde aquí.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bloquear cuenta' })).toBeNull();
    expect(screen.queryByRole('button', { name: /vencimiento/ })).toBeNull();
  });
});

describe('AdminUsersView: las sesiones de la cuenta', () => {
  it('muestra cada dispositivo con su plataforma y cierra UNO una sola vez, sin bloquear', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.listUserSessions.mockResolvedValue({ success: true, data: [android, windows] });
    const pending = deferred<{ success: boolean }>();
    mockApi.admin.revokeUserSession.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    expect(await screen.findByText('Chrome en Android')).toBeInTheDocument();
    expect(screen.getByText('Chrome en Windows')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cerrar la sesión de Chrome en Android' }));
    await dobleToque(await screen.findByRole('button', { name: 'Sí, cerrar' }));

    expect(mockApi.admin.revokeUserSession).toHaveBeenCalledTimes(1);
    expect(mockApi.admin.revokeUserSession).toHaveBeenCalledWith('u1', 's1');

    pending.resolve({ success: true });

    await waitFor(() => expect(screen.queryByText('Chrome en Android')).toBeNull());
    expect(screen.getByText('Chrome en Windows')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Sesión cerrada en Chrome en Android. Quedó en la auditoría.');
    expect(mockApi.admin.blockUser).not.toHaveBeenCalled();
    expect(screen.getByText('Activa')).toBeInTheDocument();
  });

  it('una sesion que ya no existe sale de la lista y lo dice', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.listUserSessions.mockResolvedValue({ success: true, data: [android, windows] });
    mockApi.admin.revokeUserSession.mockResolvedValue({ success: false, error: { code: 'SESSION_NOT_FOUND', message: 'x' } });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: 'Cerrar la sesión de Chrome en Windows' }));
    await user.click(await screen.findByRole('button', { name: 'Sí, cerrar' }));

    await waitFor(() => expect(screen.queryByText('Chrome en Windows')).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Esa sesión ya estaba cerrada.');
  });

  it('Cerrar todas pide confirmacion, llama una vez y deja la cuenta activa', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.listUserSessions.mockResolvedValue({ success: true, data: [android, windows] });
    mockApi.admin.revokeAllUserSessions.mockResolvedValue({ success: true, data: 2 });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await screen.findByText('Chrome en Android');
    await user.click(screen.getByRole('button', { name: 'Cerrar todas' }));
    expect(screen.getByText(/Sesiones que se cierran: 2\. La cuenta no se bloquea/)).toBeInTheDocument();
    expect(mockApi.admin.revokeAllUserSessions).not.toHaveBeenCalled();
    await dobleToque(screen.getByRole('button', { name: 'Sí, cerrar todas' }));

    expect(mockApi.admin.revokeAllUserSessions).toHaveBeenCalledTimes(1);
    expect(mockApi.admin.revokeAllUserSessions).toHaveBeenCalledWith('u1');
    expect(await screen.findByText('No hay sesiones abiertas.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Sesiones cerradas: 2. Quedó en la auditoría.');
    expect(mockApi.admin.blockUser).not.toHaveBeenCalled();
  });

  it('si las sesiones no cargan, lo dice y deja reintentar', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.listUserSessions
      .mockResolvedValueOnce({ success: false, error: { code: 'RATE_LIMITED', message: 'x' } })
      .mockResolvedValueOnce({ success: true, data: [android] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    expect(await screen.findByText('No se pudieron cargar las sesiones.')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Reintentar' })[0]);

    expect(await screen.findByText('Chrome en Android')).toBeInTheDocument();
  });
});

describe('AdminUsersView: la cuenta del propio administrador', () => {
  it('muestra sus sesiones sin botones de cerrar y dice donde cerrarlas', async () => {
    useAuthStore.setState({ user: { id: 'u1' } as User });
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [{ ...keilor, role: 'admin' }] });
    mockApi.admin.listUserSessions.mockResolvedValue({ success: true, data: [android, windows] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    expect(await screen.findByText('Chrome en Android')).toBeInTheDocument();
    expect(screen.getByText(/Son tus propias sesiones: ciérralas desde Dispositivos conectados/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cerrar la sesión de/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cerrar todas' })).toBeNull();
  });
});

describe('AdminUsersView: el historial de la cuenta', () => {
  const historial: EventoDeHistorial[] = [
    { id: 'h1', accion: 'user_unblocked', actor: 'Keilor Martinez', automatico: false, motivo: '', sesionesCerradas: null, venceEl: null, vencimientoQuitado: false, planAntes: null, planDespues: null, createdAt: '2026-11-06T15:00:00Z' },
    { id: 'h2', accion: 'user_blocked', actor: 'Keilor Martinez', automatico: false, motivo: 'reporto el robo', sesionesCerradas: 2, venceEl: null, vencimientoQuitado: false, planAntes: null, planDespues: null, createdAt: '2026-11-06T13:59:00Z' },
    { id: 'h3', accion: 'user_blocked', actor: '', automatico: true, motivo: 'demo vencido', sesionesCerradas: 0, venceEl: null, vencimientoQuitado: false, planAntes: null, planDespues: null, createdAt: '2026-11-01T10:00:00Z' },
    { id: 'h4', accion: 'admin_user_plan_set', actor: '', automatico: false, motivo: '', sesionesCerradas: null, venceEl: null, vencimientoQuitado: false, planAntes: 'free', planDespues: 'plus', createdAt: '2026-10-30T10:00:00Z' },
  ];

  it('cuenta cada accion con quien la hizo, el motivo y las sesiones cerradas', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.userHistory.mockResolvedValue({ success: true, data: historial });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    const seccion = (await screen.findByRole('heading', { name: 'Historial' })).closest('section') as HTMLElement;

    expect(await within(seccion).findByText('Keilor Martinez desbloqueó la cuenta')).toBeInTheDocument();
    expect(within(seccion).getByText('Keilor Martinez bloqueó la cuenta')).toBeInTheDocument();
    expect(within(seccion).getByText(/reporto el robo · Sesiones cerradas: 2/)).toBeInTheDocument();
    expect(within(seccion).getByText('Se bloqueó sola al llegar el vencimiento')).toBeInTheDocument();
    // Sin nombre del actor (cuenta ya borrada) no queda un hueco.
    expect(within(seccion).getByText('Un administrador cambió el plan de Gratis a Plus')).toBeInTheDocument();
  });

  it('vuelve a pedir el historial cuando el rastro ya se escribio, y pinta lo recien hecho', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.listUserSessions.mockResolvedValue({ success: true, data: [android] });
    mockApi.admin.revokeUserSession.mockResolvedValue({ success: true });
    mockApi.admin.userHistory
      .mockResolvedValueOnce({ success: true, data: [] })
      .mockResolvedValue({ success: true, data: [{ ...historial[0], id: 'h9', accion: 'admin_session_revoked' }] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    expect(await screen.findByText('Todavía no hay acciones registradas sobre esta cuenta.')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Cerrar la sesión de Chrome en Android' }));
    await user.click(await screen.findByRole('button', { name: 'Sí, cerrar' }));
    expect(mockApi.admin.userHistory).toHaveBeenCalledTimes(1);

    expect(await screen.findByText('Keilor Martinez cerró un dispositivo', {}, { timeout: 4000 })).toBeInTheDocument();
    expect(mockApi.admin.userHistory).toHaveBeenCalledTimes(2);
  });
});

describe('AdminUsersView en tablet y escritorio', () => {
  function ventanaAncha() {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: true,
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }

  it('la lista es una tabla; con varios resultados se elige la cuenta y otra fila cambia el detalle', async () => {
    ventanaAncha();
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor, victor] });
    const user = userEvent.setup();
    setup();

    await search(user, 'mart');
    const tabla = await screen.findByRole('table', { name: 'Resultados' });
    expect(within(tabla).getAllByRole('row')).toHaveLength(3); // encabezado + 2
    // Ninguna se abre sola: no se piden sesiones ni historial de nadie.
    expect(screen.getByText('Elige una cuenta de la lista para ver sus sesiones y su historial.')).toBeInTheDocument();
    expect(screen.queryByRole('article')).toBeNull();
    expect(mockApi.admin.listUserSessions).not.toHaveBeenCalled();

    await user.click(within(tabla).getByRole('button', { name: /Keilor Martinez/ }));
    expect(await screen.findByRole('article', { name: 'Keilor Martinez' })).toBeInTheDocument();

    await user.click(within(tabla).getByRole('button', { name: /Victor Rojas/ }));
    expect(await screen.findByRole('article', { name: 'Victor Rojas' })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Keilor Martinez' })).toBeNull();
    expect(mockApi.admin.listUserSessions).toHaveBeenLastCalledWith('u2');
  });

  it('una respuesta tardia de la cuenta anterior no se pinta en la nueva', async () => {
    ventanaAncha();
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor, victor] });
    const tardia = deferred<{ success: boolean; data: DeviceSession[] }>();
    mockApi.admin.listUserSessions.mockImplementation((id: string) =>
      id === 'u1' ? tardia.promise : Promise.resolve({ success: true, data: [] }),
    );
    const user = userEvent.setup();
    setup();

    await search(user, 'mart');
    const tabla = await screen.findByRole('table', { name: 'Resultados' });
    await user.click(within(tabla).getByRole('button', { name: /Keilor Martinez/ }));
    await screen.findByRole('article', { name: 'Keilor Martinez' });
    await user.click(within(tabla).getByRole('button', { name: /Victor Rojas/ }));
    await screen.findByRole('article', { name: 'Victor Rojas' });
    expect(await screen.findByText('No hay sesiones abiertas.')).toBeInTheDocument();

    await act(async () => { tardia.resolve({ success: true, data: [android] }); });

    expect(screen.queryByText('Chrome en Android')).toBeNull();
  });

  it('las sesiones van en tabla con su accion por fila', async () => {
    ventanaAncha();
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    mockApi.admin.listUserSessions.mockResolvedValue({ success: true, data: [android, windows] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    const ficha = await screen.findByRole('article', { name: 'Keilor Martinez' });
    await within(ficha).findByText('Chrome en Android');
    const tabla = within(ficha).getByRole('table');
    expect(within(tabla).getAllByRole('button', { name: /Cerrar la sesión de/ })).toHaveLength(2);
    expect(within(tabla).getByText('186.15.0.0')).toBeInTheDocument();
  });
});
