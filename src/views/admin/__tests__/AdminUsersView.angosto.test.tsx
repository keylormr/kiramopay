import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminUsersView } from '../AdminUsersView';
import type { AdminUser } from '@/api/repositories/admin.repository';

// Administracion, usuarios, a 390 px:
// - el buscador compartia fila con su boton y el texto de ayuda se cortaba
//   ("Cédula, correo, teléfono o" ... );
// - "Eliminaciones" se veia "Eliminaci..." en su pestana;
// - un usuario sin correo dejaba una linea con el icono del sobre y sin texto.
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

const persona: AdminUser = {
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

function setup() {
  return render(
    <LanguageProvider>
      <AdminUsersView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

async function buscar(usuario: AdminUser) {
  mockApi.admin.searchUsers.mockResolvedValue({ success: true, data: [usuario] });
  const user = userEvent.setup();
  const view = setup();
  await user.type(screen.getByPlaceholderText('Cédula, correo, teléfono o nombre'), 'keilor{Enter}');
  return { view, ficha: await screen.findByRole('article', { name: 'Keilor Martinez' }) };
}

const clases = (el: Element) => el.className.toString().split(/\s+/);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mockApi.admin).forEach((fn) => fn.mockReset());
  mockApi.admin.listUserSessions.mockResolvedValue({ success: true, data: [] });
  mockApi.admin.userHistory.mockResolvedValue({ success: true, data: [] });
});

describe('AdminUsersView — la ficha de un usuario sin correo', () => {
  it('con correo, la ficha lo muestra con su etiqueta', async () => {
    const { ficha } = await buscar(persona);

    expect(within(ficha).getByText('Correo')).toBeInTheDocument();
    expect(within(ficha).getByText('k•••••@gmail.com')).toBeInTheDocument();
  });

  it('sin correo, no deja una fila con la etiqueta y sin dato', async () => {
    const { ficha } = await buscar({ ...persona, emailMasked: '', username: '' });

    expect(within(ficha).queryByText('Correo')).toBeNull();
    expect(within(ficha).queryByText('Nombre de usuario')).toBeNull();
    // El resto de la ficha sigue ahi.
    expect(within(ficha).getByText('••••••930')).toBeInTheDocument();
    expect(within(ficha).getByText('••••••••1234')).toBeInTheDocument();
  });
});

describe('AdminUsersView a 390 px', () => {
  it('el buscador y su boton pasan a renglones propios en pantalla angosta', () => {
    setup();

    const campo = screen.getByPlaceholderText('Cédula, correo, teléfono o nombre');
    const fila = campo.parentElement!.parentElement as HTMLElement;
    expect(clases(fila)).toContain('flex-wrap');
    expect(clases(campo.parentElement as HTMLElement)).toContain('basis-full');
  });

  // "Eliminaciones" se veia "Eliminaci...". Las etiquetas no se cortan nunca:
  // van en una sola linea y, si las tres no caben, la fila se desplaza de lado.
  it('las etiquetas de las pestanas se muestran completas: sin puntos suspensivos', () => {
    setup();

    const lista = screen.getByRole('tablist');
    expect(clases(lista)).toContain('overflow-x-auto');
    for (const nombre of ['Buscar', 'Bloqueadas', 'Eliminaciones']) {
      const pestana = screen.getByRole('tab', { name: new RegExp(nombre) });
      const etiqueta = within(pestana).getByText(nombre);
      expect(clases(etiqueta)).not.toContain('truncate');
      expect(clases(pestana)).toContain('whitespace-nowrap');
      expect(clases(pestana)).toContain('shrink-0');
    }
  });

  it('los botones de la ficha tienen su tamano, no el ancho de la pantalla', async () => {
    await buscar(persona);

    for (const nombre of ['Bloquear cuenta', 'Programar vencimiento']) {
      const boton = screen.getByRole('button', { name: new RegExp(nombre) });
      expect(clases(boton)).not.toContain('w-full');
      expect(clases(boton)).toContain('inline-flex');
    }
  });
});
