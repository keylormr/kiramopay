import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { AdminUsersView } from '../AdminUsersView';
import type { AdminUser } from '@/api/repositories/admin.repository';

// Administracion, usuarios, a 390 px:
// - el buscador compartia fila con su boton y el texto de ayuda se cortaba
//   ("Cédula, correo, teléfono o" ... );
// - las pestanas quedaban pegadas al borde de su contenedor;
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
  await screen.findByText('Keilor Martinez');
  return view;
}

const clases = (el: Element) => el.className.toString().split(/\s+/);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('kiramopay_language', 'es');
  Object.values(mockApi.admin).forEach((fn) => fn.mockReset());
});

describe('AdminUsersView — la ficha de un usuario sin correo', () => {
  it('con correo, la ficha lo muestra con su icono', async () => {
    const { container } = await buscar(persona);

    expect(screen.getByText('k•••••@gmail.com')).toBeInTheDocument();
    expect(container.querySelector('svg.lucide-mail')).not.toBeNull();
  });

  it('sin correo, no deja una linea con el icono del sobre y sin texto', async () => {
    const { container } = await buscar({ ...persona, emailMasked: '' });

    expect(container.querySelector('svg.lucide-mail')).toBeNull();
    // El resto de la ficha sigue ahi.
    expect(screen.getByText('••••••930')).toBeInTheDocument();
    expect(screen.getByText('••••••••1234')).toBeInTheDocument();
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

  it('las pestanas tienen aire a los lados y el texto puede encogerse', () => {
    setup();

    for (const nombre of ['Buscar', 'Bloqueadas', 'Eliminaciones']) {
      const pestana = screen.getByRole('tab', { name: new RegExp(nombre) });
      expect(clases(pestana)).toContain('px-2');
      expect(clases(pestana)).toContain('min-w-0');
    }
  });

  // "Eliminaciones" se veia "Eliminaci..." (tres pestanas en 358 px dejan ~74 px
  // de texto junto al icono y la etiqueta se cortaba con puntos suspensivos). El
  // nombre de la pestana se muestra completo: el icono va arriba del texto en
  // pantalla angosta y la etiqueta puede pasar a una segunda linea.
  it('las etiquetas de las pestanas se muestran completas: pasan de linea en vez de cortarse', () => {
    setup();

    for (const nombre of ['Buscar', 'Bloqueadas', 'Eliminaciones']) {
      const pestana = screen.getByRole('tab', { name: new RegExp(nombre) });
      const etiqueta = within(pestana).getByText(nombre);
      expect(clases(etiqueta)).not.toContain('truncate');
      expect(clases(etiqueta)).toContain('break-words');
      expect(clases(etiqueta)).toContain('text-center');
      // Icono sobre el texto en angosto; lado a lado cuando hay ancho.
      expect(clases(pestana)).toContain('flex-col');
      expect(clases(pestana).some((c) => c.startsWith('sm:flex-row'))).toBe(true);
    }
  });
});
