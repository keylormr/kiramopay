import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminUsersView } from '../AdminUsersView';
import type { AdminUser } from '@/api/repositories/admin.repository';

const mockApi = vi.hoisted(() => ({
  admin: {
    searchUsers: vi.fn(),
    listBlockedUsers: vi.fn(),
    getUser: vi.fn(),
    blockUser: vi.fn(),
    unblockUser: vi.fn(),
    setUserExpiry: vi.fn(),
  },
}));

vi.mock('@/api', () => ({ getApiLayer: () => mockApi }));

const keilor: AdminUser = {
  id: 'u1',
  firstName: 'Keilor',
  lastName: 'Martinez',
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
};

const keilorConVencimiento: AdminUser = {
  ...keilor,
  expiresAt: '2027-01-15T12:00:00Z',
};

const keilorBlocked: AdminUser = {
  ...keilor,
  status: 'blocked',
  blockedAt: '2026-09-02T14:00:00Z',
  blockedReason: 'presto la demo',
  blockedByName: 'Admin User',
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

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mockApi.admin).forEach((fn) => fn.mockReset());
});

describe('AdminUsersView', () => {
  it('shows the empty state when the search has no results', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [] });
    const user = userEvent.setup();
    setup();

    await search(user, 'nadie');

    expect(await screen.findByText('Sin resultados')).toBeInTheDocument();
    expect(mockApi.admin.searchUsers).toHaveBeenCalledWith('nadie');
  });

  it('renders the card with the name and the masked cedula', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');

    expect(await screen.findByText('Keilor Martinez')).toBeInTheDocument();
    expect(screen.getByText('••••••930')).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
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
    await user.click(await screen.findByRole('button', { name: 'Bloquear' }));
    await user.click(await screen.findByRole('button', { name: 'Sí, bloquear' }));

    expect(await screen.findByText('Escribe el motivo del bloqueo')).toBeInTheDocument();
    expect(mockApi.admin.blockUser).not.toHaveBeenCalled();
  });

  it('blocks once with the reason even on a double click, then refreshes the card', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    const pending = deferred<{ success: boolean; data: AdminUser }>();
    mockApi.admin.blockUser.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: 'Bloquear' }));
    await user.type(screen.getByLabelText('Motivo (obligatorio)'), 'presto la demo');
    const confirm = screen.getByRole('button', { name: 'Sí, bloquear' });
    await user.click(confirm);
    await user.click(confirm);

    expect(mockApi.admin.blockUser).toHaveBeenCalledTimes(1);
    expect(mockApi.admin.blockUser).toHaveBeenCalledWith('u1', 'presto la demo');

    pending.resolve({ success: true, data: keilorBlocked });

    expect(await screen.findByText('Bloqueada')).toBeInTheDocument();
    expect(screen.getByText('presto la demo')).toBeInTheDocument();
    expect(screen.getByText('Admin User')).toBeInTheDocument();
  });

  it('unblocks on confirmation and shows the account as active again', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilorBlocked] });
    mockApi.admin.unblockUser.mockResolvedValue({ success: true, data: keilor });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: 'Desbloquear' }));
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
    await user.click(await screen.findByRole('button', { name: 'Vencimiento' }));
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

  it('refuses to save an expiry with an empty date', async () => {
    mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [keilor] });
    const user = userEvent.setup();
    setup();

    await search(user, 'keil');
    await user.click(await screen.findByRole('button', { name: 'Vencimiento' }));
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
    await user.click(await screen.findByRole('button', { name: 'Vencimiento' }));
    await user.click(await screen.findByRole('button', { name: 'Quitar vencimiento' }));

    await waitFor(() => expect(mockApi.admin.setUserExpiry).toHaveBeenCalledWith('u1', null));
    await waitFor(() => expect(screen.queryByText('Vence el')).not.toBeInTheDocument());
  });

  it('lists the blocked accounts on the second tab', async () => {
    mockApi.admin.listBlockedUsers.mockResolvedValue({ success: true, data: [keilorBlocked] });
    const user = userEvent.setup();
    setup();

    await user.click(screen.getByRole('tab', { name: 'Bloqueadas' }));

    expect(await screen.findByText('Keilor Martinez')).toBeInTheDocument();
    expect(screen.getByText('Bloqueada')).toBeInTheDocument();
    expect(mockApi.admin.listBlockedUsers).toHaveBeenCalledTimes(1);
  });
});
